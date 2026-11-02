import nacl from "npm:tweetnacl@1";
import { admin, b64d, b64e, cat, cors, enc, eq, fail, fromPg, hmac, issueJwt, json } from "../_shared/util.ts";

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
