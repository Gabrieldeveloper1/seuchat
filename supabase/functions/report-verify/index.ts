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

  let b: { reportedId: string; category: string; plaintext: string; note?: string; proofs?: {name:string;mime:string;data:string}[]; frank: { key: string; tag: string; senderSig: string; serverMac: string; sentAt: number } };
  try { const raw=await req.text(); if(raw.length>2_100_000) return fail(413,"denúncia muito grande"); b=JSON.parse(raw); } catch { return fail(400, "json"); }
  if (!["csam","harassment","spam","other"].includes(b.category)) return fail(400, "categoria");
  if (b.note !== undefined && (typeof b.note !== "string" || b.note.length>1000)) return fail(400,"observação inválida");
  if (b.proofs !== undefined && (!Array.isArray(b.proofs) || b.proofs.length>2)) return fail(400,"provas inválidas");
  const proofs=[];
  for(const proof of b.proofs ?? []) {
    if(!proof || typeof proof.name!=="string" || proof.name.length>120 || typeof proof.mime!=="string" || typeof proof.data!=="string" || proof.data.length>699052 || !/^[A-Za-z0-9+/]+={0,2}$/.test(proof.data)) return fail(400,"prova inválida");
    let bytes:Uint8Array; try { bytes=b64d(proof.data); } catch {return fail(400,"prova inválida");}
    if(!bytes.length || bytes.length>512*1024) return fail(400,"prova inválida");
    const valid=proof.mime==="image/jpeg" ? bytes[0]===255&&bytes[1]===216&&bytes[2]===255 : proof.mime==="image/png" ? [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) : proof.mime==="image/webp" ? String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP" : proof.mime==="application/pdf" ? String.fromCharCode(...bytes.slice(0,5))==="%PDF-" : false;
    if(!valid) return fail(400,"formato de prova inválido");
    proofs.push({name:proof.name,mime:proof.mime,data:proof.data});
  }
  if (!/^[a-z2-7]{26}$/.test(b.reportedId) || typeof b.plaintext !== "string" || b.plaintext.length > 400_000) return fail(400, "campos");

  if (!b.frank || typeof b.frank.key !== "string" || typeof b.frank.tag !== "string" || typeof b.frank.senderSig !== "string" || typeof b.frank.serverMac !== "string" || !Number.isFinite(b.frank.sentAt)) return fail(400,"prova inválida");
  let key:Uint8Array,tag:Uint8Array,sig:Uint8Array,mac:Uint8Array;
  try { key=b64d(b.frank.key); tag=b64d(b.frank.tag); sig=b64d(b.frank.senderSig); mac=b64d(b.frank.serverMac); } catch {return fail(400,"prova inválida");}
  if(key.length!==32 || tag.length!==32 || sig.length!==64 || mac.length!==32) return fail(400,"prova inválida");

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
  const evidence = seal(enc.encode(JSON.stringify({ plaintext: b.plaintext, frank: b.frank, reporterId, reportedId: b.reportedId, note: b.note?.trim() ?? "", proofs })), b64d(modPub));
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

  // A criptografia comprova autoria e integridade, não a natureza da mensagem.
  // Nenhum banimento é aplicado sem revisão humana da evidência.
  // 6. avisa a moderação no Discord (só metadados; falha aqui não derruba a denúncia)
  try {
    const mid = await discordNotify({ id: report.id, category: b.category, reportedId: b.reportedId, autoBanned: false });
    if (mid) await db.from("reports").update({ discord_message_id: mid }).eq("id", report.id);
  } catch { /* ignora */ }
  return json({ reportId: report.id, verified: true, sealed: b64e(evidence).length > 0 });
});
