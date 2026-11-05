import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import sodium from "libsodium-wrappers-sumo";
import type { Contact, FileRef, Group, GroupAuditEntry, GroupRole, LocalState, Msg } from "../types";
import { CallEngine, IDLE, type CallState } from "./callEngine";
import { ID_RE, dec, enc, fromB64, hexToBytes, toB64 } from "./util";
import { isValidMnemonic, keysFromMnemonic, newMnemonic, normalizeMnemonic, type Keys } from "./crypto";
import { normalizeAppNumber } from "./phone";
import { createVault, openVault, saveVault, vaultExists, wipeVault, type VaultHandle } from "./vault";
import { startSession, fetchIdentity, type RelayRow, type Session } from "./session";
import { ApiError, getNews, type NewsItem, deleteAccount as apiDeleteAccount, lookupAppNumber, sendMessage, submitReport, getTurnIceServers, getProfileSnapshot, putProfileSnapshot, askNodia } from "./api";
import { buildReport, frankMessage, verifyIncoming, type ReportPayload } from "./franking";
import { dataUrlIsBlocked, imageSendingAllowed, loadBlocklist, prepareImage } from "./imageFilter";
import { decryptProfile, encryptProfile, profileFingerprint } from "./profileSync";
import { applyReaction, REACTIONS, type ReactionEvent } from "./reactions";
import { MAX_FILE, downloadDecrypted, uploadEncrypted, videoFramesBlocked, videoInfo } from "./files";

export function msgLabel(m: Pick<Msg, "kind" | "file">): string {
  if (m.kind === "audio") return "Mensagem de voz";
  if (m.kind === "image") return "Imagem";
  if (m.kind === "file" && m.file) return m.file.voice ? "Mensagem de voz" : m.file.mime.startsWith("video/") ? "Vídeo" : `Arquivo: ${m.file.name}`;
  return "Mensagem";
}

export type Phase = "boot" | "welcome" | "locked" | "app";

interface Ctx {
  nodiaBusy: boolean;
  consentNodia(): void;
  clearNodia(): void;
  sendNodia(text: string): Promise<void>;
  phase: Phase;
  local: LocalState | null;
  userId: string | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  online: boolean;
  activity: Record<string, number>;
  typing: Record<string, Record<string, number>>;
  sendActivity(peer: string, kind: "ping" | "typing"): void;
  onboardingMnemonic: string | null;
  clearOnboarding(): void;
  clearNotice(): void;
  createAccount(name: string, pass: string): Promise<void>;
  addContactByNumber(appNumber: string, alias: string): Promise<void>;
  setProfileName(name: string): void;
  resolveProfileConflict(choice: "local" | "server"): Promise<void>;
  changePassword(oldPass: string, newPass: string): Promise<void>;
  deleteMessage(id: string): void;
  markBackupDone(): void;
  setTheme(t: "auto" | "light" | "dark"): void;
  restoreAccount(mnemonic: string, pass: string): Promise<void>;
  unlock(pass: string): Promise<void>;
  lock(): void;
  reconnect(): Promise<void>;
  addContact(id: string, alias: string): Promise<void>;
  renameContact(id: string, alias: string): void;
  setBlocked(id: string, blocked: boolean): void;
  acceptContact(id: string): void;
  removeContact(id: string): void;
  setContactTtl(id: string, ttl: number): void;
  sendReaction(peer: string, msg: Msg, emoji: string): Promise<void>;
  sendText(peer: string, text: string, reply?: Msg, mentions?: string[]): Promise<void>;
  sendImage(peer: string, file: File): Promise<void>;
  markRead(peer: string): void;
  report(msg: Msg, category: ReportPayload["category"]): Promise<void>;
  setAutolock(min: number): void;
  deleteAccount(): Promise<void>;
  sendAudio(peer: string, rec: { dataUrl: string; blob: Blob; mime: string; dur: number; wave: number[] }, onProgress?: (p: number) => void): Promise<void>;
  sendFile(peer: string, file: File, onProgress?: (p: number) => void): Promise<void>;
  downloadFile(f: FileRef, onProgress?: (p: number) => void): Promise<string>;
  fetchNews(cat: string): Promise<{ items: NewsItem[]; updatedAt: number }>;
  setProfileImages(avatar?: string | null, banner?: string | null): void;
  createGroup(name: string, members: string[]): Promise<string>;
  updateGroup(gid: string, patch: Partial<Pick<Group, "name" | "members" | "ttl" | "description" | "avatar" | "banner" | "roles" | "memberRoles" | "autoRole">>): Promise<void>;
  leaveGroup(gid: string): Promise<void>;
  acceptGroup(gid: string): void;
  setCallRelayOnly(on: boolean): void;
  call: CallState;
  startCall(peer: string, video: boolean): Promise<void>;
  startGroupCall(gid: string, video: boolean): Promise<void>;
  acceptCall(): Promise<void>;
  rejectCall(): Promise<void>;
  hangup(): Promise<void>;
  toggleMic(): void;
  toggleCam(): Promise<void>;
  shareScreen(): Promise<void>;
  switchCamera(): Promise<void>;
}

const C = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(C);

const MAX_TEXT = 8000;
const TTLS = new Set([0, 5, 30, 300, 3600, 86400, 604800]);

function emptyState(mnemonic: string, name = ""): LocalState {
  return { v: 1, mnemonic, profile: { name }, profileSync: { revision: 0, dirty: !!name }, contacts: [], groups: [], messages: [], settings: { autolockMin: 10, theme: "auto", backupDone: false, phoneMigrationRequired: false } };
}

/** Cofres criados em versões antigas não têm perfil/tema. */
function migrate(s: LocalState): LocalState {
  const profile = s.profile ?? { name: "" };
  return {
    ...s,
    groups: (s.groups ?? []).map((g) => ({
      ...g,
      roles: g.roles?.length ? g.roles : [{ id: "everyone", name: "@Everyone", permissions: [] }],
      memberRoles: g.memberRoles ?? Object.fromEntries(g.members.map((m) => [m, "everyone"])),
      autoRole: g.autoRole ?? "everyone",
      audit: g.audit ?? [],
    })),
    profile,
    profileSync: s.profileSync ?? { revision: 0, dirty: !!(profile.name || profile.avatar || profile.banner) },
    settings: {
      ...s.settings,
      theme: s.settings?.theme ?? "auto",
      backupDone: s.settings?.backupDone ?? true,
      // Em cofres antigos, a ausência do marcador identifica contas anteriores ao recurso.
      phoneMigrationRequired: s.settings?.phoneMigrationRequired ?? !profile.phone,
    },
  };
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.status === 0 ? e.message : e.message.slice(0, 200);
  if (e instanceof Error) return e.message;
  return "Erro inesperado";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [local, setLocal] = useState<LocalState | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [activity, setActivity] = useState<Record<string, number>>({});
  const [typing, setTyping] = useState<Record<string, Record<string, number>>>({});
  const signalRef = useRef<(peer: string, payload: string) => Promise<unknown>>(async () => {});
  const [onboardingMnemonic, setOnb] = useState<string | null>(null);

  const localRef = useRef<LocalState | null>(null);
  const vaultRef = useRef<VaultHandle | null>(null);
  const keysRef = useRef<Keys | null>(null);
  const sessRef = useRef<Session | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const seen = useRef<Set<string>>(new Set());
  const pollTimer = useRef<number | undefined>(undefined);
  const live = useRef(false); // canal em tempo real conectado?
  const fails = useRef(0);
  const callRef = useRef<CallEngine | null>(null);
  const peerCache = useRef<Map<string, Uint8Array>>(new Map());
  const [call, setCall] = useState<CallState>(IDLE);

  // ---------- estado local + persistência ----------
  const update = useCallback((fn: (s: LocalState) => LocalState) => {
    const cur = localRef.current;
    if (!cur) return;
    const next = fn(cur);
    localRef.current = next;
    setLocal(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      if (vaultRef.current) void saveVault(vaultRef.current, next);
    }, 250);
  }, []);

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    if (vaultRef.current && localRef.current) await saveVault(vaultRef.current, localRef.current);
  }, []);

  const [nodiaBusy, setNodiaBusy] = useState(false);
  const nodiaPending = useRef(false);
  const consentNodia = useCallback(() => update((s) => ({ ...s, nodiaConsent: true })), [update]);
  const clearNodia = useCallback(() => { if (!nodiaPending.current) update((s) => ({ ...s, nodiaMessages: [] })); }, [update]);
  const sendNodia = useCallback(async (input: string) => {
    const sess = sessRef.current; const current = localRef.current; const text = input.trim();
    if (!sess || !current || !current.nodiaConsent) throw new Error("Sessão ou consentimento indisponível.");
    if (!text || text.length > 3000 || nodiaPending.current) throw new Error("Mensagem inválida ou envio em andamento.");
    nodiaPending.current = true; setNodiaBusy(true);
    try {
      const history = (current.nodiaMessages ?? []).slice(-12).map(({role, content}) => ({role, content: content.slice(0, 3000)}));
      while (history.reduce((n, m) => n + m.content.length, text.length) > 16000) history.shift();
      const messages = [...history, {role: "user" as const, content: text}];
      let reply: string;
      try { reply = await askNodia(sess.getJwt(), messages); }
      catch (e) { if (!(e instanceof ApiError) || e.status !== 401) throw e; await sess.refresh(); reply = await askNodia(sess.getJwt(), messages); }
      if (sessRef.current !== sess) return;
      const ts = Date.now();
      update((s) => ({ ...s, nodiaMessages: [...(s.nodiaMessages ?? []), {id: crypto.randomUUID(), role: "user" as const, content: text, ts}, {id: crypto.randomUUID(), role: "assistant" as const, content: reply, ts: ts + 1}].slice(-100) }));
    } finally { nodiaPending.current = false; setNodiaBusy(false); }
  }, [update]);

  // ---------- recebimento ----------
  const processRow = useCallback(
    async (row: RelayRow) => {
      const sess = sessRef.current;
      const keys = keysRef.current;
      if (!sess || !keys || seen.current.has(row.id)) return;
      seen.current.add(row.id);
      let drop = true; // apaga do servidor mesmo se for inválida
      let ephemeral = false;
      try {
        await sodium.ready;
        const sealed = sodium.crypto_box_seal_open(hexToBytes(row.ciphertext), keys.spkPub, keys.spkSec);
        const env = JSON.parse(dec.decode(sealed)) as { payload: string; k: string; from: string };
        if (env.from !== row.sender_id || typeof env.payload !== "string") throw new Error("envelope");

        let contact = localRef.current!.contacts.find((c) => c.id === row.sender_id);
        if (contact?.blocked) throw new Error("bloqueado");
        if (!contact) {
          // Sinais efêmeros não criam solicitações de contato inesperadas.
          const kind = (() => { try { return JSON.parse(env.payload)?.t; } catch { return undefined; } })();
          if (kind === "activity" || kind === "typing" || kind === "reaction") throw new Error("sinal de desconhecido");
          let peer;
          try {
            peer = await fetchIdentity(sess.client, row.sender_id);
          } catch {
            drop = false; // erro transitório: tenta de novo depois
            seen.current.delete(row.id);
            throw new Error("rede");
          }
          if (!peer) throw new Error("identidade inválida");
          contact = {
            id: row.sender_id,
            alias: `Desconhecido ${row.sender_id.slice(0, 5)}`,
            name: undefined,
            idKey: toB64(peer.idKey),
            spk: toB64(peer.spk),
            requested: true,
            ttl: 0,
            addedAt: Date.now(),
          };
          const nc = contact;
          update((s) => ({ ...s, contacts: [...s.contacts, nc] }));
        }

        const tag = hexToBytes(row.franking_tag);
        const sig = hexToBytes(row.sender_sig);
        const ok = await verifyIncoming(env.payload, fromB64(env.k), tag, sig, keys.userId, fromB64(contact.idKey));
        if (!ok) throw new Error("franking");

        const p = JSON.parse(env.payload) as {
          t: string; op?: string; id?: string; kind?: string; text?: string; image?: string; audio?: string; dur?: number; wave?: unknown[]; file?: unknown; ttl?: number; ts?: number; ids?: string[];
          n?: string; an?: string; rt?: { id?: string; text?: string }; gid?: string; name?: string; members?: string[]; av?: string; bn?: string;
          description?: string; roles?: GroupRole[]; memberRoles?: Record<string, string>; autoRole?: string;
          audit?: GroupAuditEntry[]; auditAllowed?: boolean; mentions?: string[]; author?: string; emoji?: string;
        };

        if (typeof p.n === "string" && p.n.trim()) {
          const nm = p.n.trim().slice(0, 40);
          update((s) => ({
            ...s,
            contacts: s.contacts.map((c) =>
              c.id === row.sender_id ? { ...c, name: nm, alias: c.alias.startsWith("Desconhecido ") ? nm : c.alias } : c,
            ),
          }));
        }

        if (p.t === "activity" && !contact.requested) {
          // Só sinais recentes indicam presença; mensagens atrasadas não geram resposta.
          const ts = Math.min(Date.now(), Number(row.sent_at));
          if (!Number.isFinite(ts) || Date.now() - ts > 65_000) { ephemeral = true; }
          else {
            setActivity((state) => ({ ...state, [row.sender_id]: Math.max(state[row.sender_id] ?? 0, ts) }));
            update((s) => ({ ...s, contacts: s.contacts.map((c) => c.id === row.sender_id ? { ...c, lastSeen: Math.max(c.lastSeen ?? 0, ts) } : c) }));
            if (p.op === "ping" && document.visibilityState === "visible") void signalRef.current(row.sender_id, JSON.stringify({ t: "activity", op: "pong" })).catch(() => {});
          }
        } else if (p.t === "typing" && !contact.requested) {
          ephemeral = true;
          const ts = Number(row.sent_at);
          const g = p.gid ? localRef.current!.groups.find((item) => item.id === p.gid && !item.requested && item.members.includes(row.sender_id) && item.members.includes(keys.userId)) : undefined;
          if (Number.isFinite(ts) && Date.now() - ts < 8_000 && (!p.gid || g)) {
            const thread = g ? `g:${g.id}` : row.sender_id;
            setTyping((state) => ({ ...state, [thread]: { ...state[thread], [row.sender_id]: Math.min(ts, Date.now()) } }));
          }
        } else if (p.t === "reaction") {
          const g = p.gid ? localRef.current!.groups.find((x) => x.id === p.gid && !x.requested && x.members.includes(row.sender_id) && x.members.includes(keys.userId)) : undefined;
          if ((p.gid && !g) || (!p.gid && contact.requested)) throw new Error("conversa inválida");
          const thread = g ? `g:${g.id}` : row.sender_id;
          if (typeof p.id !== "string" || !/^[0-9a-f-]{36}$/.test(p.id) || typeof p.author !== "string" || !(g ? g.members.includes(p.author) : [row.sender_id, keys.userId].includes(p.author)) || typeof p.emoji !== "string" || (p.emoji !== "" && !(REACTIONS as readonly string[]).includes(p.emoji))) throw new Error("reação inválida");
          const event: ReactionEvent = {peer:thread, id:p.id, author:p.author, actor:row.sender_id, emoji:p.emoji, ts:Number(row.sent_at)};
          if (!Number.isFinite(event.ts)) throw new Error("data inválida");
          update((s) => {
            const found = s.messages.some((m) => m.peer === event.peer && m.id === event.id && (m.from ?? m.peer) === event.author);
            return found ? {...s, messages:s.messages.map((m) => applyReaction(m,event))} : {...s, pendingReactions:[...(s.pendingReactions ?? []), event].slice(-200)};
          });
        } else if (p.t === "read" && Array.isArray(p.ids)) {
          const readAt = Date.now();
          update((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.dir === "out" && m.peer === row.sender_id && p.ids!.includes(m.id) && !m.readAt
                ? { ...m, readAt, expiresAt: m.ttl ? readAt + m.ttl * 1000 : undefined }
                : m,
            ),
          }));
        } else if (p.t === "prof-request" && !contact.requested && !contact.blocked) {
          const pr = localRef.current?.profile;
          if (pr) void signalRef.current(row.sender_id, JSON.stringify({ t: "prof", n: pr.name, an: pr.appNumber, av: pr.avatar ?? "", bn: pr.banner ?? "" })).catch(() => {});
        } else if (p.t === "prof") {
          if (contact.requested) throw new Error("perfil de desconhecido");
          const patch: Partial<Contact> = {};
          if (typeof p.an === "string" && /^[1-9]\d{4}-\d{4}$/.test(p.an)) patch.appNumber = p.an;
          for (const [k, v, max] of [["avatar", p.av, 60_000], ["banner", p.bn, 120_000]] as const) {
            if (typeof v !== "string") continue;
            if (v === "") patch[k] = undefined;
            else if (v.startsWith("data:image/jpeg;base64,") && v.length <= max && !(await dataUrlIsBlocked(v))) patch[k] = v;
          }
          const sid = row.sender_id;
          update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === sid ? { ...c, ...patch } : c)) }));
        } else if (p.t === "call") {
          if (p.gid) {
            const group = localRef.current!.groups.find((g) => g.id === p.gid);
            const senderRole = group?.roles?.find((r) => r.id === (group.memberRoles?.[row.sender_id] ?? "everyone"));
            const receiverRole = group?.roles?.find((r) => r.id === (group.memberRoles?.[keys.userId] ?? "everyone"));
            const senderCanCall = row.sender_id === group?.owner || !!senderRole?.permissions.includes("voice_call");
            const receiverCanCall = keys.userId === group?.owner || !!receiverRole?.permissions.includes("voice_call");
            const allowed = ["reject", "end"].includes(p.op ?? "") || (senderCanCall && receiverCanCall);
            if (group && !group.requested && group.members.includes(row.sender_id) && !contact.requested && allowed) {
              void callRef.current?.handle(row.sender_id, p as never, row.sent_at);
            }
          } else if (!contact.requested) void callRef.current?.handle(row.sender_id, p as never, row.sent_at);
        } else if (p.t === "ginv") {
          const gid = String(p.gid ?? "");
          const me = keys.userId;
          if (!/^[0-9a-f-]{36}$/.test(gid) || typeof p.name !== "string" || !Array.isArray(p.members) || p.members.length > 30 || !p.members.every((m) => ID_RE.test(m))) throw new Error("grupo");
          const ex = localRef.current!.groups.find((g) => g.id === gid);
          if (ex && ex.owner !== row.sender_id) throw new Error("não é o dono");
          if (!p.members.includes(me)) {
            update((s) => ({ ...s, groups: s.groups.filter((g) => g.id !== gid), messages: s.messages.filter((m) => m.peer !== `g:${gid}`) }));
          } else {
            const ttl = TTLS.has(p.ttl ?? 0) ? (p.ttl ?? 0) : 0;
            const members = [...new Set(p.members)];
            const rawRoles = Array.isArray(p.roles) ? p.roles.slice(0, 16) : [];
            const roles = rawRoles.filter((r) =>
              r && /^[a-z0-9_-]{1,32}$/.test(r.id) && typeof r.name === "string" && r.name.length <= 32 &&
              Array.isArray(r.permissions) && r.permissions.length <= 8 &&
              r.permissions.every((x) => ["view_audit", "send_messages", "voice_call"].includes(x)),
            ).map((r) => r.id === "everyone" ? { id: "everyone", name: "@Everyone", permissions: [] } : r);
            if (!roles.some((r) => r.id === "everyone")) roles.unshift({ id: "everyone", name: "@Everyone", permissions: [] });
            const roleIds = new Set(roles.map((r) => r.id));
            const memberRoles = Object.fromEntries(members.map((m) => {
              const id = p.memberRoles?.[m];
              return [m, id && roleIds.has(id) ? id : "everyone"];
            }));
            const autoRole = p.autoRole && roleIds.has(p.autoRole) ? p.autoRole : "everyone";
            const audit = (p.auditAllowed === false ? [] : Array.isArray(p.audit) ? p.audit.slice(-200) : []).filter((a) =>
              a && typeof a.id === "string" && typeof a.actor === "string" && typeof a.action === "string" &&
              Number.isFinite(a.ts) && a.action.length <= 80 && (!a.target || a.target.length <= 100),
            );
            const description = typeof p.description === "string" ? p.description.slice(0, 500) : "";
            const g: Group = {
              id: gid, name: p.name.slice(0, 40), owner: ex?.owner ?? row.sender_id, members, ttl,
              addedAt: ex?.addedAt ?? Date.now(), requested: ex ? ex.requested : !!contact.requested,
              description,
              roles,
              memberRoles,
              autoRole,
              audit,
            };
            for (const [field, value, max] of [["avatar", p.av, 90_000], ["banner", p.bn, 130_000]] as const) {
              if (typeof value !== "string") continue;
              if (!value) g[field] = undefined;
              else if (value.startsWith("data:image/jpeg;base64,") && value.length <= max && !(await dataUrlIsBlocked(value))) g[field] = value;
            }
            update((s) => ({ ...s, groups: ex ? s.groups.map((x) => (x.id === gid ? g : x)) : [...s.groups, g] }));
          }
        } else if (p.t === "gleave") {
          const gid = String(p.gid ?? "");
          const sid = row.sender_id;
          update((s) => ({ ...s, groups: s.groups.map((g) => {
            if (g.id !== gid || !g.members.includes(sid)) return g;
            return {
              ...g,
              members: g.members.filter((m) => m !== sid),
              audit: g.owner === keys.userId ? [...(g.audit ?? []), { id: crypto.randomUUID(), actor: sid, action: "Saiu do grupo", ts: Date.now() }].slice(-200) : g.audit,
            };
          }) }));
        } else if ((p.t === "msg" || p.t === "gmsg") && typeof p.id === "string") {
          const thread = p.t === "gmsg" ? `g:${p.gid}` : row.sender_id;
          if (p.t === "gmsg") {
            const g = localRef.current!.groups.find((x) => x.id === p.gid);
            if (!g || !g.members.includes(row.sender_id)) throw new Error("não é membro");
            const senderRole = g.roles?.find((r) => r.id === (g.memberRoles?.[row.sender_id] ?? "everyone"));
            if (row.sender_id !== g.owner && !senderRole?.permissions.includes("send_messages")) throw new Error("cargo sem permissão para enviar");
          }
          if (localRef.current!.messages.some((m) => m.id === p.id && m.peer === thread && (m.from ?? m.peer) === row.sender_id)) throw new Error("duplicada");
          const ttl = TTLS.has(p.ttl ?? 0) ? (p.ttl ?? 0) : 0;
          const msg: Msg = {
            id: p.id, peer: thread, from: row.sender_id, dir: "in", kind: p.kind === "image" ? "image" : p.kind === "audio" ? "audio" : p.kind === "file" ? "file" : "text",
            ts: row.sent_at, ttl,
            frank: { key: env.k, tag: toB64(tag), sig: toB64(sig), mac: toB64(hexToBytes(row.server_mac)), sentAt: row.sent_at, payload: env.payload },
          };
          if (msg.kind === "text") {
            if (typeof p.text !== "string" || p.text.length > MAX_TEXT) throw new Error("texto");
            msg.text = p.text;
          } else if (msg.kind === "audio") {
            if (typeof p.audio !== "string" || !/^data:audio\/(webm|ogg|mp4);base64,/.test(p.audio) || p.audio.length > 200_000) throw new Error("áudio");
            msg.audio = p.audio;
            msg.dur = Math.max(0, Math.min(60, Number(p.dur) || 0));
            if (Array.isArray(p.wave)) msg.wave = p.wave.slice(0, 64).map((x: unknown) => Math.max(0, Math.min(31, Math.round(Number(x) || 0))));
          } else if (msg.kind === "file") {
            const f = p.file as Record<string, unknown> | undefined;
            const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
            if (!f || !str(f.id, 40) || !/^[0-9a-f-]{36}$/.test(f.id as string) || !str(f.key, 64) || !str(f.nonce, 64) || !str(f.hash, 64)
              || !str(f.name, 200) || !str(f.mime, 100) || typeof f.size !== "number" || f.size <= 0 || f.size > 26_214_400) throw new Error("arquivo");
            if (f.thumb !== undefined && (!str(f.thumb, 60_000) || !(f.thumb as string).startsWith("data:image/jpeg;base64,"))) throw new Error("capa");
            if (typeof f.thumb === "string" && (await dataUrlIsBlocked(f.thumb))) { setNotice("Um vídeo recebido foi bloqueado pelo filtro de segurança e descartado."); throw new Error("hash"); }
            msg.file = {
              id: f.id as string, key: f.key as string, nonce: f.nonce as string, hash: f.hash as string,
              name: (f.name as string).replace(/[\u0000-\u001f\u202e/\\]/g, "_"), mime: (f.mime as string).toLowerCase(), size: f.size,
              thumb: f.thumb as string | undefined, dur: Math.max(0, Math.min(36000, Number(f.dur) || 0)) || undefined,
              w: Number(f.w) || undefined, h: Number(f.h) || undefined, voice: f.voice === true,
              expiresAt: typeof f.expiresAt === "string" && Number.isFinite(Date.parse(f.expiresAt)) ? f.expiresAt : undefined,
            };
            if (typeof p.text === "string") msg.text = p.text.slice(0, 1000);
          } else {
            if (typeof p.image !== "string" || !p.image.startsWith("data:image/jpeg;base64,") || p.image.length > 300_000) throw new Error("imagem");
            if (await dataUrlIsBlocked(p.image)) {
              setNotice("Uma imagem recebida foi bloqueada pelo filtro de segurança e descartada.");
              throw new Error("hash");
            }
            msg.image = p.image;
            if (typeof p.text === "string") msg.text = p.text.slice(0, 1000);
          }
          if (p.rt && typeof p.rt.id === "string" && typeof p.rt.text === "string") msg.reply = { id: p.rt.id, text: p.rt.text.slice(0, 120) };
          if (p.t === "gmsg" && Array.isArray(p.mentions)) {
            const members = localRef.current!.groups.find((g) => g.id === p.gid)?.members ?? [];
            msg.mentions = [...new Set(p.mentions.filter((id) => typeof id === "string" && members.includes(id)))].slice(0, 20);
          }
          update((s) => {
            const matching = (s.pendingReactions ?? []).filter((e) => e.peer === msg.peer && e.id === msg.id && e.author === row.sender_id);
            return { ...s, messages: [...s.messages, matching.reduce(applyReaction, msg)], pendingReactions: (s.pendingReactions ?? []).filter((e) => !matching.includes(e)) };
          });
        }
      } catch {
        /* descarta */
      } finally {
        if (drop) {
          try {
            if (!ephemeral) await flush(); // grava localmente ANTES de apagar do servidor
            await sess.ack(row.id);
          } catch {
            seen.current.delete(row.id);
          }
        }
      }
    },
    [flush, update],
  );

  const enqueue = useCallback(
    (rows: RelayRow[]) => {
      chain.current = chain.current.then(async () => {
        for (const r of rows) await processRow(r);
      });
    },
    [processRow],
  );

  const poll = useCallback(async () => {
    const s = sessRef.current;
    if (!s) return;
    try {
      const rows = await s.fetchPending();
      fails.current = 0;
      setOnline(true);
      if (rows.length) enqueue(rows);
    } catch {
      // um tropeço isolado não derruba o status; só marca offline após 2 falhas seguidas
      if (++fails.current >= 2) setOnline(false);
    }
  }, [enqueue]);

  // Sincronização cifrada com controle de versão. Conflitos nunca sobrescrevem silenciosamente.
  const profileSyncRunning = useRef(false);
  const syncProfile = useCallback(async (choice?: "local" | "server") => {
    if (profileSyncRunning.current) return;
    const sess = sessRef.current, keys = keysRef.current, initial = localRef.current;
    if (!sess || !keys || !initial) return;
    profileSyncRunning.current = true;
    try {
      const withAuth = async <T,>(fn: (jwt: string) => Promise<T>): Promise<T> => {
        try { return await fn(sess.getJwt()); }
        catch (e) { if (!(e instanceof ApiError) || e.status !== 401) throw e; await sess.refresh(); return fn(sess.getJwt()); }
      };
      const startingFingerprint = profileFingerprint(initial.profile);
      const remote = await withAuth(getProfileSnapshot);
      if (sessRef.current !== sess || keysRef.current !== keys || !localRef.current) return;
      if (remote && (!Number.isSafeInteger(remote.revision) || remote.revision < 1)) throw new Error("Versão de perfil inválida");
      const remoteProfile = remote ? await decryptProfile(keys, remote) : null;
      if (sessRef.current !== sess || keysRef.current !== keys || !localRef.current) return;
      let current = localRef.current;
      const meta = current.profileSync ?? { revision: 0, dirty: !!current.profile.name };
      const remoteRev = remote?.revision ?? 0;
      const applyRemote = () => {
        if (!remoteProfile || !remote) throw new Error("Não há perfil remoto para restaurar.");
        update((state) => ({ ...state, profile: { ...state.profile, name: remoteProfile.name, avatar: remoteProfile.avatar, banner: remoteProfile.banner },
          profileSync: { revision: remote.revision, dirty: false }, contacts: state.contacts.map((c) => ({ ...c, profSent: false })) }));
        const pr = localRef.current?.profile;
        if (pr) for (const c of localRef.current?.contacts ?? []) if (!c.blocked && !c.requested)
          void signalRef.current(c.id, JSON.stringify({ t: "prof", n: pr.name, an: pr.appNumber, av: pr.avatar ?? "", bn: pr.banner ?? "" })).catch(() => {});
      };
      if (choice === "server") {
        if (profileFingerprint(current.profile) !== startingFingerprint) throw new Error("O perfil mudou durante a escolha. Tente novamente.");
        applyRemote(); return;
      }
      if (!choice && meta.conflict) return;
      if (meta.dirty || choice === "local") {
        if (!choice && remoteRev !== meta.revision) {
          if (remoteProfile && profileFingerprint({ ...current.profile, ...remoteProfile, avatar: remoteProfile.avatar, banner: remoteProfile.banner }) === profileFingerprint(current.profile)) {
            update((state) => ({ ...state, profileSync: { revision: remoteRev, dirty: false } }));
          } else update((state) => ({ ...state, profileSync: { ...meta, conflict: true } }));
          return;
        }
        const expected = choice === "local" ? remoteRev : meta.revision;
        current = localRef.current!;
        const fingerprint = profileFingerprint(current.profile);
        const cipher = await encryptProfile(keys, current.profile);
        if (sessRef.current !== sess || keysRef.current !== keys) return;
        try {
          const revision = await withAuth((jwt) => putProfileSnapshot(jwt, expected, cipher.nonce, cipher.ciphertext));
          if (sessRef.current !== sess || keysRef.current !== keys || !localRef.current) return;
          if (!Number.isSafeInteger(revision) || revision <= expected) throw new Error("Versão de perfil inválida");
          update((state) => ({ ...state, profileSync: { revision, dirty: profileFingerprint(state.profile) !== fingerprint } }));
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && sessRef.current === sess) {
            update((state) => ({ ...state, profileSync: { ...(state.profileSync ?? meta), dirty: true, conflict: true } }));
            return;
          }
          throw e;
        }
      } else if (remote && remoteRev !== meta.revision) {
        // Caso a pessoa tenha começado a editar durante a consulta, não descarte a alteração.
        if (profileFingerprint(current.profile) !== startingFingerprint) return;
        applyRemote();
      } else if (!remote && meta.revision > 0) {
        update((state) => ({ ...state, profileSync: { ...meta, dirty: true, conflict: true } }));
      }
    } catch (e) {
      if (sessRef.current === sess) setNotice(`Sincronização de perfil pendente: ${errMsg(e)}`);
    } finally { profileSyncRunning.current = false; }
  }, [update]);

  const stopSession = useCallback(() => {
    window.clearTimeout(pollTimer.current);
    live.current = false;
    sessRef.current?.stop();
    sessRef.current = null;
    setOnline(false);
    setActivity({});
    setTyping({});
  }, []);

  const beginSession = useCallback(
    async (keys: Keys) => {
      stopSession();
      const s = await startSession(keys);
      sessRef.current = s;
      void syncProfile();
      if (s.appNumber && localRef.current?.profile.appNumber !== s.appNumber) {
        update((state) => ({ ...state, profile: { ...state.profile, appNumber: s.appNumber! } }));
      }
      s.subscribe((r) => enqueue([r]), (ok) => { live.current = ok; if (ok) void poll(); });
      await poll();
      fails.current = 0;
      setOnline(true);
      // Sincronização leve: com o tempo real ativo basta conferir de vez em quando; sem ele, a cada 5s.
      // Aba em segundo plano pausa (economiza bateria e requisições).
      const tick = () => {
        pollTimer.current = window.setTimeout(async () => {
          if (sessRef.current !== s) return; // sessão trocada/encerrada: este laço morre
          if (document.visibilityState === "visible" || !live.current) await poll();
          if (sessRef.current === s) tick();
        }, live.current ? 25_000 : 5_000);
      };
      tick();
    },
    [enqueue, poll, stopSession, update, syncProfile],
  );

  useEffect(() => {
    if (phase !== "app") return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void syncProfile(); }, 20_000);
    const wake = () => { if (document.visibilityState === "visible") void syncProfile(); };
    document.addEventListener("visibilitychange", wake);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", wake); };
  }, [phase, syncProfile]);
  useEffect(() => {
    if (phase !== "app" || !local?.profileSync?.dirty || local.profileSync.conflict) return;
    const timer = window.setTimeout(() => void syncProfile(), 800);
    return () => window.clearTimeout(timer);
  }, [phase, local?.profileSync?.dirty, local?.profileSync?.conflict, local?.profile.name, local?.profile.avatar, local?.profile.banner, syncProfile]);

  // ---------- boot / expiração ----------
  useEffect(() => {
    void loadBlocklist();
    void vaultExists().then((e) => setPhase(e ? "locked" : "welcome"));
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();
      const cur = localRef.current;
      if (cur && cur.messages.some((m) => m.expiresAt && m.expiresAt <= now)) {
        update((s) => ({ ...s, messages: s.messages.filter((m) => !m.expiresAt || m.expiresAt > now) }));
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [update]);

  // ---------- conta ----------
  const enter = useCallback(
    async (state: LocalState, handle: VaultHandle, keys: Keys) => {
      localRef.current = state;
      vaultRef.current = handle;
      keysRef.current = keys;
      setLocal(state);
      setUserId(keys.userId);
      try {
        await beginSession(keys);
      } catch (e) {
        setNotice(`Modo offline: ${errMsg(e)}`);
      }
      setPhase("app");
    },
    [beginSession],
  );

  const createAccount = useCallback(
    async (name: string, pass: string) => {
      setBusy(true);
      setError(null);
      try {
        const m = newMnemonic();
        const keys = await keysFromMnemonic(m);
        const state = emptyState(m, name.trim().slice(0, 40));
        const handle = await createVault(pass, state);
        localRef.current = state;
        vaultRef.current = handle;
        keysRef.current = keys;
        setLocal(state);
        setUserId(keys.userId);
        try {
          await beginSession(keys);
        } catch (e) {
          await wipeVault();
          localRef.current = null;
          vaultRef.current = null;
          keysRef.current = null;
          setLocal(null);
          throw e;
        }
        if (!localRef.current?.profile.appNumber) setNotice("Conta criada. O número exclusivo do app aparecerá após a configuração do servidor.");
        setOnb(m);
        setPhase("app");
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [beginSession],
  );

  const restoreAccount = useCallback(
    async (mnemonic: string, pass: string) => {
      setBusy(true);
      setError(null);
      try {
        if (!isValidMnemonic(mnemonic)) throw new Error("Frase de recuperação inválida");
        const m = normalizeMnemonic(mnemonic);
        const keys = await keysFromMnemonic(m);
        const state = emptyState(m);
        state.settings.backupDone = true;
        state.settings.phoneMigrationRequired = true;
        const handle = await createVault(pass, state);
        await enter(state, handle, keys);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [enter],
  );

  const unlock = useCallback(
    async (pass: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = await openVault(pass);
        if (!r) throw new Error("Senha incorreta");
        const keys = await keysFromMnemonic(r.state.mnemonic);
        await enter(migrate(r.state), r.handle, keys);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [enter],
  );

  const lock = useCallback(() => {
    void callRef.current?.hangup();
    void flush().finally(() => {
      stopSession();
      localRef.current = null;
      vaultRef.current = null;
      keysRef.current = null;
      seen.current.clear();
      setLocal(null);
      setUserId(null);
      setPhase("locked");
    });
  }, [flush, stopSession]);

  const reconnect = useCallback(async () => {
    const keys = keysRef.current;
    if (!keys) return;
    try {
      await beginSession(keys);
      setNotice(null);
    } catch (e) {
      setNotice(`Modo offline: ${errMsg(e)}`);
    }
  }, [beginSession]);

  // Reconecta sozinho quando a internet volta ou a aba é reaberta.
  useEffect(() => {
    const wake = () => {
      if (!keysRef.current) return;
      if (document.visibilityState === "hidden") return;
      if (sessRef.current) void poll();
      else void reconnect();
    };
    const back = () => { fails.current = 0; wake(); };
    window.addEventListener("online", back);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("online", back);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [poll, reconnect]);

  // ---------- contatos ----------
  const addContact = useCallback(
    async (idRaw: string, alias: string) => {
      const id = idRaw.trim().toLowerCase();
      if (!ID_RE.test(id)) throw new Error("ID inválido (26 caracteres)");
      if (id === keysRef.current?.userId) throw new Error("Esse é o seu próprio ID");
      const cur = localRef.current!.contacts.find((c) => c.id === id);
      if (cur) {
        update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === id ? { ...c, alias: alias || c.alias, requested: false } : c)) }));
        return;
      }
      const sess = sessRef.current;
      if (!sess) throw new Error("Sem conexão com o servidor");
      const peer = await fetchIdentity(sess.client, id);
      if (!peer) throw new Error("ID não encontrado");
      const c: Contact = { id, alias: alias || `Contato ${id.slice(0, 5)}`, idKey: toB64(peer.idKey), spk: toB64(peer.spk), ttl: 0, addedAt: Date.now() };
      update((s) => ({ ...s, contacts: [...s.contacts, c] }));
    },
    [update],
  );

  const renameContact = useCallback((id: string, alias: string) => update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === id ? { ...c, alias } : c)) })), [update]);
  const setBlocked = useCallback((id: string, blocked: boolean) => update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === id ? { ...c, blocked } : c)) })), [update]);
  const acceptContact = useCallback((id: string) => {
    update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === id ? { ...c, requested: false, profSent: false } : c)) }));
    void signalRef.current(id, JSON.stringify({ t: "prof-request" })).catch(() => {});
    const pr = localRef.current?.profile;
    if (pr) void signalRef.current(id, JSON.stringify({ t: "prof", n: pr.name, an: pr.appNumber, av: pr.avatar ?? "", bn: pr.banner ?? "" })).catch(() => {});
  }, [update]);
  const removeContact = useCallback((id: string) => update((s) => ({ ...s, contacts: s.contacts.filter((c) => c.id !== id), messages: s.messages.filter((m) => m.peer !== id) })), [update]);
  const setContactTtl = useCallback((id: string, ttl: number) => update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === id ? { ...c, ttl } : c)) })), [update]);
  const setAutolock = useCallback((min: number) => update((s) => ({ ...s, settings: { ...s.settings, autolockMin: min } })), [update]);

  const addContactByNumber = useCallback(
    async (rawNumber: string, alias: string) => {
      const appNumber = normalizeAppNumber(rawNumber);
      if (!appNumber) throw new Error("Número inválido. Use o formato 10259-5251");
      if (appNumber === localRef.current?.profile.appNumber) throw new Error("Esse é o seu próprio número");
      const sess = sessRef.current;
      if (!sess) throw new Error("Sem conexão com o servidor");
      const found = await lookupAppNumber(sess.getJwt(), appNumber);
      if (!found) throw new Error("Esse número não foi encontrado no SeuChatSeguro");
      if (found.userId === keysRef.current?.userId) throw new Error("Esse é o seu próprio número");
      const peer = await fetchIdentity(sess.client, found.userId);
      if (!peer) throw new Error("Contato indisponível");
      const exists = localRef.current!.contacts.find((c) => c.id === found.userId);
      if (exists) {
        update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === found.userId ? { ...c, appNumber, alias: alias || c.alias, requested: false } : c)) }));
        return;
      }
      const c: Contact = { id: found.userId, alias: alias || appNumber, appNumber, idKey: toB64(peer.idKey), spk: toB64(peer.spk), ttl: 0, addedAt: Date.now() };
      update((s) => ({ ...s, contacts: [...s.contacts, c] }));
    },
    [update],
  );

  const setProfileName = useCallback((name: string) => {
    const next = name.trim().slice(0, 40);
    update((s) => s.profile.name === next ? s : ({ ...s, profile: { ...s.profile, name: next }, profileSync: { ...(s.profileSync ?? { revision: 0 }), dirty: true }, contacts: s.contacts.map((c) => ({ ...c, profSent: false })) }));
    const pr = localRef.current?.profile;
    if (pr) for (const c of localRef.current?.contacts ?? []) if (!c.blocked && !c.requested)
      void signalRef.current(c.id, JSON.stringify({ t: "prof", n: pr.name, an: pr.appNumber, av: pr.avatar ?? "", bn: pr.banner ?? "" })).catch(() => {});
  }, [update]);
  const resolveProfileConflict = useCallback(async (choice: "local" | "server") => { await syncProfile(choice); }, [syncProfile]);
  const markBackupDone = useCallback(() => update((s) => ({ ...s, settings: { ...s.settings, backupDone: true } })), [update]);
  const setTheme = useCallback((theme: "auto" | "light" | "dark") => update((s) => ({ ...s, settings: { ...s.settings, theme } })), [update]);
  const deleteMessage = useCallback((id: string) => update((s) => ({ ...s, messages: s.messages.filter((m) => m.id !== id) })), [update]);

  const changePassword = useCallback(
    async (oldPass: string, newPass: string) => {
      if (newPass.length < 8) throw new Error("A nova senha precisa de pelo menos 8 caracteres");
      const ok = await openVault(oldPass);
      if (!ok) throw new Error("Senha atual incorreta");
      await flush();
      vaultRef.current = await createVault(newPass, localRef.current!);
    },
    [flush],
  );

  // ---------- envio ----------
  const transmit = useCallback(async (peer: string, payload: string) => {
    const sess = sessRef.current;
    const keys = keysRef.current;
    const contact = localRef.current?.contacts.find((c) => c.id === peer);
    if (!sess || !keys) throw new Error("Sem conexão com o servidor");
    let spk: Uint8Array;
    if (contact) spk = fromB64(contact.spk);
    else {
      const cached = peerCache.current.get(peer);
      if (cached) spk = cached;
      else {
        const id = await fetchIdentity(sess.client, peer);
        if (!id) throw new Error("Membro não encontrado");
        peerCache.current.set(peer, id.spk);
        spk = id.spk;
      }
    }
    await sodium.ready;
    const fr = await frankMessage(payload, peer, keys.idSec);
    const env = JSON.stringify({ payload, k: toB64(fr.frankKey), from: keys.userId });
    const sealed = sodium.crypto_box_seal(enc.encode(env), spk);
    try {
      return await sendMessage(sess.getJwt(), peer, sealed, fr.tag, fr.senderSig);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      await sess.refresh(); // token expirou: renova e tenta uma vez
      return sendMessage(sess.getJwt(), peer, sealed, fr.tag, fr.senderSig);
    }
  }, []);

  signalRef.current = transmit;
  const sendActivity = useCallback((peer: string, kind: "ping" | "typing") => {
    if (!sessRef.current || document.visibilityState !== "visible") return;
    const state = localRef.current;
    if (!state) return;
    const group = peer.startsWith("g:") ? state.groups.find((g) => g.id === peer.slice(2) && !g.requested) : undefined;
    if (peer.startsWith("g:") && !group) return;
    const targets = group ? group.members.filter((id) => id !== keysRef.current?.userId) : [peer];
    const payload = JSON.stringify({ t: kind === "ping" ? "activity" : "typing", op: kind, gid: group?.id });
    for (const id of targets) {
      const c = state.contacts.find((x) => x.id === id);
      if (c && !c.blocked && !c.requested) void transmit(id, payload).catch(() => {});
    }
  }, [transmit]);

  const sendReaction = useCallback(async (peer: string, msg: Msg, selected: string) => {
    const state = localRef.current, me = keysRef.current?.userId;
    if (!state || !me || !(REACTIONS as readonly string[]).includes(selected)) throw new Error("Reação inválida");
    const original = state.messages.find((m) => m.peer === peer && m.id === msg.id && (m.from ?? m.peer) === (msg.from ?? msg.peer));
    if (!original || original.pending) throw new Error("Mensagem indisponível");
    const group = peer.startsWith("g:") ? state.groups.find((g) => g.id === peer.slice(2) && !g.requested && g.members.includes(me)) : undefined;
    const contact = !peer.startsWith("g:") ? state.contacts.find((c) => c.id === peer && !c.blocked && !c.requested) : undefined;
    if (!group && !contact) throw new Error("Conversa indisponível");
    if (group && me !== group.owner && !group.roles?.find((r) => r.id === (group.memberRoles?.[me] ?? "everyone"))?.permissions.includes("send_messages")) throw new Error("Seu cargo não permite enviar mensagens");
    const blocked = new Set(state.contacts.filter((c) => c.blocked).map((c) => c.id));
    const targets = group ? group.members.filter((id) => id !== me && !blocked.has(id)) : [peer];
    if (!targets.length) throw new Error("Nenhum destinatário disponível");
    const emoji = original.reactions?.[me]?.emoji === selected ? "" : selected;
    const author = original.from ?? original.peer;
    const payload = JSON.stringify({t:"reaction", gid:group?.id, id:original.id, author, emoji});
    const sent = await Promise.allSettled(targets.map((id) => transmit(id, payload)));
    const ok = sent.filter((r): r is PromiseFulfilledResult<{sentAt: number}> => r.status === "fulfilled");
    if (!ok.length) throw new Error("Não foi possível enviar a reação");
    const event: ReactionEvent = {peer, id:original.id, author, actor:me, emoji, ts:Math.max(...ok.map((r) => r.value.sentAt || Date.now()))};
    update((s) => ({...s, messages:s.messages.map((m) => applyReaction(m,event))}));
    if (ok.length !== sent.length) throw new Error("Alguns participantes podem não ter recebido a reação.");
  }, [transmit, update]);

  const sendProfile = useCallback(
    async (peer: string) => {
      const pr = localRef.current?.profile;
      if (!pr) return;
      await transmit(peer, JSON.stringify({ t: "prof", n: pr.name || undefined, an: pr.appNumber || undefined, av: pr.avatar ?? "", bn: pr.banner ?? "" }));
      update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === peer ? { ...c, profSent: true } : c)) }));
    },
    [transmit, update],
  );

  const sendBody = useCallback(
    async (peer: string, kind: "text" | "image" | "audio" | "file", text: string | undefined, image: string | undefined, reply?: Msg, audio?: string, dur?: number, mentions?: string[], extra?: { file?: FileRef; wave?: number[]; authorizedRecipients?: string[] }) => {
      const me = keysRef.current!.userId;
      const isGroup = peer.startsWith("g:");
      const contact = isGroup ? undefined : localRef.current?.contacts.find((c) => c.id === peer);
      const group = isGroup ? localRef.current?.groups.find((g) => g.id === peer.slice(2)) : undefined;
      if (isGroup ? !group : !contact) throw new Error("Conversa não encontrada");
      if (contact?.blocked) throw new Error("Contato bloqueado");
      if (group && me !== group.owner) {
        const role = group.roles?.find((r) => r.id === (group.memberRoles?.[me] ?? "everyone"));
        if (!role?.permissions.includes("send_messages")) throw new Error("Seu cargo não permite enviar mensagens neste grupo");
      }
      const ttl = group ? group.ttl : contact!.ttl;
      const blocked = new Set((localRef.current?.contacts ?? []).filter((c) => c.blocked).map((c) => c.id));
      const targets = group ? group.members.filter((m) => m !== me && !blocked.has(m)) : [peer];
      if (!targets.length) throw new Error("Não há outros membros no grupo");
      if (extra?.authorizedRecipients && [...new Set(targets)].sort().join(",") !== [...extra.authorizedRecipients].sort().join(",")) throw new Error("Os destinatários mudaram durante o envio. Envie o anexo novamente.");
      const validMentions = group ? [...new Set((mentions ?? []).filter((id) => group.members.includes(id)))].slice(0, 20) : [];
      const id = crypto.randomUUID();
      const ts = Date.now();
      const rt = reply ? { id: reply.id, text: (reply.text ?? msgLabel(reply)).slice(0, 120) } : undefined;
      const payload = JSON.stringify({ t: group ? "gmsg" : "msg", gid: group?.id, id, kind, text, image, audio, dur, wave: extra?.wave, file: extra?.file, ttl, ts, n: localRef.current?.profile.name || undefined, rt, mentions: validMentions });
      const m: Msg = { id, peer, from: me, dir: "out", kind, text, image, audio, dur, wave: extra?.wave, file: extra?.file, ts, ttl, reply: rt, mentions: validMentions, pending: true };
      // Mostra a mensagem imediatamente; a criptografia e o relay seguem em segundo plano.
      update((s) => ({ ...s, messages: [...s.messages, m] }));
      try {
        // Em grupos, não prendemos a confirmação ao membro mais lento: basta um envio aceito.
        const sent = await Promise.any(targets.map((t) => transmit(t, payload)));
        update((s) => ({
          ...s,
          messages: s.messages.map((msg) => msg.id === id ? { ...msg, ts: sent.sentAt ?? ts, pending: false } : msg),
        }));
      } catch (e) {
        const reason = e instanceof AggregateError ? e.errors[0] : e;
        update((s) => ({ ...s, messages: s.messages.filter((msg) => msg.id !== id) }));
        throw reason;
      }
      if (contact && !contact.profSent) void sendProfile(peer).catch(() => {});
    },
    [transmit, update, sendProfile],
  );

  const uploadFile = useCallback(async (peer: string, data: Uint8Array, kind: "video" | "file", onProgress?: (p: number) => void) => {
    const sess = sessRef.current;
    if (!sess) throw new Error("Sem conexão com o servidor");
    const state = localRef.current, me = keysRef.current?.userId;
    if (!state || !me) throw new Error("Sessão indisponível");
    const group = peer.startsWith("g:") ? state.groups.find((g) => g.id === peer.slice(2)) : undefined;
    const contact = !peer.startsWith("g:") ? state.contacts.find((c) => c.id === peer) : undefined;
    if (!group && !contact) throw new Error("Conversa não encontrada");
    if (contact?.blocked) throw new Error("Contato bloqueado");
    if (group && me !== group.owner && !group.roles?.find((r) => r.id === (group.memberRoles?.[me] ?? "everyone"))?.permissions.includes("send_messages")) throw new Error("Seu cargo não permite enviar mensagens neste grupo");
    const blocked = new Set(state.contacts.filter((c) => c.blocked).map((c) => c.id));
    const recipients = group ? [...new Set(group.members.filter((id) => id !== me && !blocked.has(id)))] : [peer];
    if (!recipients.length || recipients.length > 100) throw new Error("É necessário de 1 a 100 destinatários para enviar anexos.");
    try { return { ...(await uploadEncrypted(sess.getJwt(), data, kind, recipients, onProgress)), recipients }; }
    catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      await sess.refresh();
      return { ...(await uploadEncrypted(sess.getJwt(), data, kind, recipients, onProgress)), recipients };
    }
  }, []);

  const sendAudio = useCallback(
    async (peer: string, rec: { dataUrl: string; blob: Blob; mime: string; dur: number; wave: number[] }, onProgress?: (p: number) => void) => {
      if (rec.dur <= 60 && rec.dataUrl.length <= 200_000) {
        await sendBody(peer, "audio", undefined, undefined, undefined, rec.dataUrl, rec.dur, undefined, { wave: rec.wave });
        return;
      }
      const { recipients, ...up } = await uploadFile(peer, new Uint8Array(await rec.blob.arrayBuffer()), "file", onProgress);
      const file: FileRef = { ...up, name: "mensagem-de-voz.webm", mime: rec.mime, size: rec.blob.size, dur: rec.dur, voice: true };
      await sendBody(peer, "file", undefined, undefined, undefined, undefined, undefined, undefined, { file, wave: rec.wave, authorizedRecipients: recipients });
    },
    [sendBody, uploadFile],
  );

  const sendFile = useCallback(
    async (peer: string, f: File, onProgress?: (p: number) => void) => {
      if (f.size > MAX_FILE - 64) throw new Error("Arquivo grande demais (máximo 25 MB).");
      const mime = (f.type || "application/octet-stream").toLowerCase();
      if (mime.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp|heic|avif)$/i.test(f.name)) throw new Error("Envie imagens pela opção Foto.");
      const isVideo = mime.startsWith("video/");
      if (!isVideo && /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(f.name)) throw new Error("Selecione um vídeo em formato compatível pela opção Vídeo.");
      let info: { thumb?: string; dur?: number; w?: number; h?: number } = {};
      if (isVideo) {
        if (!imageSendingAllowed()) throw new Error("Envio de vídeos indisponível: a lista de segurança não foi configurada.");
        if (await videoFramesBlocked(f)) throw new Error("Este arquivo viola as regras da plataforma e não pode ser enviado.");
        info = await videoInfo(f).catch(() => ({}));
      }
      const { recipients, ...up } = await uploadFile(peer, new Uint8Array(await f.arrayBuffer()), isVideo ? "video" : "file", onProgress);
      const file: FileRef = { ...up, name: f.name.slice(0, 200) || "arquivo", mime, size: f.size, ...info };
      await sendBody(peer, "file", undefined, undefined, undefined, undefined, undefined, undefined, { file, authorizedRecipients: recipients });
    },
    [sendBody, uploadFile],
  );

  const fetchNews = useCallback(async (cat: string) => {
    const sess = sessRef.current;
    if (!sess) throw new Error("Sem conexão com o servidor");
    try { return await getNews(sess.getJwt(), cat); }
    catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      await sess.refresh();
      return getNews(sess.getJwt(), cat);
    }
  }, []);

  const downloadFile = useCallback(async (f: FileRef, onProgress?: (p: number) => void) => {
    const sess = sessRef.current;
    if (!sess) throw new Error("Sem conexão com o servidor");
    try { return await downloadDecrypted(sess.getJwt(), f, onProgress); }
    catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      await sess.refresh();
      return downloadDecrypted(sess.getJwt(), f, onProgress);
    }
  }, []);

  const setProfileImages = useCallback(
    (avatar?: string | null, banner?: string | null) => {
      update((s) => {
        const pr = { ...s.profile };
        if (avatar !== undefined) pr.avatar = avatar ?? undefined;
        if (banner !== undefined) pr.banner = banner ?? undefined;
        return { ...s, profile: pr, profileSync: { ...(s.profileSync ?? { revision: 0 }), dirty: true }, contacts: s.contacts.map((c) => ({ ...c, profSent: false })) };
      });
      for (const c of localRef.current?.contacts ?? []) if (!c.blocked && !c.requested) void sendProfile(c.id).catch(() => {});
    },
    [update, sendProfile],
  );

  // ---------- grupos (fan-out: cada mensagem é cifrada individualmente para cada membro) ----------
  const broadcastGroup = useCallback(
    async (g: Group, also: string[] = []) => {
      const me = keysRef.current!.userId;
      const roles = g.roles?.length ? g.roles : [{ id: "everyone", name: "@Everyone", permissions: [] }];
      const body = (target: string, members: string[]) => {
        const roleId = g.memberRoles?.[target] ?? "everyone";
        const role = roles.find((r) => r.id === roleId);
        const canViewAudit = target === g.owner || !!role?.permissions.includes("view_audit");
        return JSON.stringify({
          t: "ginv", gid: g.id, name: g.name, members, ttl: g.ttl, n: localRef.current?.profile.name || undefined,
          description: g.description ?? "", av: g.avatar ?? "", bn: g.banner ?? "",
          roles, memberRoles: g.memberRoles ?? {}, autoRole: g.autoRole ?? "everyone",
          auditAllowed: canViewAudit, audit: canViewAudit ? (g.audit ?? []).slice(-200) : [],
        });
      };
      const results = await Promise.allSettled([
        ...g.members.filter((m) => m !== me).map((m) => transmit(m, body(m, g.members))),
        ...also.map((m) => transmit(m, body(m, g.members))), // removidos recebem lista sem eles e apagam o grupo
      ]);
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("O grupo foi salvo neste aparelho, mas alguns membros não receberam a atualização. Verifique a conexão e salve novamente.");
      }
    },
    [transmit],
  );

  const createGroup = useCallback(
    async (name: string, members: string[]) => {
      const me = keysRef.current!.userId;
      const list = [...new Set(members)].filter((m) => m !== me);
      if (!name.trim()) throw new Error("Dê um nome ao grupo");
      if (list.length < 1 || list.length > 19) throw new Error("Escolha de 1 a 19 contatos");
      const all = [me, ...list];
      const g: Group = {
        id: crypto.randomUUID(), name: name.trim().slice(0, 40), owner: me, members: all, ttl: 0, addedAt: Date.now(),
        roles: [{ id: "everyone", name: "@Everyone", permissions: [] }],
        memberRoles: Object.fromEntries(all.map((id) => [id, "everyone"])),
        autoRole: "everyone",
        audit: [{ id: crypto.randomUUID(), actor: me, action: "Grupo criado", ts: Date.now() }],
      };
      update((s) => ({ ...s, groups: [...s.groups, g] }));
      await broadcastGroup(g);
      return g.id;
    },
    [update, broadcastGroup],
  );

  const updateGroup = useCallback(
    async (gid: string, patch: Partial<Pick<Group, "name" | "members" | "ttl" | "description" | "avatar" | "banner" | "roles" | "memberRoles" | "autoRole">>) => {
      const me = keysRef.current!.userId;
      const g = localRef.current?.groups.find((x) => x.id === gid);
      if (!g || g.owner !== me) throw new Error("Só quem criou o grupo pode alterá-lo");
      const members = patch.members ? [me, ...new Set(patch.members.filter((m) => m !== me))] : g.members;
      if (members.length > 20) throw new Error("Máximo de 20 membros");
      const roles = (patch.roles ?? g.roles ?? [{ id: "everyone", name: "@Everyone", permissions: [] }]).map((role) => ({
        ...role,
        name: role.id === "everyone" ? "@Everyone" : role.name.trim(),
        permissions: role.id === "everyone" ? [] : [...new Set(role.permissions.filter((p) => ["view_audit", "send_messages", "voice_call"].includes(p)))],
      }));
      if (!roles.some((r) => r.id === "everyone")) throw new Error("@Everyone precisa continuar existindo");
      if (roles.length > 16 || roles.some((r) => !/^[a-z0-9_-]{1,32}$/.test(r.id) || !r.name.trim() || r.name.length > 32)) throw new Error("Revise os cargos do grupo");
      const autoRole = patch.autoRole ?? g.autoRole ?? "everyone";
      if (!roles.some((r) => r.id === autoRole)) throw new Error("O cargo automático escolhido não existe");
      const memberRoles: Record<string, string> = {};
      for (const id of members) {
        const prev = patch.memberRoles?.[id] ?? g.memberRoles?.[id];
        memberRoles[id] = roles.some((r) => r.id === prev) ? prev! : autoRole;
      }
      const now = Date.now();
      const changes: Array<{ action: string; target?: string }> = [];
      if (patch.name !== undefined && patch.name.trim() !== g.name) changes.push({ action: "Nome do grupo alterado" });
      if (patch.description !== undefined && patch.description !== g.description) changes.push({ action: "Descrição alterada" });
      members.filter((id) => !g.members.includes(id)).forEach((id) => changes.push({ action: "Membro adicionado", target: id }));
      g.members.filter((id) => !members.includes(id)).forEach((id) => changes.push({ action: "Membro removido", target: id }));
      if (patch.roles !== undefined || patch.memberRoles !== undefined || patch.autoRole !== undefined) changes.push({ action: "Cargos e permissões atualizados" });
      if (patch.avatar !== undefined || patch.banner !== undefined) changes.push({ action: "Imagem ou banner do grupo alterado" });
      if (patch.ttl !== undefined && patch.ttl !== g.ttl) changes.push({ action: "Mensagens temporárias alteradas" });
      if (!changes.length) changes.push({ action: "Configurações atualizadas" });
      const audit: GroupAuditEntry[] = [
        ...(g.audit ?? []),
        ...changes.map((change) => ({ id: crypto.randomUUID(), actor: me, action: change.action, target: change.target, ts: now })),
      ].slice(-200);
      const ng: Group = {
        ...g,
        name: (patch.name ?? g.name).trim().slice(0, 40) || g.name,
        description: patch.description === undefined ? g.description : patch.description.slice(0, 500),
        avatar: patch.avatar === undefined ? g.avatar : patch.avatar || undefined,
        banner: patch.banner === undefined ? g.banner : patch.banner || undefined,
        members, ttl: patch.ttl ?? g.ttl,
        roles, memberRoles, autoRole, audit,
      };
      update((s) => ({ ...s, groups: s.groups.map((x) => (x.id === gid ? ng : x)) }));
      await broadcastGroup(ng, g.members.filter((m) => !members.includes(m)));
    },
    [update, broadcastGroup],
  );

  const leaveGroup = useCallback(
    async (gid: string) => {
      const me = keysRef.current!.userId;
      const g = localRef.current?.groups.find((x) => x.id === gid);
      update((s) => ({ ...s, groups: s.groups.filter((x) => x.id !== gid), messages: s.messages.filter((m) => m.peer !== `g:${gid}`) }));
      if (g && !g.requested) await Promise.allSettled(g.members.filter((m) => m !== me).map((m) => transmit(m, JSON.stringify({ t: "gleave", gid }))));
    },
    [update, transmit],
  );

  const acceptGroup = useCallback((gid: string) => update((s) => ({ ...s, groups: s.groups.map((g) => (g.id === gid ? { ...g, requested: false } : g)) })), [update]);
  const setCallRelayOnly = useCallback((on: boolean) => update((s) => ({ ...s, settings: { ...s.settings, callRelayOnly: on } })), [update]);

  const sendText = useCallback(
    async (peer: string, text: string, reply?: Msg, mentions?: string[]) => {
      const t = text.trim();
      if (!t) return;
      if (t.length > MAX_TEXT) throw new Error("Mensagem muito longa");
      await sendBody(peer, "text", t, undefined, reply, undefined, undefined, mentions);
    },
    [sendBody],
  );

  const sendImage = useCallback(
    async (peer: string, file: File) => {
      const r = await prepareImage(file);
      if (!r.ok) {
        const why = {
          blocked: "Este arquivo viola as regras da plataforma e não pode ser enviado.",
          invalid: "Arquivo de imagem inválido.",
          too_big: "Imagem grande demais.",
          disabled: "Envio de imagens desativado: lista de segurança indisponível.",
        }[r.reason];
        throw new Error(why);
      }
      await sendBody(peer, "image", undefined, r.dataUrl);
    },
    [sendBody],
  );

  const markRead = useCallback(
    (peer: string) => {
      const cur = localRef.current;
      if (!cur) return;
      if (peer.startsWith("g:")) {
        const gr = cur.groups.find((g) => g.id === peer.slice(2));
        if (!gr || gr.requested) return;
        const readAt = Date.now();
        if (cur.messages.some((m) => m.peer === peer && m.dir === "in" && !m.readAt))
          update((s) => ({ ...s, messages: s.messages.map((m) => (m.peer === peer && m.dir === "in" && !m.readAt ? { ...m, readAt, expiresAt: m.ttl ? readAt + m.ttl * 1000 : undefined } : m)) }));
        return;
      }
      const contact = cur.contacts.find((c) => c.id === peer);
      if (!contact || contact.requested || contact.blocked) return;
      const unread = cur.messages.filter((m) => m.peer === peer && m.dir === "in" && !m.readAt);
      if (!unread.length) return;
      const readAt = Date.now();
      const ids = unread.map((m) => m.id);
      update((s) => ({
        ...s,
        messages: s.messages.map((m) => (ids.includes(m.id) ? { ...m, readAt, expiresAt: m.ttl ? readAt + m.ttl * 1000 : undefined } : m)),
      }));
      void transmit(peer, JSON.stringify({ t: "read", ids })).catch(() => {});
    },
    [transmit, update],
  );

  // ---------- chamadas ----------
  useEffect(() => {
    const eng = new CallEngine(
      async (peer, sig) => { await transmit(peer, JSON.stringify(sig)); },
      setCall,
      () => !!localRef.current?.settings.callRelayOnly,
      async () => {
        const session = sessRef.current;
        if (!session) throw new Error("Sem conexão com o servidor");
        return getTurnIceServers(session.getJwt());
      },
      (gid) => localRef.current?.groups.find((g) => g.id === gid)?.members ?? [],
      () => keysRef.current?.userId ?? null,
    );
    callRef.current = eng;
    return () => { void eng.hangup(); };
  }, [transmit]);

  const startCall = useCallback(async (peer: string, video: boolean) => {
    const c = localRef.current?.contacts.find((x) => x.id === peer);
    if (!c || c.blocked || c.requested) throw new Error("Aceite o contato antes de ligar");
    await callRef.current!.start(peer, video);
  }, []);
  const startGroupCall = useCallback(async (gid: string, video: boolean) => {
    const group = localRef.current?.groups.find((g) => g.id === gid);
    const me = keysRef.current?.userId;
    if (!group || group.requested || !me || !group.members.includes(me)) throw new Error("Grupo indisponível para chamadas");
    const role = group.roles?.find((r) => r.id === (group.memberRoles?.[me] ?? "everyone"));
    if (me !== group.owner && !role?.permissions.includes("voice_call")) throw new Error("Seu cargo não permite iniciar chamadas em grupo");
    const peers = group.members.filter((id) => {
      if (id === me || localRef.current?.contacts.find((c) => c.id === id)?.blocked) return false;
      const memberRole = group.roles?.find((r) => r.id === (group.memberRoles?.[id] ?? "everyone"));
      return id === group.owner || !!memberRole?.permissions.includes("voice_call");
    });
    await callRef.current!.startGroup(gid, peers, video);
  }, []);
  const acceptCall = useCallback(() => callRef.current!.accept(), []);
  const rejectCall = useCallback(() => callRef.current!.reject(), []);
  const hangup = useCallback(() => callRef.current!.hangup(), []);
  const toggleMic = useCallback(() => callRef.current!.toggleMic(), []);
  const toggleCam = useCallback(() => callRef.current!.toggleCam(), []);
  const shareScreen = useCallback(() => callRef.current!.shareScreen(), []);
  const switchCamera = useCallback(() => callRef.current!.switchCamera(), []);

  // ---------- denúncia / exclusão ----------
  const report = useCallback(
    async (msg: Msg, category: ReportPayload["category"]) => {
      const sess = sessRef.current;
      if (!sess || !msg.frank || msg.dir !== "in") throw new Error("Esta mensagem não pode ser denunciada");
      const who = msg.from ?? msg.peer;
      await submitReport(sess.getJwt(), buildReport(who, category, msg.frank));
      update((s) => ({
        ...s,
        messages: s.messages.map((m) => (m.id === msg.id ? { ...m, reported: true } : m)),
        contacts: s.contacts.map((c) => (c.id === who ? { ...c, blocked: true } : c)),
      }));
    },
    [update],
  );

  const deleteAccount = useCallback(async () => {
    const sess = sessRef.current;
    if (sess) await apiDeleteAccount(sess.getJwt());
    stopSession();
    await wipeVault();
    localRef.current = null;
    vaultRef.current = null;
    keysRef.current = null;
    seen.current.clear();
    setLocal(null);
    setUserId(null);
    setPhase("welcome");
  }, [stopSession]);

  const value = useMemo<Ctx>(
    () => ({
      nodiaBusy, consentNodia, clearNodia, sendNodia, phase, local, userId, busy, error, notice, online, activity, typing, sendActivity, onboardingMnemonic,
      clearOnboarding: () => setOnb(null),
      clearNotice: () => setNotice(null),
      createAccount, addContactByNumber, setProfileName, resolveProfileConflict, changePassword, deleteMessage, markBackupDone, setTheme, restoreAccount, unlock, lock, reconnect,
      addContact, renameContact, setBlocked, acceptContact, removeContact, setContactTtl,
      sendReaction, sendText, sendImage, markRead, report, setAutolock, deleteAccount,
      sendAudio, sendFile, downloadFile, fetchNews, setProfileImages, createGroup, updateGroup, leaveGroup, acceptGroup, setCallRelayOnly,
      call, startCall, startGroupCall, acceptCall, rejectCall, hangup, toggleMic, toggleCam, shareScreen, switchCamera,
    }),
    [nodiaBusy, consentNodia, clearNodia, sendNodia, phase, local, userId, busy, error, notice, online, activity, typing, sendActivity, onboardingMnemonic, createAccount, addContactByNumber, setProfileName, resolveProfileConflict, changePassword, deleteMessage, markBackupDone, setTheme, restoreAccount, unlock, lock, reconnect,
      addContact, renameContact, setBlocked, acceptContact, removeContact, setContactTtl, sendReaction, sendText, sendImage, markRead, report, setAutolock, deleteAccount,
      sendAudio, sendFile, downloadFile, fetchNews, setProfileImages, createGroup, updateGroup, leaveGroup, acceptGroup, setCallRelayOnly,
      call, startCall, startGroupCall, acceptCall, rejectCall, hangup, toggleMic, toggleCam, shareScreen, switchCamera],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}

