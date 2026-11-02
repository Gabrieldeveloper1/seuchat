import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import sodium from "libsodium-wrappers-sumo";
import type { Contact, Group, GroupAuditEntry, GroupRole, LocalState, Msg } from "../types";
import { CallEngine, IDLE, type CallState } from "./callEngine";
import { ID_RE, dec, enc, fromB64, hexToBytes, toB64 } from "./util";
import { isValidMnemonic, keysFromMnemonic, newMnemonic, normalizeMnemonic, type Keys } from "./crypto";
import { normalizeAppNumber } from "./phone";
import { createVault, openVault, saveVault, vaultExists, wipeVault, type VaultHandle } from "./vault";
import { startSession, fetchIdentity, type RelayRow, type Session } from "./session";
import { ApiError, deleteAccount as apiDeleteAccount, lookupAppNumber, sendMessage, submitReport, getTurnIceServers } from "./api";
import { buildReport, frankMessage, verifyIncoming, type ReportPayload } from "./franking";
import { dataUrlIsBlocked, loadBlocklist, prepareImage } from "./imageFilter";

export type Phase = "boot" | "welcome" | "locked" | "app";

interface Ctx {
  phase: Phase;
  local: LocalState | null;
  userId: string | null;
  busy: boolean;
  error: string | null;
  notice: string | null;
  online: boolean;
  onboardingMnemonic: string | null;
  clearOnboarding(): void;
  clearNotice(): void;
  createAccount(name: string, pass: string): Promise<void>;
  addContactByNumber(appNumber: string, alias: string): Promise<void>;
  setProfileName(name: string): void;
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
  sendText(peer: string, text: string, reply?: Msg, mentions?: string[]): Promise<void>;
  sendImage(peer: string, file: File): Promise<void>;
  markRead(peer: string): void;
  report(msg: Msg, category: ReportPayload["category"]): Promise<void>;
  setAutolock(min: number): void;
  deleteAccount(): Promise<void>;
  sendAudio(peer: string, dataUrl: string, dur: number): Promise<void>;
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
  return { v: 1, mnemonic, profile: { name }, contacts: [], groups: [], messages: [], settings: { autolockMin: 10, theme: "auto", backupDone: false, phoneMigrationRequired: false } };
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

  // ---------- recebimento ----------
  const processRow = useCallback(
    async (row: RelayRow) => {
      const sess = sessRef.current;
      const keys = keysRef.current;
      if (!sess || !keys || seen.current.has(row.id)) return;
      seen.current.add(row.id);
      let drop = true; // apaga do servidor mesmo se for inválida
      try {
        await sodium.ready;
        const sealed = sodium.crypto_box_seal_open(hexToBytes(row.ciphertext), keys.spkPub, keys.spkSec);
        const env = JSON.parse(dec.decode(sealed)) as { payload: string; k: string; from: string };
        if (env.from !== row.sender_id || typeof env.payload !== "string") throw new Error("envelope");

        let contact = localRef.current!.contacts.find((c) => c.id === row.sender_id);
        if (contact?.blocked) throw new Error("bloqueado");
        if (!contact) {
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
          t: string; op?: string; id?: string; kind?: string; text?: string; image?: string; audio?: string; dur?: number; ttl?: number; ts?: number; ids?: string[];
          n?: string; an?: string; rt?: { id?: string; text?: string }; gid?: string; name?: string; members?: string[]; av?: string; bn?: string;
          description?: string; roles?: GroupRole[]; memberRoles?: Record<string, string>; autoRole?: string;
          audit?: GroupAuditEntry[]; auditAllowed?: boolean; mentions?: string[];
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

        if (p.t === "read" && Array.isArray(p.ids)) {
          const readAt = Date.now();
          update((s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.dir === "out" && m.peer === row.sender_id && p.ids!.includes(m.id) && !m.readAt
                ? { ...m, readAt, expiresAt: m.ttl ? readAt + m.ttl * 1000 : undefined }
                : m,
            ),
          }));
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
            id: p.id, peer: thread, from: row.sender_id, dir: "in", kind: p.kind === "image" ? "image" : p.kind === "audio" ? "audio" : "text",
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
          update((s) => ({ ...s, messages: [...s.messages, msg] }));
        }
      } catch {
        /* descarta */
      } finally {
        if (drop) {
          try {
            await flush(); // grava localmente ANTES de apagar do servidor
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

  const stopSession = useCallback(() => {
    window.clearTimeout(pollTimer.current);
    live.current = false;
    sessRef.current?.stop();
    sessRef.current = null;
    setOnline(false);
  }, []);

  const beginSession = useCallback(
    async (keys: Keys) => {
      stopSession();
      const s = await startSession(keys);
      sessRef.current = s;
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
    [enqueue, poll, stopSession, update],
  );

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
  const acceptContact = useCallback((id: string) => update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === id ? { ...c, requested: false } : c)) })), [update]);
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

  const setProfileName = useCallback((name: string) => update((s) => ({ ...s, profile: { ...s.profile, name: name.trim().slice(0, 40) } })), [update]);
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
    async (peer: string, kind: "text" | "image" | "audio", text: string | undefined, image: string | undefined, reply?: Msg, audio?: string, dur?: number, mentions?: string[]) => {
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
      const validMentions = group ? [...new Set((mentions ?? []).filter((id) => group.members.includes(id)))].slice(0, 20) : [];
      const id = crypto.randomUUID();
      const ts = Date.now();
      const rt = reply ? { id: reply.id, text: (reply.text ?? (reply.kind === "audio" ? "Áudio" : "Imagem")).slice(0, 120) } : undefined;
      const payload = JSON.stringify({ t: group ? "gmsg" : "msg", gid: group?.id, id, kind, text, image, audio, dur, ttl, ts, n: localRef.current?.profile.name || undefined, rt, mentions: validMentions });
      const m: Msg = { id, peer, from: me, dir: "out", kind, text, image, audio, dur, ts, ttl, reply: rt, mentions: validMentions, pending: true };
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

  const sendAudio = useCallback(
    async (peer: string, dataUrl: string, dur: number) => {
      if (dataUrl.length > 200_000) throw new Error("Áudio grande demais");
      await sendBody(peer, "audio", undefined, undefined, undefined, dataUrl, dur);
    },
    [sendBody],
  );

  const setProfileImages = useCallback(
    (avatar?: string | null, banner?: string | null) => {
      update((s) => {
        const pr = { ...s.profile };
        if (avatar !== undefined) pr.avatar = avatar ?? undefined;
        if (banner !== undefined) pr.banner = banner ?? undefined;
        return { ...s, profile: pr };
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
      await Promise.allSettled([
        ...g.members.filter((m) => m !== me).map((m) => transmit(m, body(m, g.members))),
        ...also.map((m) => transmit(m, body(m, g.members))), // removidos recebem lista sem eles e apagam o grupo
      ]);
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
      phase, local, userId, busy, error, notice, online, onboardingMnemonic,
      clearOnboarding: () => setOnb(null),
      clearNotice: () => setNotice(null),
      createAccount, addContactByNumber, setProfileName, changePassword, deleteMessage, markBackupDone, setTheme, restoreAccount, unlock, lock, reconnect,
      addContact, renameContact, setBlocked, acceptContact, removeContact, setContactTtl,
      sendText, sendImage, markRead, report, setAutolock, deleteAccount,
      sendAudio, setProfileImages, createGroup, updateGroup, leaveGroup, acceptGroup, setCallRelayOnly,
      call, startCall, startGroupCall, acceptCall, rejectCall, hangup, toggleMic, toggleCam, shareScreen, switchCamera,
    }),
    [phase, local, userId, busy, error, notice, online, onboardingMnemonic, createAccount, addContactByNumber, setProfileName, changePassword, deleteMessage, markBackupDone, setTheme, restoreAccount, unlock, lock, reconnect,
      addContact, renameContact, setBlocked, acceptContact, removeContact, setContactTtl, sendText, sendImage, markRead, report, setAutolock, deleteAccount,
      sendAudio, setProfileImages, createGroup, updateGroup, leaveGroup, acceptGroup, setCallRelayOnly,
      call, startCall, startGroupCall, acceptCall, rejectCall, hangup, toggleMic, toggleCam, shareScreen, switchCamera],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}

