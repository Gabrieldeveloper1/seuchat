// Message franking: denúncia verificável sem quebrar o E2EE.
//
//  1. O remetente gera k_frank e calcula tag = HMAC(k_frank, "scs-frank-v1" || payload).
//  2. Assina (tag, destinatário) com a chave de identidade Ed25519.
//  3. k_frank vai DENTRO do envelope cifrado. tag e assinatura vão em claro para o servidor,
//     que carimba server_mac = HMAC(SERVER_KEY, tag || remetente || destinatário || horário).
//  4. Ao denunciar, o destinatário revela payload + k_frank + carimbo; o servidor confere tudo.

import sodium from "libsodium-wrappers-sumo";
import type { FrankInfo } from "../types";
import { cat, enc, eq, fromB64, toB64 } from "./util";

const DOMAIN_TAG = enc.encode("scs-frank-v1");
const DOMAIN_SIG = enc.encode("scs-sig-v1");

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

export async function computeTag(frankKey: Uint8Array, payload: string): Promise<Uint8Array> {
  return hmac(frankKey, cat(DOMAIN_TAG, enc.encode(payload)));
}

export function sigPayload(tag: Uint8Array, recipientId: string): Uint8Array {
  return cat(DOMAIN_SIG, tag, enc.encode(recipientId));
}

export interface Franked {
  frankKey: Uint8Array;
  tag: Uint8Array;
  senderSig: Uint8Array;
}

/** Chamada pelo remetente antes de cifrar. `payload` é a string JSON exata que será enviada. */
export async function frankMessage(payload: string, recipientId: string, idSec: Uint8Array): Promise<Franked> {
  await sodium.ready;
  const frankKey = sodium.randombytes_buf(32);
  const tag = await computeTag(frankKey, payload);
  const senderSig = sodium.crypto_sign_detached(sigPayload(tag, recipientId), idSec);
  return { frankKey, tag, senderSig };
}

/** Destinatário: confere que tag e assinatura do remetente batem com o que foi decifrado. */
export async function verifyIncoming(
  payload: string,
  frankKey: Uint8Array,
  tag: Uint8Array,
  senderSig: Uint8Array,
  myId: string,
  senderIdKey: Uint8Array,
): Promise<boolean> {
  await sodium.ready;
  const expected = await computeTag(frankKey, payload);
  if (!eq(expected, tag)) return false;
  return sodium.crypto_sign_verify_detached(senderSig, sigPayload(tag, myId), senderIdKey);
}

export interface ReportPayload {
  reportedId: string;
  category: "csam" | "harassment" | "spam" | "other";
  plaintext: string;
  frank: { key: string; tag: string; senderSig: string; serverMac: string; sentAt: number };
}

export function buildReport(reportedId: string, category: ReportPayload["category"], f: FrankInfo): ReportPayload {
  return {
    reportedId,
    category,
    plaintext: f.payload,
    frank: { key: f.key, tag: f.tag, senderSig: f.sig, serverMac: f.mac, sentAt: f.sentAt },
  };
}

export const b64 = toB64;
export const unb64 = fromB64;
