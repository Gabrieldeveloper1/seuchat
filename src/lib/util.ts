export const enc = new TextEncoder();
export const dec = new TextDecoder();

export function toB64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) {
    s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(s: string): Uint8Array {
  const b = atob(s);
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u;
}

/** PostgREST devolve bytea como "\\x0a1b..." */
export function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith("\\x") ? h.slice(2) : h;
  const u = new Uint8Array(s.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return u;
}

export function bytesToHex(u: Uint8Array): string {
  let s = "";
  for (const b of u) s += b.toString(16).padStart(2, "0");
  return s;
}

export function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

const A = "abcdefghijklmnopqrstuvwxyz234567";
/** base32 minúsculo sem padding; 16 bytes -> 26 caracteres */
export function base32(u: Uint8Array): string {
  let bits = 0;
  let val = 0;
  let out = "";
  for (const b of u) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += A[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
    val &= (1 << bits) - 1;
  }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}

export const ID_RE = /^[a-z2-7]{26}$/;

export function shortId(id: string): string {
  return `${id.slice(0, 5)}…${id.slice(-4)}`;
}
