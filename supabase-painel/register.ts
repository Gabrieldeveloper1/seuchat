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
// Cadastro anônimo: o ID é derivado da chave pública. Idempotente (restaurar a mesma frase não duplica).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail(400, "json"); }

  try {
    const idKey = b64d(String(b.identityKey));
    const spk = b64d(String(b.signedPrekey));
    const spkSig = b64d(String(b.signedPrekeySig));
    const regSig = b64d(String(b.regSig));
    const ts = Number(b.ts);
    const pow = Number(b.pow);
    if (idKey.length !== 32 || spk.length !== 32 || spkSig.length !== 64 || regSig.length !== 64) return fail(400, "tamanhos");
    if (!Number.isInteger(pow) || pow < 0 || Math.abs(Date.now() - ts) > 5 * 60_000) return fail(400, "timestamp");

    // 1. prova de trabalho (16 bits)
    const powBuf = new Uint8Array(36);
    powBuf.set(idKey);
    new DataView(powBuf.buffer).setUint32(32, pow, true);
    const h = await sha256(powBuf);
    if (h[0] !== 0 || h[1] !== 0) return fail(400, "pow");

    // 2. posse da chave de identidade e da prekey
    if (!nacl.sign.detached.verify(cat(enc.encode("scs-register-v1"), spk, enc.encode(String(ts))), regSig, idKey)) return fail(400, "assinatura de registro");
    if (!nacl.sign.detached.verify(spk, spkSig, idKey)) return fail(400, "assinatura da prekey");

    const userId = await userIdFromIdKey(idKey);
    const db = admin();

    // 3. banido? (mesmo ID não pode voltar)
    const { data: ban } = await db.from("bans").select("id").eq("user_id", userId).limit(1);
    if (ban?.length) return fail(403, "conta banida");

    const { error } = await db.from("identities").upsert(
      { user_id: userId, identity_key: toPg(idKey), signed_prekey: toPg(spk), signed_prekey_sig: toPg(spkSig) },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
    if (error) return fail(500, error.message);
    return json({ ok: true, userId });
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "erro");
  }
});
