import nacl from "npm:tweetnacl@1";
import { admin, authUser, b64d, cat, cors, enc, fail, fromPg, hmac, json, toPg } from "../_shared/util.ts";

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
  const { data: me } = await db.from("identities").select("identity_key,banned_at").eq("user_id", senderId).maybeSingle();
  if (!me || me.banned_at) return fail(403, "forbidden");

  const { data: rcpt } = await db.from("identities").select("user_id,banned_at").eq("user_id", b.recipientId).maybeSingle();
  if (!rcpt || rcpt.banned_at) return fail(404, "destinatário não encontrado");

  const ct = b64d(b.ciphertext), tag = b64d(b.tag), sig = b64d(b.senderSig);
  if (ct.length > 262144 || tag.length !== 32 || sig.length !== 64) return fail(400, "tamanhos");

  // anti-flood: fila do destinatário e fila deste remetente para este destinatário
  const { count: total } = await db.from("relay_messages").select("id", { count: "exact", head: true }).eq("recipient_id", b.recipientId);
  if ((total ?? 0) >= 5000) return fail(429, "fila do destinatário cheia");
  const { count: mine } = await db.from("relay_messages").select("id", { count: "exact", head: true }).eq("recipient_id", b.recipientId).eq("sender_id", senderId);
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
