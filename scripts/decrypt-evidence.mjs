// Moderação: decifra a evidência de uma denúncia (coluna reports.evidence, em hex "\x...").
// Uso: MODERATION_PRIVATE_KEY=<base64> node scripts/decrypt-evidence.mjs '\x0a1b...'
import nacl from "tweetnacl";

const hex = (process.argv[2] ?? "").replace(/^\\x/, "");
const sec = process.env.MODERATION_PRIVATE_KEY;
if (!hex || !sec) {
  console.error("uso: MODERATION_PRIVATE_KEY=<base64> node scripts/decrypt-evidence.mjs '<evidence hex>'");
  process.exit(1);
}
const buf = Uint8Array.from(Buffer.from(hex, "hex"));
const eph = buf.slice(0, 32), nonce = buf.slice(32, 56), box = buf.slice(56);
const out = nacl.box.open(box, nonce, eph, Uint8Array.from(Buffer.from(sec, "base64")));
if (!out) {
  console.error("não foi possível decifrar (chave errada ou evidência corrompida)");
  process.exit(2);
}
const obj = JSON.parse(Buffer.from(out).toString("utf8"));
// o payload pode conter imagem em base64; não imprimimos o conteúdo bruto por padrão
const p = JSON.parse(obj.plaintext);
if (p.image) p.image = `[imagem jpeg, ${p.image.length} bytes base64, omitida]`;
const proofs = Array.isArray(obj.proofs) ? obj.proofs.map(({name,mime,data})=>({name,mime,base64Bytes: typeof data === "string" ? data.length : 0,conteudo:"omitido"})) : [];
console.log(JSON.stringify({ ...obj, proofs, plaintext: p }, null, 2));
