// Filtro local de mídia por hash perceptual (antes do envio e antes de exibir).
//
// Implementa o núcleo do algoritmo PDQ (Meta): luminância 64x64 -> DCT 2D -> 16x16 de baixas frequências
// -> bit = (coeficiente > mediana) => 256 bits. NÃO substitui a implementação de referência do PDQ:
// para comparar com listas oficiais (NCMEC/IWF/Thorn) use as listas no formato e na versão do algoritmo
// que o provedor especificar. Veja docs/FILTRO_DE_HASH.md.

import sodium from "libsodium-wrappers-sumo";
import { bytesToHex, cat, enc, fromB64 } from "./util";

const N = 64;
const K = 16;
export const MATCH_DISTANCE = 31; // limiar típico do PDQ (bits de 256)

// matriz DCT-II: C[u][x] = cos(pi*(2x+1)*u / (2N))
const C: Float32Array[] = Array.from({ length: K }, (_, u) => {
  const row = new Float32Array(N);
  for (let x = 0; x < N; x++) row[x] = Math.cos((Math.PI * (2 * x + 1) * u) / (2 * N));
  return row;
});

/** gray: N*N luminâncias (0..255), linha a linha. Retorna 32 bytes (256 bits). */
export function pdqFromGray(gray: ArrayLike<number>): Uint8Array {
  // A = C (16x64) * G (64x64)  -> 16x64
  const A = new Float32Array(K * N);
  for (let u = 0; u < K; u++) {
    for (let y = 0; y < N; y++) {
      let s = 0;
      for (let x = 0; x < N; x++) s += C[u][x] * gray[x * N + y];
      A[u * N + y] = s;
    }
  }
  // B = A (16x64) * C^T (64x16) -> 16x16
  const B = new Float32Array(K * K);
  for (let u = 0; u < K; u++) {
    for (let v = 0; v < K; v++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += A[u * N + y] * C[v][y];
      B[u * K + v] = s;
    }
  }
  const sorted = Array.from(B).sort((a, b) => a - b);
  const median = (sorted[127] + sorted[128]) / 2;
  const out = new Uint8Array(32);
  for (let i = 0; i < 256; i++) if (B[i] > median) out[i >> 3] |= 1 << (i & 7);
  return out;
}

export function hamming(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export type BlocklistStatus = "ok" | "empty" | "invalid";
let list: Uint8Array[] = [];
let status: BlocklistStatus = "empty";
let loaded = false;

export function blocklistStatus() {
  return { status, loaded, count: list.length };
}

/** Image sending is allowed only if a list is loaded, or REQUIRE_BLOCKLIST is off. */
export function imageSendingAllowed(): boolean {
  const required = import.meta.env.VITE_REQUIRE_BLOCKLIST === "true";
  return !required || status === "ok";
}

/** Carrega /blocklist.json e valida a assinatura Ed25519 (VITE_BLOCKLIST_PUBKEY). Falha fechada. */
export async function loadBlocklist(): Promise<void> {
  await sodium.ready;
  try {
    const res = await fetch("/blocklist.json", { cache: "no-store" });
    const j = (await res.json()) as { version: number; hashes: string[]; sig: string };
    if (!j.hashes?.length) {
      list = [];
      status = "empty";
      return;
    }
    const pub = import.meta.env.VITE_BLOCKLIST_PUBKEY;
    if (!pub) throw new Error("sem chave pública da lista");
    const msg = cat(enc.encode("scs-blocklist-v1"), enc.encode(String(j.version)), enc.encode([...j.hashes].sort().join(",")));
    if (!sodium.crypto_sign_verify_detached(fromB64(j.sig), msg, fromB64(pub))) throw new Error("assinatura inválida");
    list = j.hashes.map((h) => sodium.from_hex(h));
    status = "ok";
  } catch {
    list = [];
    status = "invalid";
  } finally {
    loaded = true;
  }
}

export function isBlocked(h: Uint8Array): boolean {
  return list.some((b) => hamming(h, b) <= MATCH_DISTANCE);
}

async function toBitmap(src: Blob): Promise<ImageBitmap> {
  return createImageBitmap(src);
}

export function grayOf(bmp: ImageBitmap): Float32Array {
  const c = document.createElement("canvas");
  c.width = N;
  c.height = N;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bmp, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  const g = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return g;
}

export async function hashBlob(b: Blob): Promise<Uint8Array> {
  const bmp = await toBitmap(b);
  try {
    return pdqFromGray(grayOf(bmp));
  } finally {
    bmp.close();
  }
}

export type PrepareResult = { ok: true; dataUrl: string; hashHex: string } | { ok: false; reason: "blocked" | "invalid" | "too_big" | "disabled" };

const MAX_BYTES = 170_000;

/** Verifica o hash ANTES de qualquer cifragem/envio; depois reduz para JPEG caber na mensagem. */
export async function prepareImage(file: File): Promise<PrepareResult> {
  if (!imageSendingAllowed()) return { ok: false, reason: "disabled" };
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size > 15 * 1024 * 1024) return { ok: false, reason: "invalid" };
  let bmp: ImageBitmap;
  try {
    bmp = await toBitmap(file);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  try {
    const h = pdqFromGray(grayOf(bmp));
    if (isBlocked(h)) return { ok: false, reason: "blocked" };
    let max = 1280;
    for (let q = 0.82; q >= 0.3; q -= 0.1, max = Math.round(max * 0.85)) {
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(bmp.width * scale));
      c.height = Math.max(1, Math.round(bmp.height * scale));
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", q);
      if ((url.length * 3) / 4 <= MAX_BYTES) return { ok: true, dataUrl: url, hashHex: bytesToHex(h) };
    }
    return { ok: false, reason: "too_big" };
  } finally {
    bmp.close();
  }
}

/** Verificação no recebimento (defesa em profundidade). true = bloqueada. */
export async function dataUrlIsBlocked(dataUrl: string): Promise<boolean> {
  if (!list.length) return false;
  try {
    // decodifica o data URL localmente (fetch("data:") seria barrado pela CSP)
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const blob = new Blob([fromB64(b64) as BlobPart], { type: "image/jpeg" });
    return isBlocked(await hashBlob(blob));
  } catch {
    return true; // não decodificável: não exibe
  }
}
