import nacl from "npm:tweetnacl@1";
import { admin, authUser, b64d, b64e, cat, cors, enc, eq, fail, fromPg, discordNotify, hmac, json, toPg } from "../_shared/util.ts";

// Denúncia verificável (message franking). O denunciante é o DESTINATÁRIO da mensagem.
const SERVER_KEY = () => b64d(Deno.env.get("FRANKING_SERVER_KEY")!);

/** "Sealed box" simples para a moderação: efêmera(32) || nonce(24) || nacl.box. */
function seal(msg: Uint8Array, recipientPub: Uint8Array) {
  const eph = nacl.box.keyPair();
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  return cat(eph.publicKey, nonce, nacl.box(msg, nonce, recipientPub, eph.secretKey));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const reporterId = await authUser(req);
  if (!reporterId) return fail(401, "unauthorized");

  const modPub = Deno.env.get("MODERATION_PUBKEY");
  if (!modPub) return fail(500, "chave de moderação não configurada");

  let b: { reportedId: string; category: string; plaintext: string; frank: { key: string; tag: string; senderSig: string; serverMac: string; sentAt: number } };
  try { b = await req.json(); } catch { return fail(400, "json"); }
  if (!["csam", "harassment", "spam", "other"].includes(b.category)) return fail(400, "categoria");
  if (!/^[a-z2-7]{26}$/.test(b.reportedId) || typeof b.plaintext !== "string" || b.plaintext.length > 400_000) return fail(400, "campos");

  const key = b64d(b.frank.key), tag = b64d(b.frank.tag), sig = b64d(b.frank.senderSig), mac = b64d(b.frank.serverMac);

  // 1. o texto revelado bate com a tag? (prova que é exatamente o que foi enviado)
  const expectedTag = await hmac(key, cat(enc.encode("scs-frank-v1"), enc.encode(b.plaintext)));
  if (!eq(expectedTag, tag)) return fail(422, "tag não confere");

  // 2. o carimbo do servidor confere? (passou pelo relay entre esses dois IDs, nesse horário)
  const expectedMac = await hmac(SERVER_KEY(), cat(tag, enc.encode(b.reportedId), enc.encode(reporterId), enc.encode(String(b.frank.sentAt))));
  if (!eq(expectedMac, mac)) return fail(422, "carimbo não confere");

  // 3. a assinatura do remetente confere? (prova de autoria)
  const db = admin();
  const { data: sender } = await db.from("identities").select("identity_key,attestation_hash").eq("user_id", b.reportedId).maybeSingle();
  if (!sender || !nacl.sign.detached.verify(cat(enc.encode("scs-sig-v1"), tag, enc.encode(reporterId)), sig, fromPg(sender.identity_key))) return fail(422, "assinatura do remetente");

  // 4. grava a evidência cifrada para a moderação (nunca em texto claro)
  const evidence = seal(enc.encode(JSON.stringify({ plaintext: b.plaintext, frank: b.frank, reporterId, reportedId: b.reportedId })), b64d(modPub));
  const isCsam = b.category === "csam";
  const { data: report, error } = await db.from("reports").insert({
    reporter_id: reporterId,
    reported_id: b.reportedId,
    category: b.category,
    evidence: toPg(evidence),
    verified: true,
    legal_hold: isCsam, // preservação: fora da limpeza automática
  }).select("id").single();
  if (error || !report) return fail(500, error?.message ?? "erro");

  // 5. CSAM verificado: banimento imediato do ID. O restante vai para revisão humana.
  if (isCsam) {
    await db.from("identities").update({ banned_at: new Date().toISOString() }).eq("user_id", b.reportedId);
    await db.from("bans").insert({ user_id: b.reportedId, attestation_hash: sender.attestation_hash, reason: "csam_verified_report", report_id: report.id });
    await db.from("relay_messages").delete().eq("sender_id", b.reportedId);
    await db.from("audit_log").insert({ actor: "system", action: "auto_ban_csam", target: b.reportedId });
    // TODO(compliance): encaminhar ao canal legal (ex.: NCMEC CyberTipline / autoridades brasileiras)
    // após revisão humana, conforme orientação jurídica. Veja docs/CONFORMIDADE.md.
  }
  // 6. avisa a moderação no Discord (só metadados; falha aqui não derruba a denúncia)
  try {
    const mid = await discordNotify({ id: report.id, category: b.category, reportedId: b.reportedId, autoBanned: isCsam });
    if (mid) await db.from("reports").update({ discord_message_id: mid }).eq("id", report.id);
  } catch { /* ignora */ }
  return json({ reportId: report.id, verified: true, sealed: b64e(evidence).length > 0 });
});
