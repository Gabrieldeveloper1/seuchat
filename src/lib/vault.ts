import sodium from "libsodium-wrappers-sumo";
import type { LocalState } from "../types";
import { dec, enc, fromB64, toB64 } from "./util";

// Cofre local: todo o estado (frase, contatos, mensagens) é cifrado com XChaCha20-Poly1305,
// com chave derivada da senha via Argon2id. Nada em texto claro vai para o IndexedDB.

const DB = "seuchatseguro";
const STORE = "kv";
const KEY = "vault";

interface Rec {
  salt: string;
  nonce: string;
  ct: string;
  ops: number;
  mem: number;
}

export interface VaultHandle {
  key: Uint8Array;
  salt: string;
  ops: number;
  mem: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idbGet(k: string): Promise<Rec | undefined> {
  const db = await open();
  return new Promise((res, rej) => {
    const q = db.transaction(STORE).objectStore(STORE).get(k);
    q.onsuccess = () => res(q.result as Rec | undefined);
    q.onerror = () => rej(q.error);
  });
}

async function idbPut(k: string, v: Rec): Promise<void> {
  const db = await open();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function wipeVault(): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function vaultExists(): Promise<boolean> {
  try {
    return !!(await idbGet(KEY));
  } catch {
    return false;
  }
}

function derive(pass: string, salt: Uint8Array, ops: number, mem: number): Uint8Array {
  return sodium.crypto_pwhash(32, pass, salt, ops, mem, sodium.crypto_pwhash_ALG_ARGON2ID13);
}

async function write(h: VaultHandle, state: LocalState): Promise<void> {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(enc.encode(JSON.stringify(state)), nonce, h.key);
  await idbPut(KEY, { salt: h.salt, nonce: toB64(nonce), ct: toB64(ct), ops: h.ops, mem: h.mem });
}

export async function createVault(pass: string, state: LocalState): Promise<VaultHandle> {
  await sodium.ready;
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const ops = sodium.crypto_pwhash_OPSLIMIT_MODERATE;
  const mem = sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE;
  const h: VaultHandle = { key: derive(pass, salt, ops, mem), salt: toB64(salt), ops, mem };
  await write(h, state);
  return h;
}

export async function openVault(pass: string): Promise<{ state: LocalState; handle: VaultHandle } | null> {
  await sodium.ready;
  const rec = await idbGet(KEY);
  if (!rec) return null;
  const key = derive(pass, fromB64(rec.salt), rec.ops, rec.mem);
  try {
    const pt = sodium.crypto_secretbox_open_easy(fromB64(rec.ct), fromB64(rec.nonce), key);
    return { state: JSON.parse(dec.decode(pt)) as LocalState, handle: { key, salt: rec.salt, ops: rec.ops, mem: rec.mem } };
  } catch {
    return null; // senha errada
  }
}

export async function saveVault(h: VaultHandle, state: LocalState): Promise<void> {
  await sodium.ready;
  await write(h, state);
}
