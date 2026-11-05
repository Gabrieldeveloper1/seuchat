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

/** Returns the account's app-issued number, creating it once if necessary. */
export async function getAppNumber(jwt: string): Promise<string> {
  const result = await call<{ appNumber: string }>("app-number", {}, { jwt, retries: 0, timeoutMs: 5_000 });
  if (!/^[1-9]\d{4}-\d{4}$/.test(result.appNumber)) throw new ApiError(502, "O servidor retornou um número inválido.");
  return result.appNumber;
}

export async function lookupAppNumber(jwt: string, appNumber: string): Promise<{ userId: string } | null> {
  try {
    return await call("app-number-lookup", { appNumber }, { jwt, retries: 1 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function getTurnIceServers(jwt: string): Promise<RTCIceServer[]> {
  const result = await call<{ iceServers: RTCIceServer[] }>("turn-credentials", {}, { jwt, retries: 1, timeoutMs: 12_000 });
  if (!Array.isArray(result.iceServers) || !result.iceServers.length) {
    throw new ApiError(503, "Servidor TURN não configurado.");
  }
  return result.iceServers;
}

export interface UploadTicket { id: string; path: string; token: string; signedUrl: string; expiresAt: string | null }
export async function requestUpload(jwt: string, size: number, kind: "video" | "file", recipients: string[]): Promise<UploadTicket> {
  try { return await call("attachments", { op: "upload", size, kind, recipients }, { jwt, timeoutMs: 20_000 }); }
  catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 0)) throw new ApiError(e.status, "Serviço de anexos indisponível. Verifique a conexão e a publicação da função attachments.", e.raw);
    throw e;
  }
}
export async function requestDownload(jwt: string, id: string): Promise<string> {
  const r = await call<{ url: string }>("attachments", { op: "download", id }, { jwt, retries: 2, timeoutMs: 15_000 });
  return r.url;
}

export interface NewsItem { title: string; link: string; source: string; date: number; summary?: string; image?: string }
export async function getNews(jwt: string, cat: string): Promise<{ items: NewsItem[]; updatedAt: number }> {
  return call("news", { cat }, { jwt, retries: 1, timeoutMs: 20_000 });
}

export interface ProfileSnapshot { revision: number; nonce: string; ciphertext: string }
export async function getProfileSnapshot(jwt: string): Promise<ProfileSnapshot | null> {
  const result = await call<{ snapshot: ProfileSnapshot | null }>("profile-sync", { op: "get" }, { jwt, timeoutMs: 15_000 });
  return result.snapshot;
}
export async function putProfileSnapshot(jwt: string, expected: number, nonce: string, ciphertext: string): Promise<number> {
  const result = await call<{ revision: number }>("profile-sync", { op: "put", expected, nonce, ciphertext }, { jwt, timeoutMs: 15_000 });
  return result.revision;
}

/** Recebe deltas reais; versões anteriores do servidor ainda retornam JSON completo. */
export async function askNodia(jwt: string, messages: {role: "user" | "assistant"; content: string}[], onDelta:(part:string)=>void): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_ANON) throw new ApiError(0,"Servidor não configurado");
  const ctl=new AbortController();const timer=window.setTimeout(()=>ctl.abort(),155_000);let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try {
    const res=await fetch(`${SUPABASE_URL}/functions/v1/nodia`,{method:"POST",headers:{"Content-Type":"application/json",apikey:SUPABASE_ANON,Authorization:`Bearer ${jwt}`},body:JSON.stringify({messages,stream:true}),signal:ctl.signal});
    if(!res.ok){const text=await res.text();throw new ApiError(res.status,friendly(res.status,text));}
    if(!(res.headers.get("content-type") ?? "").includes("application/x-ndjson")){
      const result=await res.json();if(typeof result?.reply!=="string" || !result.reply.trim())throw new ApiError(503,"Resposta inválida");onDelta(result.reply);return result.reply;
    }
    if(!res.body)throw new ApiError(503,"Resposta indisponível");
    reader=res.body.getReader();const decoder=new TextDecoder();let pending="",reply="",complete=false;
    while(true){const {value,done}=await reader.read();pending+=decoder.decode(value??new Uint8Array(),{stream:!done});if(pending.length>100_000)throw new Error("Resposta inválida");
      const lines=pending.split("\n");pending=lines.pop()??"";if(done&&pending){lines.push(pending);pending="";}
      for(const line of lines){if(!line.trim())continue;const e=JSON.parse(line);if(e.type==="delta"&&typeof e.text==="string"){reply+=e.text;if(reply.length>6100)throw new Error("Resposta longa demais");onDelta(e.text)}else if(e.type==="done")complete=true;else if(e.type==="error")throw new Error("Resposta interrompida");}
      if(done)break;
    }
    if(!complete||!reply.trim())throw new Error("Resposta interrompida");return reply;
  } catch(e){if(e instanceof ApiError)throw e;throw new ApiError(ctl.signal.aborted?408:503,"Resposta interrompida");}
  finally{clearTimeout(timer);try{await reader?.cancel()}catch{}ctl.abort();}
}

export interface ModerationCase {
  id: string; role: "reporter" | "reported"; category: string;
  status: "open" | "reviewing" | "actioned" | "dismissed"; createdAt: string;
  appeal: null | { id: string; report_id: string; status: "open" | "accepted" | "rejected"; created_at: string };
}
/** Autenticação de escopo limitado via posse da identidade, inclusive em contas banidas. */
export async function caseRequest<T>(keys: Keys, op: "list" | "appeal" | "admin-list" | "admin-evidence" | "admin-decision" | "admin-appeal" | "messages" | "send" | "admin-presence" | "admin-typing", reportId: string | null = null, reason: string | null = null, note: string | null = null): Promise<T> {
  await sodium.ready;
  const {challenge} = await call<{challenge: string}>("case-desk", {userId:keys.userId,op:"challenge"});
  const signed=JSON.stringify({op,reportId,reason,note});
  const signature=sodium.crypto_sign_detached(cat(enc.encode("scs-case-v1:"),enc.encode(challenge),enc.encode(signed)),keys.idSec);
  return call<T>("case-desk", {userId:keys.userId,op,reportId,reason,note,challenge,signature:toB64(signature)}, {timeoutMs:20000});
}
