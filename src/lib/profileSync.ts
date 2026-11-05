import sodium from "libsodium-wrappers-sumo";
import { cat, dec, enc, fromB64, toB64 } from "./util";
import type { Keys } from "./crypto";
import type { Profile } from "../types";

export interface SharedProfile { name: string; avatar?: string; banner?: string }
/** Somente campos visíveis do perfil: configurações, contatos e histórico são locais. */
export function sharedProfile(p: Profile): SharedProfile {
  return { name: p.name, ...(p.avatar ? { avatar: p.avatar } : {}), ...(p.banner ? { banner: p.banner } : {}) };
}
export function profileFingerprint(p: Profile): string { return JSON.stringify(sharedProfile(p)); }
function derive(keys: Keys) { return sodium.crypto_generichash(32, cat(keys.idSec, enc.encode("scs-profile-sync-key-v1"))); }
function aad(keys: Keys) { return enc.encode(`scs-profile-sync-v1:${keys.userId}`); }
export async function encryptProfile(keys: Keys, p: Profile): Promise<{ nonce: string; ciphertext: string }> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const key = derive(keys);
  try {
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(enc.encode(JSON.stringify(sharedProfile(p))), aad(keys), null, nonce, key);
    return { nonce: toB64(nonce), ciphertext: toB64(ciphertext) };
  } finally { sodium.memzero(key); }
}
export async function decryptProfile(keys: Keys, payload: { nonce: string; ciphertext: string }): Promise<SharedProfile> {
  await sodium.ready;
  const key = derive(keys);
  try {
    const raw = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, fromB64(payload.ciphertext), aad(keys), fromB64(payload.nonce), key);
    const p = JSON.parse(dec.decode(raw)) as Record<string, unknown>;
    if (!p || typeof p.name !== "string" || p.name.length > 40) throw new Error("Perfil sincronizado inválido");
    for (const [key, limit] of [["avatar", 60000], ["banner", 120000]] as const) {
      if (p[key] !== undefined && (typeof p[key] !== "string" || !(p[key] as string).startsWith("data:image/jpeg;base64,") || (p[key] as string).length > limit)) throw new Error("Imagem de perfil inválida");
    }
    return { name: p.name, ...(p.avatar ? { avatar: p.avatar as string } : {}), ...(p.banner ? { banner: p.banner as string } : {}) };
  } finally { sodium.memzero(key); }
}
