import sodium from "libsodium-wrappers-sumo";
import type { Keys } from "./crypto";
import { findPow } from "./crypto";
import type { ReportPayload } from "./franking";
import { cat, enc, toB64 } from "./util";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export class ApiError extends Error {
  constructor(public status: number, message: string, public raw = "") {
    super(message);
  }
}

/** Texto de servidor vira mensagem humana. Respostas de 4xx já escritas em português passam direto. */
function friendly(status: number, text: string): string {
  const t = text.trim();
  const human = t.length > 8 && /\s/.test(t) && !t.startsWith("{") && !t.startsWith("<");
  if (status === 401) return t.includes("expirado") ? "Sessão expirada. Tente novamente." : "Sessão inválida. Tente novamente.";
  if (status === 403) return t.includes("banida") ? "Esta conta foi banida." : "Ação não permitida.";
  if (status === 408 || status === 504) return "O servidor demorou para responder. Tente de novo.";
  if (status === 413) return "Arquivo grande demais para enviar.";
  if (status === 429) return "Muitas tentativas seguidas. Aguarde um instante.";
  if (status >= 500) return "Servidor indisponível no momento. Tente novamente em instantes.";
  if (human) return t.slice(0, 200);
  if (status === 404) return "Não encontrado.";
  return "Não foi possível concluir. Tente novamente.";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([0, 408, 425, 429, 500, 502, 503, 504, 522, 524, 544, 546]);

interface CallOpts { jwt?: string; retries?: number; timeoutMs?: number }

async function once<T>(name: string, body: unknown, jwt: string | undefined, timeoutMs: number): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON, Authorization: `Bearer ${jwt ?? SUPABASE_ANON}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch {
    throw new ApiError(0, ctl.signal.aborted ? "O servidor demorou para responder. Verifique sua internet." : navigator.onLine === false ? "Você está sem internet." : "Sem conexão com o servidor");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, friendly(res.status, text), text);
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(502, "Resposta inválida do servidor. Tente novamente.", text);
  }
}

/** Chamada às Edge Functions com timeout e novas tentativas (só em chamadas seguras de repetir). */
async function call<T>(name: string, body: unknown, o: CallOpts | string = {}): Promise<T> {
  const opt: CallOpts = typeof o === "string" ? { jwt: o } : o;
  if (!SUPABASE_URL || !SUPABASE_ANON) throw new ApiError(0, "Servidor não configurado (variáveis VITE_SUPABASE_* ausentes)");
  const retries = opt.retries ?? 0;
  for (let i = 0; ; i++) {
    try {
      return await once<T>(name, body, opt.jwt, opt.timeoutMs ?? 15_000);
    } catch (e) {
      if (i >= retries || !(e instanceof ApiError) || !RETRYABLE.has(e.status)) throw e;
      await sleep(350 * 2 ** i + Math.random() * 200); // 350ms, 700ms, 1.4s…
    }
  }
}

export async function register(keys: Keys): Promise<void> {
  await sodium.ready;
  const ts = Date.now();
  const regSig = sodium.crypto_sign_detached(cat(enc.encode("scs-register-v1"), keys.spkPub, enc.encode(String(ts))), keys.idSec);
  const spkSig = sodium.crypto_sign_detached(keys.spkPub, keys.idSec);
  await call("register", {
    identityKey: toB64(keys.idPub),
    signedPrekey: toB64(keys.spkPub),
    signedPrekeySig: toB64(spkSig),
    ts,
    regSig: toB64(regSig),
    pow: findPow(keys.idPub),
  }, { retries: 1, timeoutMs: 30_000 });
}

export async function login(keys: Keys): Promise<string> {
  await sodium.ready;
  const { challenge } = await call<{ challenge: string }>("login", { userId: keys.userId }, { retries: 2 });
  const sig = sodium.crypto_sign_detached(cat(enc.encode("scs-login-v1"), enc.encode(challenge)), keys.idSec);
  const { jwt } = await call<{ jwt: string }>("login", { userId: keys.userId, challenge, signature: toB64(sig) }, { retries: 1 });
  return jwt;
}

export async function sendMessage(
  jwt: string,
  recipientId: string,
  ciphertext: Uint8Array,
  tag: Uint8Array,
  senderSig: Uint8Array,
): Promise<{ sentAt: number }> {
  return call("send-message", {
    recipientId,
    ciphertext: toB64(ciphertext),
    tag: toB64(tag),
    senderSig: toB64(senderSig),
  }, { jwt, timeoutMs: 25_000 });
}

export async function submitReport(jwt: string, payload: ReportPayload): Promise<{ reportId: string; verified: boolean }> {
  return call("report-verify", payload, { jwt, timeoutMs: 40_000 });
}

export async function deleteAccount(jwt: string): Promise<void> {
  await call("delete-account", {}, { jwt, timeoutMs: 30_000 });
}

export async function linkPhone(jwt: string, phone: string, code?: string): Promise<{ step: "code" | "done"; verified?: boolean }> {
  return call("phone-link", { phone, code }, { jwt, timeoutMs: 25_000 });
}

export async function lookupPhone(jwt: string, phone: string): Promise<{ userId: string; verified: boolean } | null> {
  try {
    return await call("phone-lookup", { phone }, { jwt, retries: 2 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
