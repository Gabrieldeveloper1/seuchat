import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import sodium from "libsodium-wrappers-sumo";
import type { Contact, Group, LocalState, Msg } from "../types";
import { CallEngine, IDLE, type CallState } from "./callEngine";
import { ID_RE, dec, enc, fromB64, hexToBytes, toB64 } from "./util";
import { isValidMnemonic, keysFromMnemonic, newMnemonic, normalizeMnemonic, type Keys } from "./crypto";
import { normalizePhone } from "./phone";
import { createVault, openVault, saveVault, vaultExists, wipeVault, type VaultHandle } from "./vault";
import { startSession, fetchIdentity, type RelayRow, type Session } from "./session";
import { ApiError, deleteAccount as apiDeleteAccount, lookupPhone, linkPhone as apiLinkPhone, sendMessage, submitReport } from "./api";
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
  createAccount(name: string, phone: string, pass: string): Promise<void>;
  linkPhone(phone: string, code?: string): Promise<{ step: "code" | "done"; verified?: boolean }>;
  addContactByPhone(phone: string, alias: string): Promise<void>;
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
  sendText(peer: string, text: string, reply?: Msg): Promise<void>;
  sendImage(peer: string, file: File): Promise<void>;
  markRead(peer: string): void;
  report(msg: Msg, category: ReportPayload["category"]): Promise<void>;
  setAutolock(min: number): void;
  deleteAccount(): Promise<void>;
  sendAudio(peer: string, dataUrl: string, dur: number): Promise<void>;
  setProfileImages(avatar?: string | null, banner?: string | null): void;
  createGroup(name: string, members: string[]): Promise<string>;
  updateGroup(gid: string, patch: { name?: string; members?: string[]; ttl?: number }): Promise<void>;
  leaveGroup(gid: string): Promise<void>;
  acceptGroup(gid: string): void;
  setCallRelayOnly(on: boolean): void;
  call: CallState;
  startCall(peer: string, video: boolean): Promise<void>;
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
  return { v: 1, mnemonic, profile: { name }, contacts: [], groups: [], messages: [], settings: { autolockMin: 10, theme: "auto", backupDone: false } };
}

/** Cofres criados em versões antigas não têm perfil/tema. */
function migrate(s: LocalState): LocalState {
  return { ...s, groups: s.groups ?? [], profile: s.profile ?? { name: "" }, settings: { ...s.settings, theme: s.settings.theme ?? "auto", backupDone: s.settings.backupDone ?? true } };
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
          t: string; id?: string; kind?: string; text?: string; image?: string; audio?: string; dur?: number; ttl?: number; ts?: number; ids?: string[];
          n?: string; rt?: { id?: string; text?: string }; gid?: string; name?: string; members?: string[]; av?: string; bn?: string;
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
          for (const [k, v, max] of [["avatar", p.av, 60_000], ["banner", p.bn, 120_000]] as const) {
            if (typeof v !== "string") continue;
            if (v === "") patch[k] = undefined;
            else if (v.startsWith("data:image/jpeg;base64,") && v.length <= max && !(await dataUrlIsBlocked(v))) patch[k] = v;
          }
          const sid = row.sender_id;
          update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === sid ? { ...c, ...patch } : c)) }));
        } else if (p.t === "call") {
          if (!contact.requested) void callRef.current?.handle(row.sender_id, p as never, row.sent_at);
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
            const g: Group = { id: gid, name: p.name.slice(0, 40), owner: ex?.owner ?? row.sender_id, members: [...new Set(p.members)], ttl, addedAt: ex?.addedAt ?? Date.now(), requested: ex ? ex.requested : !!contact.requested };
            update((s) => ({ ...s, groups: ex ? s.groups.map((x) => (x.id === gid ? g : x)) : [...s.groups, g] }));
          }
        } else if (p.t === "gleave") {
          const gid = String(p.gid ?? "");
          const sid = row.sender_id;
          update((s) => ({ ...s, groups: s.groups.map((g) => (g.id === gid ? { ...g, members: g.members.filter((m) => m !== sid) } : g)) }));
        } else if ((p.t === "msg" || p.t === "gmsg") && typeof p.id === "string") {
          const thread = p.t === "gmsg" ? `g:${p.gid}` : row.sender_id;
          if (p.t === "gmsg") {
            const g = localRef.current!.groups.find((x) => x.id === p.gid);
            if (!g || !g.members.includes(row.sender_id)) throw new Error("não é membro");
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
    [enqueue, poll, stopSession],
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
    async (name: string, phone: string, pass: string) => {
      setBusy(true);
      setError(null);
      try {
        const e164 = phone.trim() ? normalizePhone(phone) : undefined;
        if (phone.trim() && !e164) throw new Error("Número de telefone inválido");
        const m = newMnemonic();
        const keys = await keysFromMnemonic(m);
        const state = emptyState(m, name.trim().slice(0, 40));
        if (e164) state.profile.phone = e164;
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
        if (e164) {
          try {
            const r = await apiLinkPhone(sessRef.current!.getJwt(), e164);
            if (r.step === "done") update((s) => ({ ...s, profile: { ...s.profile, phoneVerified: !!r.verified } }));
            else setNotice("Enviamos um código por SMS. Confirme seu número em Configurações → Meu perfil.");
          } catch (e) {
            setNotice(`Conta criada, mas o número não foi vinculado: ${errMsg(e)}`);
          }
        }
        setOnb(m);
        setPhase("app");
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [beginSession, update],
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

  const addContactByPhone = useCallback(
    async (phoneRaw: string, alias: string) => {
      const e164 = normalizePhone(phoneRaw);
      if (!e164) throw new Error("Número inválido. Use DDD + número (ex.: 21 99999-0000)");
      if (e164 === localRef.current?.profile.phone) throw new Error("Esse é o seu próprio número");
      const sess = sessRef.current;
      if (!sess) throw new Error("Sem conexão com o servidor");
      const found = await lookupPhone(sess.getJwt(), e164);
      if (!found) throw new Error("Esse número ainda não usa o SeuChatSeguro");
      if (found.userId === keysRef.current?.userId) throw new Error("Esse é o seu próprio número");
      const peer = await fetchIdentity(sess.client, found.userId);
      if (!peer) throw new Error("Contato indisponível");
      const exists = localRef.current!.contacts.find((c) => c.id === found.userId);
      if (exists) {
        update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === found.userId ? { ...c, phone: e164, alias: alias || c.alias, requested: false } : c)) }));
        return;
      }
      const c: Contact = { id: found.userId, alias: alias || e164, phone: e164, idKey: toB64(peer.idKey), spk: toB64(peer.spk), ttl: 0, addedAt: Date.now() };
      update((s) => ({ ...s, contacts: [...s.contacts, c] }));
    },
    [update],
  );

  const linkPhone = useCallback(
    async (phoneRaw: string, code?: string) => {
      const e164 = normalizePhone(phoneRaw);
      if (!e164) throw new Error("Número de telefone inválido");
      const sess = sessRef.current;
      if (!sess) throw new Error("Sem conexão com o servidor");
      const r = await apiLinkPhone(sess.getJwt(), e164, code);
      if (r.step === "done") update((s) => ({ ...s, profile: { ...s.profile, phone: e164, phoneVerified: !!r.verified } }));
      return r;
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
      await transmit(peer, JSON.stringify({ t: "prof", n: pr.name || undefined, av: pr.avatar ?? "", bn: pr.banner ?? "" }));
      update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === peer ? { ...c, profSent: true } : c)) }));
    },
    [transmit, update],
  );

  const sendBody = useCallback(
    async (peer: string, kind: "text" | "image" | "audio", text: string | undefined, image: string | undefined, reply?: Msg, audio?: string, dur?: number) => {
      const me = keysRef.current!.userId;
      const isGroup = peer.startsWith("g:");
      const contact = isGroup ? undefined : localRef.current?.contacts.find((c) => c.id === peer);
      const group = isGroup ? localRef.current?.groups.find((g) => g.id === peer.slice(2)) : undefined;
      if (isGroup ? !group : !contact) throw new Error("Conversa não encontrada");
      if (contact?.blocked) throw new Error("Contato bloqueado");
      const ttl = group ? group.ttl : contact!.ttl;
      const blocked = new Set((localRef.current?.contacts ?? []).filter((c) => c.blocked).map((c) => c.id));
      const targets = group ? group.members.filter((m) => m !== me && !blocked.has(m)) : [peer];
      if (!targets.length) throw new Error("Não há outros membros no grupo");
      const id = crypto.randomUUID();
      const ts = Date.now();
      const rt = reply ? { id: reply.id, text: (reply.text ?? (reply.kind === "audio" ? "Áudio" : "Imagem")).slice(0, 120) } : undefined;
      const payload = JSON.stringify({ t: group ? "gmsg" : "msg", gid: group?.id, id, kind, text, image, audio, dur, ttl, ts, n: localRef.current?.profile.name || undefined, rt });
      const res = await Promise.allSettled(targets.map((t) => transmit(t, payload)));
      const okRes = res.find((r): r is PromiseFulfilledResult<{ sentAt: number }> => r.status === "fulfilled");
      if (!okRes) throw (res[0] as PromiseRejectedResult).reason;
      const m: Msg = { id, peer, from: me, dir: "out", kind, text, image, audio, dur, ts: okRes.value.sentAt ?? ts, ttl, reply: rt };
      update((s) => ({ ...s, messages: [...s.messages, m] }));
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
      const body = (members: string[]) => JSON.stringify({ t: "ginv", gid: g.id, name: g.name, members, ttl: g.ttl, n: localRef.current?.profile.name || undefined });
      await Promise.allSettled([
        ...g.members.filter((m) => m !== me).map((m) => transmit(m, body(g.members))),
        ...also.map((m) => transmit(m, body(g.members))), // removidos: recebem lista sem eles e apagam o grupo
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
      const g: Group = { id: crypto.randomUUID(), name: name.trim().slice(0, 40), owner: me, members: [me, ...list], ttl: 0, addedAt: Date.now() };
      update((s) => ({ ...s, groups: [...s.groups, g] }));
      await broadcastGroup(g);
      return g.id;
    },
    [update, broadcastGroup],
  );

  const updateGroup = useCallback(
    async (gid: string, patch: { name?: string; members?: string[]; ttl?: number }) => {
      const me = keysRef.current!.userId;
      const g = localRef.current?.groups.find((x) => x.id === gid);
      if (!g || g.owner !== me) throw new Error("Só quem criou o grupo pode alterá-lo");
      const members = patch.members ? [me, ...new Set(patch.members.filter((m) => m !== me))] : g.members;
      if (members.length > 20) throw new Error("Máximo de 20 membros");
      const ng: Group = { ...g, name: (patch.name ?? g.name).trim().slice(0, 40) || g.name, members, ttl: patch.ttl ?? g.ttl };
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
    async (peer: string, text: string, reply?: Msg) => {
      const t = text.trim();
      if (!t) return;
      if (t.length > MAX_TEXT) throw new Error("Mensagem muito longa");
      await sendBody(peer, "text", t, undefined, reply);
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
    );
    callRef.current = eng;
    return () => { void eng.hangup(); };
  }, [transmit]);

  const startCall = useCallback(async (peer: string, video: boolean) => {
    const c = localRef.current?.contacts.find((x) => x.id === peer);
    if (!c || c.blocked || c.requested) throw new Error("Aceite o contato antes de ligar");
    await callRef.current!.start(peer, video);
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
      createAccount, linkPhone, addContactByPhone, setProfileName, changePassword, deleteMessage, markBackupDone, setTheme, restoreAccount, unlock, lock, reconnect,
      addContact, renameContact, setBlocked, acceptContact, removeContact, setContactTtl,
      sendText, sendImage, markRead, report, setAutolock, deleteAccount,
      sendAudio, setProfileImages, createGroup, updateGroup, leaveGroup, acceptGroup, setCallRelayOnly,
      call, startCall, acceptCall, rejectCall, hangup, toggleMic, toggleCam, shareScreen, switchCamera,
    }),
    [phase, local, userId, busy, error, notice, online, onboardingMnemonic, createAccount, linkPhone, addContactByPhone, setProfileName, changePassword, deleteMessage, markBackupDone, setTheme, restoreAccount, unlock, lock, reconnect,
      addContact, renameContact, setBlocked, acceptContact, removeContact, setContactTtl, sendText, sendImage, markRead, report, setAutolock, deleteAccount,
      sendAudio, setProfileImages, createGroup, updateGroup, leaveGroup, acceptGroup, setCallRelayOnly,
      call, startCall, acceptCall, rejectCall, hangup, toggleMic, toggleCam, shareScreen, switchCamera],
  );

  return <C.Provider value={value}>{children}</C.Provider>;
}

