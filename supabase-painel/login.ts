import nacl from "npm:tweetnacl@1";
import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, jwtVerify } from "npm:jose@5";

// ---- util compartilhado (inline) ----// Utilidades compartilhadas das Edge Functions (Deno).

export const enc = new TextEncoder();

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
export const fail = (status: number, msg: string) =>
  new Response(msg, { status, headers: cors });

export function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64e = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
/** bytea vindo do PostgREST: "\\x0a1b..." */
export const fromPg = (h: string) => {
  const s = h.startsWith("\\x") ? h.slice(2) : h;
  const u = new Uint8Array(s.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return u;
};
/** bytea para inserir via PostgREST */
export const toPg = (u: Uint8Array) => "\\x" + Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

export const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of p) {
    o.set(x, i);
    i += x.length;
  }
  return o;
};

export const eq = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
};

export async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export const sha256 = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));

const A = "abcdefghijklmnopqrstuvwxyz234567";
export function base32(u: Uint8Array): string {
  let bits = 0, val = 0, out = "";
  for (const b of u) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += A[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
    val &= (1 << bits) - 1;
  }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}

/** ID público: base32 dos 16 primeiros bytes de SHA-256(chave pública de identidade). */
export async function userIdFromIdKey(idKey: Uint8Array) {
  return base32((await sha256(idKey)).slice(0, 16));
}

// ---- JWT (assinado com o JWT secret do projeto para que a RLS do Postgres o aceite) ----
const jwtKey = () => enc.encode(Deno.env.get("JWT_SECRET")!);

export async function issueJwt(userId: string) {
  return await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(jwtKey());
}

export async function authUser(req: Request): Promise<string | null> {
  const t = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, jwtKey(), { audience: "authenticated" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// ---- função ----
// Login por desafio-assinatura (sem senha no servidor).
//  1) { userId }                          -> { challenge }
//  2) { userId, challenge, signature }    -> { jwt }
// O desafio é sem estado: ts.nonce.HMAC(...). Validade de 2 minutos.
const loginKey = () => enc.encode("scs-login-key:" + Deno.env.get("JWT_SECRET"));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  let b: { userId?: string; challenge?: string; signature?: string };
  try { b = await req.json(); } catch { return fail(400, "json"); }
  if (!b.userId || !/^[a-z2-7]{26}$/.test(b.userId)) return fail(400, "userId");

  const db = admin();
  const { data: me } = await db.from("identities").select("identity_key,banned_at").eq("user_id", b.userId).maybeSingle();
  if (!me) return fail(404, "não cadastrado");
  if (me.banned_at) return fail(403, "conta banida");

  if (!b.challenge) {
    const ts = String(Date.now());
    const nonce = b64e(crypto.getRandomValues(new Uint8Array(16)));
    const mac = b64e(await hmac(loginKey(), enc.encode(`${b.userId}.${ts}.${nonce}`)));
    return json({ challenge: `${ts}.${nonce}.${mac}` });
  }

  const [ts, nonce, mac] = b.challenge.split(".");
  if (!ts || !nonce || !mac || !b.signature) return fail(400, "desafio");
  if (Math.abs(Date.now() - Number(ts)) > 2 * 60_000) return fail(401, "desafio expirado");
  const expected = await hmac(loginKey(), enc.encode(`${b.userId}.${ts}.${nonce}`));
  if (!eq(expected, b64d(mac))) return fail(401, "desafio inválido");

  const ok = nacl.sign.detached.verify(cat(enc.encode("scs-login-v1"), enc.encode(b.challenge)), b64d(b.signature), fromPg(me.identity_key));
  if (!ok) return fail(401, "assinatura inválida");
  return json({ jwt: await issueJwt(b.userId), expiresIn: 3600 });
});
