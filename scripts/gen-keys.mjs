// Gera as chaves/segredos do projeto. Rode: npm run keys
// Guarde a saída em um cofre de segredos. NUNCA faça commit.
import { generateKeyPairSync, randomBytes } from "node:crypto";

const raw = (jwk) => Buffer.from(jwk, "base64url");

// 1) Chave da moderação (X25519): a pública vai para MODERATION_PUBKEY; a privada fica OFFLINE.
const mod = generateKeyPairSync("x25519");
const modPub = raw(mod.publicKey.export({ format: "jwk" }).x).toString("base64");
const modSec = raw(mod.privateKey.export({ format: "jwk" }).d).toString("base64");

// 2) Chave do carimbo de franking (HMAC) do servidor.
const frank = randomBytes(32).toString("base64");

// 3) Chave Ed25519 que assina a lista de hashes (blocklist.json).
const bl = generateKeyPairSync("ed25519");
const blPub = raw(bl.publicKey.export({ format: "jwk" }).x).toString("base64");
const blSeed = raw(bl.privateKey.export({ format: "jwk" }).d).toString("base64");

console.log(`
# ---- Supabase secrets (supabase secrets set ...) ----
MODERATION_PUBKEY=${modPub}
FRANKING_SERVER_KEY=${frank}
# JWT_SECRET = "JWT Secret" do projeto (Project Settings > API). Precisa ser o MESMO do projeto.

# ---- Front-end (.env.local) ----
VITE_BLOCKLIST_PUBKEY=${blPub}

# ---- GUARDAR OFFLINE (não vão para o servidor nem para o app) ----
MODERATION_PRIVATE_KEY=${modSec}
BLOCKLIST_SIGNING_SEED=${blSeed}
`);
