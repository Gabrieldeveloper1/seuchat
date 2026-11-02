// Assina a lista de hashes: node scripts/sign-blocklist.mjs hashes.txt  (um hash hex de 64 caracteres por linha)
// Requer BLOCKLIST_SIGNING_SEED (base64, saída do gen-keys). Gera public/blocklist.json.
import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const file = process.argv[2];
const seed = process.env.BLOCKLIST_SIGNING_SEED;
if (!file || !seed) {
  console.error("uso: BLOCKLIST_SIGNING_SEED=<base64> node scripts/sign-blocklist.mjs hashes.txt");
  process.exit(1);
}
const hashes = readFileSync(file, "utf8").split(/\s+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
if (hashes.some((h) => !/^[0-9a-f]{64}$/.test(h))) throw new Error("todo hash deve ter 64 caracteres hex (256 bits)");
const version = Math.floor(Date.now() / 1000);

// PKCS#8 de uma chave Ed25519 = prefixo fixo + seed de 32 bytes
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed, "base64")]), format: "der", type: "pkcs8" });
const msg =Buffer.concat([Buffer.from("scs-blocklist-v1"), Buffer.from(String(version)), Buffer.from([...hashes].sort().join(","))]);
const sig = sign(null, msg, key).toString("base64");
writeFileSync("public/blocklist.json", JSON.stringify({ version, hashes, sig }));
console.log(`public/blocklist.json atualizado: ${hashes.length} hashes, versão ${version}`);
