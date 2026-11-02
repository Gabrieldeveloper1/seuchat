import sodium from "libsodium-wrappers-sumo";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { base32, cat, enc } from "./util";

export async function ready() {
  await sodium.ready;
  return sodium;
}

export function newMnemonic(): string {
  return generateMnemonic(wordlist, 128); // 12 palavras
}

export function normalizeMnemonic(m: string): string {
  return m.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isValidMnemonic(m: string): boolean {
  return validateMnemonic(normalizeMnemonic(m), wordlist);
}

export interface Keys {
  userId: string;
  idPub: Uint8Array; // Ed25519
  idSec: Uint8Array;
  spkPub: Uint8Array; // X25519
  spkSec: Uint8Array;
}

/** ID público = base32 dos 16 primeiros bytes de SHA-256(chave pública de identidade). */
export function userIdFromIdKey(idPub: Uint8Array): string {
  return base32(sodium.crypto_hash_sha256(idPub).slice(0, 16));
}

/** Todas as chaves derivam da frase de recuperação: restaurar a frase restaura a identidade. */
export async function keysFromMnemonic(mnemonic: string): Promise<Keys> {
  await sodium.ready;
  const seed = mnemonicToSeedSync(normalizeMnemonic(mnemonic)); // 64 bytes
  const idSeed = sodium.crypto_generichash(32, cat(seed, enc.encode("scs-id-v1")));
  const spkSeed = sodium.crypto_generichash(32, cat(seed, enc.encode("scs-spk-v1")));
  const id = sodium.crypto_sign_seed_keypair(idSeed);
  const spk = sodium.crypto_box_seed_keypair(spkSeed);
  return {
    userId: userIdFromIdKey(id.publicKey),
    idPub: id.publicKey,
    idSec: id.privateKey,
    spkPub: spk.publicKey,
    spkSec: spk.privateKey,
  };
}

/** Prova de trabalho barata no cadastro (anti-spam): SHA-256(idPub || nonce LE32) com 16 bits zero. */
export function findPow(idPub: Uint8Array): number {
  const buf = new Uint8Array(idPub.length + 4);
  buf.set(idPub);
  const view = new DataView(buf.buffer);
  for (let n = 0; n < 0xffffffff; n++) {
    view.setUint32(idPub.length, n, true);
    const h = sodium.crypto_hash_sha256(buf);
    if (h[0] === 0 && h[1] === 0) return n;
  }
  throw new Error("pow falhou");
}
