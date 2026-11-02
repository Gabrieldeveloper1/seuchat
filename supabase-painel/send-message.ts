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
// Relay de mensagens cifradas. O servidor NÃO vê o conteúdo: só valida a assinatura do remetente
// sobre a tag de franking e carimba (tag, remetente, destinatário, horário).
const SERVER_KEY = () => b64d(Deno.env.get("FRANKING_SERVER_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const senderId = await authUser(req);
  if (!senderId) return fail(401, "unauthorized");

  let b: { recipientId?: string; ciphertext?: string; tag?: string; senderSig?: string };
  try { b = await req.json(); } catch { return fail(400, "json"); }
  if (!b.recipientId || !/^[a-z2-7]{26}$/.test(b.recipientId) || !b.ciphertext || !b.tag || !b.senderSig) return fail(400, "campos");

  const db = admin();
  const [{ data: me }, { data: rcpt }] = await Promise.all([
    db.from("identities").select("identity_key,banned_at").eq("user_id", senderId).maybeSingle(),
    db.from("identities").select("user_id,banned_at").eq("user_id", b.recipientId).maybeSingle(),
  ]);
  if (!me || me.banned_at) return fail(403, "forbidden");
  if (!rcpt || rcpt.banned_at) return fail(404, "destinatário não encontrado");

  const ct = b64d(b.ciphertext), tag = b64d(b.tag), sig = b64d(b.senderSig);
  if (ct.length > 262144 || tag.length !== 32 || sig.length !== 64) return fail(400, "tamanhos");

  // anti-flood: fila do destinatário e fila deste remetente para este destinatário
  const [{ count: total }, { count: mine }] = await Promise.all([
    db.from("relay_messages").select("id", { count: "exact", head: true }).eq("recipient_id", b.recipientId),
    db.from("relay_messages").select("id", { count: "exact", head: true }).eq("recipient_id", b.recipientId).eq("sender_id", senderId),
  ]);
  if ((total ?? 0) >= 5000) return fail(429, "fila do destinatário cheia");
  if ((mine ?? 0) >= 300) return fail(429, "muitas mensagens pendentes");

  if (!nacl.sign.detached.verify(cat(enc.encode("scs-sig-v1"), tag, enc.encode(b.recipientId)), sig, fromPg(me.identity_key))) return fail(400, "assinatura");

  const sentAt = Date.now();
  const mac = await hmac(SERVER_KEY(), cat(tag, enc.encode(senderId), enc.encode(b.recipientId), enc.encode(String(sentAt))));

  const { error } = await db.from("relay_messages").insert({
    sender_id: senderId,
    recipient_id: b.recipientId,
    ciphertext: toPg(ct),
    franking_tag: toPg(tag),
    server_mac: toPg(mac),
    sender_sig: toPg(sig),
    sent_at: sentAt,
  });
  if (error) return fail(500, error.message);
  return json({ sentAt });
});
