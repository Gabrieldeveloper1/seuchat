import sodium from "libsodium-wrappers-sumo";
import { SUPABASE_ANON, requestDownload, requestUpload } from "./api";
import { grayOf, imageSendingAllowed, isBlocked, pdqFromGray } from "./imageFilter";
import { fromB64, toB64 } from "./util";
import type { FileRef } from "../types";

export const MAX_FILE = 25 * 1024 * 1024;
const SAFE_VIDEO = /^video\/(mp4|webm|quicktime|ogg)$/;
const SAFE_AUDIO = /^audio\/(webm|ogg|mp4|mpeg|aac|wav|x-m4a)$/;
const RISKY_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jar|apk|app|dmg|sh|html?|svg|hta|lnk|reg)$/i;

export const isVideoRef = (f: FileRef) => SAFE_VIDEO.test(f.mime);
export const isAudioRef = (f: FileRef) => SAFE_AUDIO.test(f.mime);
export const isRiskyName = (name: string) => RISKY_EXT.test(name);

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function sha256(b: Uint8Array): Promise<string> {
  return toB64(new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource)));
}

function putWithProgress(url: string, body: Uint8Array, onProgress?: (p: number) => void): Promise<void> {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.setRequestHeader("x-upsert", "false");
    x.setRequestHeader("apikey", SUPABASE_ANON);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? res() : rej(new Error("Falha ao enviar o arquivo")));
    x.onerror = () => rej(new Error("Sem conexão para enviar o arquivo"));
    x.send(new Blob([body as BlobPart]));
  });
}

/** Cifra o arquivo no aparelho (XChaCha20-Poly1305) e envia só os bytes cifrados. */
export async function uploadEncrypted(jwt: string, data: Uint8Array, kind: "video" | "file", recipients: string[], onProgress?: (p: number) => void) {
  await sodium.ready;
  const key = sodium.crypto_aead_xchacha20poly1305_ietf_keygen();
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const cipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(data, null, null, nonce, key);
  if (cipher.length > MAX_FILE) throw new Error("Arquivo grande demais (máximo 25 MB).");
  const ticket = await requestUpload(jwt, cipher.length, kind, recipients);
  await putWithProgress(ticket.signedUrl, cipher, onProgress);
  return { id: ticket.id, expiresAt: ticket.expiresAt, key: toB64(key), nonce: toB64(nonce), hash: await sha256(cipher) };
}

const cache = new Map<string, string>();

/** Baixa, confere a integridade e decifra. Devolve uma URL local (blob:) */
export async function downloadDecrypted(jwt: string, f: FileRef, onProgress?: (p: number) => void): Promise<string> {
  if (f.expiresAt && Date.now() >= Date.parse(f.expiresAt)) { const cached = cache.get(f.id); if (cached) URL.revokeObjectURL(cached); cache.delete(f.id); throw new Error("Vídeo expirado após 10 dias."); }
  const hit = cache.get(f.id);
  if (hit) return hit;
  const url = await requestDownload(jwt, f.id);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("Anexo indisponível ou expirado");
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (got > MAX_FILE + 1024) throw new Error("Anexo inválido");
    if (total) onProgress?.(got / total);
  }
  const cipher = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { cipher.set(p, o); o += p.length; }
  if ((await sha256(cipher)) !== f.hash) throw new Error("O arquivo foi alterado e não pode ser aberto");
  await sodium.ready;
  let plain: Uint8Array;
  try { plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, cipher, null, fromB64(f.nonce), fromB64(f.key)); }
  catch { throw new Error("Não foi possível decifrar o anexo"); }
  const safeMime = SAFE_VIDEO.test(f.mime) || SAFE_AUDIO.test(f.mime) ? f.mime : "application/octet-stream";
  const blob = new Blob([plain as BlobPart], { type: safeMime });
  if (SAFE_VIDEO.test(f.mime) && imageSendingAllowed() && (await videoFramesBlocked(blob))) {
    throw new Error("Este vídeo viola as regras da plataforma e foi bloqueado.");
  }
  const out = URL.createObjectURL(blob);
  cache.set(f.id, out);
  return out;
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = src;
    v.onloadeddata = () => res(v);
    v.onerror = () => rej(new Error("Vídeo inválido ou formato não suportado"));
    setTimeout(() => rej(new Error("Não foi possível ler o vídeo")), 15000);
  });
}
const seek = (v: HTMLVideoElement, t: number) => new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = t; setTimeout(res, 3000); });

/** Amostra quadros do vídeo e compara com a mesma lista de segurança usada nas imagens. */
export async function videoFramesBlocked(blob: Blob): Promise<boolean> {
  const src = URL.createObjectURL(blob);
  try {
    const v = await loadVideo(src);
    const d = isFinite(v.duration) ? v.duration : 0;
    const points = d > 1 ? [0.05, 0.2, 0.4, 0.6, 0.8, 0.95].map((p) => p * d) : [0];
    for (const t of points) {
      await seek(v, t);
      const bmp = await createImageBitmap(v).catch(() => null);
      if (!bmp) throw new Error("Não foi possível verificar os quadros deste vídeo.");
      try { if (isBlocked(pdqFromGray(grayOf(bmp)))) return true; } finally { bmp.close(); }
    }
    return false;
  } finally { URL.revokeObjectURL(src); }
}

/** Gera capa (JPEG pequeno), duração e dimensões do vídeo. */
export async function videoInfo(file: Blob): Promise<{ thumb?: string; dur: number; w: number; h: number }> {
  const src = URL.createObjectURL(file);
  try {
    const v = await loadVideo(src);
    const dur = isFinite(v.duration) ? Math.round(v.duration) : 0;
    await seek(v, Math.min(0.5, (v.duration || 1) / 3));
    const w = v.videoWidth, h = v.videoHeight;
    const s = Math.min(1, 360 / Math.max(w, h, 1));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    let thumb: string | undefined;
    for (let q = 0.7; q >= 0.3; q -= 0.1) { const t = c.toDataURL("image/jpeg", q); if (t.length < 40_000) { thumb = t; break; } }
    return { thumb, dur, w, h };
  } finally { URL.revokeObjectURL(src); }
}
