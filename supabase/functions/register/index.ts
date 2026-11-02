import nacl from "npm:tweetnacl@1";
import { admin, b64d, cat, cors, enc, fail, json, sha256, toPg, userIdFromIdKey } from "../_shared/util.ts";

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
