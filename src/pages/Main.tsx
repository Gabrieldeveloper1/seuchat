import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { msgLabel, useApp } from "../lib/store";
import { sfx, soundEnabled, setSoundEnabled } from "../lib/sounds";
import Chat from "../components/Chat";
import NodiaChat from "../components/NodiaChat";
import Dialog from "../components/Dialog";
import { IconBell, IconCamera, IconChat, IconChevronRight, IconClock, IconCopy, IconDevice, IconFileText, IconFingerprint, IconHash, IconImage, IconKey, IconLock, IconLoader, IconLogout, IconMoon, IconPalette, IconPlus, IconQr, IconSearch, IconSettings, IconShield, IconShieldCheck, IconSparkle, IconSun, IconTrash, IconUser, IconUsers, IconWifiOff, Logo } from "../icons";
const QrDialog = lazy(() => import("../components/QrDialog"));
import { profileImage } from "../lib/media";
import { turnConfigured } from "../lib/callEngine";
import { ID_RE } from "../lib/util";
import Avatar from "../components/Avatar";
import PasswordInput from "../components/PasswordInput";
import { formatAppNumber } from "../lib/phone";
import { imageSendingAllowed } from "../lib/imageFilter";
import { shortId } from "../lib/util";
import type { Msg } from "../types";

type ReportCat = "csam" | "harassment" | "spam" | "other";

const CATS: { v: ReportCat; t: string; d: string }[] = [
  { v: "csam", t: "Abuso ou exploração sexual de crianças/adolescentes", d: "Conta banida permanentemente após verificação." },
  { v: "harassment", t: "Assédio, ameaça ou perseguição", d: "" },
  { v: "spam", t: "Spam ou golpe", d: "" },
  { v: "other", t: "Outro conteúdo ilegal ou abusivo", d: "" },
];

function AddContact({ onClose }: { onClose: () => void }) {
  const { addContact, addContactByNumber } = useApp();
  const [mode, setMode] = useState<"number" | "id">("number");
  const [val, setVal] = useState("");
  const [alias, setAlias] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Novo contato" onClose={onClose}>
      <div className="tabs">
        <button type="button" className={mode === "number" ? "on" : ""} onClick={() => { setMode("number"); setVal(""); setErr(null); }}>Número do app</button>
        <button type="button" className={mode === "id" ? "on" : ""} onClick={() => { setMode("id"); setVal(""); setErr(null); }}>Por ID</button>
      </div>
      <form style={{ display: "grid", gap: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          if (mode === "number") await addContactByNumber(val, alias.trim());
          else await addContact(val, alias.trim());
          onClose();
        } catch (x) { setErr(x instanceof Error ? x.message : "Erro"); } finally { setBusy(false); }
      }}>
        {mode === "number" ? (
          <label className="field">Número SeuChatSeguro
            <input className="input" type="text" inputMode="numeric" autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="10259-5251" autoComplete="off" />
            <span className="muted small">É um identificador exclusivo gerado pelo app, não um número de telefone.</span>
          </label>
        ) : (
          <label className="field">ID do contato
            <input className="input mono" autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="26 caracteres" autoCapitalize="off" autoComplete="off" spellCheck={false} />
          </label>
        )}
        <label className="field">Apelido (só você vê)
          <input className="input" value={alias} onChange={(e) => setAlias(e.target.value)} maxLength={40} />
        </label>
        {err && <div className="error" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy || !val}>{busy ? <><IconLoader className="spin" /> Procurando…</> : <><IconPlus /> Adicionar</>}</button>
      </form>
    </Dialog>
  );
}

function ReportDialog({ msg, onClose, toast }: { msg: Msg; onClose: () => void; toast: (t: string) => void }) {
  const { report, local } = useApp();
  const [cat, setCat] = useState<ReportCat>("csam");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const alias = local?.contacts.find((c) => c.id === (msg.from ?? msg.peer))?.alias ?? "contato";
  return (
    <Dialog title="Denunciar mensagem" onClose={onClose}>
      <p className="muted small" style={{ margin: 0 }}>
        Será enviada à moderação somente esta mensagem de {alias}, com as provas criptográficas de autoria. O resto da conversa continua privado.
        O contato será bloqueado.
      </p>
      {CATS.map((c) => (
        <label key={c.v} className="radio">
          <input type="radio" name="cat" checked={cat === c.v} onChange={() => setCat(c.v)} />
          <span>{c.t}{c.d && <span className="muted small" style={{ display: "block" }}>{c.d}</span>}</span>
        </label>
      ))}
      {err && <div className="error" role="alert">{err}</div>}
      <button className="btn primary" disabled={busy} onClick={async () => {
        setBusy(true);
        setErr(null);
        try { await report(msg, cat); toast("Denúncia enviada e verificada. Contato bloqueado."); onClose(); }
        catch (x) { setErr(x instanceof Error ? x.message : "Falha ao denunciar"); }
        finally { setBusy(false); }
      }}>{busy ? <><IconLoader className="spin" /> Enviando…</> : "Enviar denúncia"}</button>
    </Dialog>
  );
}

function NewGroup({ onClose, onCreated }: { onClose: () => void; onCreated: (gid: string) => void }) {
  const { local, createGroup } = useApp();
  const [name, setName] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pool = (local?.contacts ?? []).filter((c) => !c.blocked && !c.requested);
  return (
    <Dialog title="Novo grupo" onClose={onClose}>
      <label className="field">Nome do grupo
        <input className="input" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="muted small">Escolha de 1 a 19 contatos ({sel.size} marcados)</div>
      <div className="members">
        {pool.length === 0 && <span className="muted small">Adicione contatos primeiro.</span>}
        {pool.map((c) => (
          <label key={c.id} className="member">
            <Avatar name={c.alias} seed={c.id} size="sm" src={c.avatar} /><span>{c.alias}</span>
            <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(c.id) : n.delete(c.id); setSel(n); }} />
          </label>
        ))}
      </div>
      {err && <div className="error">{err}</div>}
      <button className="btn primary" disabled={busy || !name.trim() || !sel.size} onClick={async () => {
        setBusy(true); setErr(null);
        try { const id = await createGroup(name, [...sel]); onCreated(`g:${id}`); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "Erro"); } finally { setBusy(false); }
      }}>{busy ? <><IconLoader className="spin" /> Criando…</> : <><IconUsers /> Criar grupo</>}</button>
    </Dialog>
  );
}

function ProfileImages() {
  const { local, userId, setProfileImages, resolveProfileConflict } = useApp();
  const av = useRef<HTMLInputElement>(null);
  const bn = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const pr = local?.profile;
  async function pick(f: File | undefined, kind: "avatar" | "banner") {
    if (!f) return;
    setErr(null);
    try { const url = await profileImage(f, kind); kind === "avatar" ? setProfileImages(url, undefined) : setProfileImages(undefined, url); }
    catch (e) { setErr(e instanceof Error ? e.message : "Falha"); }
  }
  return (
    <div className="profile-card">
      <div className="banner-img" style={pr?.banner ? { backgroundImage: `url(${pr.banner})` } : undefined}>
        <Avatar name={pr?.name || "Eu"} seed={userId ?? "me"} src={pr?.avatar} />
      </div>
      <input ref={av} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0], "avatar"); e.target.value = ""; }} />
      <input ref={bn} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0], "banner"); e.target.value = ""; }} />
      <div className="profile-id"><b>{pr?.name || "Eu"}</b><span className="muted small">{pr?.appNumber ? formatAppNumber(pr.appNumber) : "Perfil privado"}</span></div>
      <div className="row-btns">
        <button className="btn sm" onClick={() => av.current?.click()}><IconCamera /> Foto</button>
        <button className="btn sm" onClick={() => bn.current?.click()}><IconImage /> Banner</button>
        {pr?.avatar && <button className="btn ghost" onClick={() => setProfileImages(null, undefined)}>Remover foto</button>}
        {pr?.banner && <button className="btn ghost" onClick={() => setProfileImages(undefined, null)}>Remover banner</button>}
      </div>
      <span className="muted small">Seus contatos aceitos veem a foto e o banner.</span>
      <div className="profile-sync" role="status">
        <b>Sincronização do perfil</b>
        <span>{local?.profileSync?.conflict ? "O perfil foi alterado em outro aparelho. Escolha qual versão manter." : local?.profileSync?.dirty ? "Alterações aguardando sincronização." : local?.profileSync?.revision ? "Nome, foto e banner sincronizados entre aparelhos." : "Aguardando conexão para sincronizar o perfil."}</span>
        {local?.profileSync?.conflict && <div className="row-btns">
          <button className="btn sm" onClick={() => { if (confirm("Substituir o perfil salvo no servidor pela versão deste aparelho?")) void resolveProfileConflict("local"); }}>Manter deste aparelho</button>
          <button className="btn sm" onClick={() => { if (confirm("Substituir o perfil deste aparelho pela versão salva no servidor?")) void resolveProfileConflict("server"); }}>Usar versão do servidor</button>
        </div>}
      </div>
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function PasswordBlock() {
  const { changePassword } = useApp();
  const [o, setO] = useState("");
  const [n, setN] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="set-group">
      <SetRow icon={<IconLock />} title="Senha deste aparelho" desc="Abre suas conversas aqui. Não é enviada a ninguém." />
      <PasswordInput value={o} onChange={setO} autoComplete="current-password" placeholder="Senha atual" />
      <PasswordInput value={n} onChange={setN} autoComplete="new-password" placeholder="Nova senha" meter />
      {msg && <span className="ok">{msg}</span>}
      {err && <div className="error">{err}</div>}
      <button className="btn" disabled={!o || !n} onClick={async () => {
        setErr(null); setMsg(null);
        try { await changePassword(o, n); setMsg("Senha alterada."); setO(""); setN(""); } catch (x) { setErr(x instanceof Error ? x.message : "Falha"); }
      }}><IconKey /> Alterar senha</button>
    </div>
  );
}

type Sec = "perfil" | "privacidade" | "aparencia" | "conta";
const SECS: { v: Sec; t: string; I: typeof IconUser }[] = [
  { v: "perfil", t: "Perfil", I: IconUser },
  { v: "privacidade", t: "Privacidade", I: IconShield },
  { v: "aparencia", t: "Aparência", I: IconPalette },
  { v: "conta", t: "Conta", I: IconKey },
];

function SetRow({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="set-row">
      <span className="set-ico">{icon}</span>
      <span className="set-txt"><b>{title}</b>{desc && <span>{desc}</span>}</span>
      {children && <span className="set-act">{children}</span>}
    </div>
  );
}

function SettingsDialog({ onClose, onTerms, initial = "perfil" }: { onClose: () => void; onTerms: () => void; initial?: Sec }) {
  const { userId, local, setCallRelayOnly, setAutolock, setTheme, setProfileName, markBackupDone, lock, deleteAccount } = useApp();
  const [sec, setSec] = useState<Sec>(initial);
  const [sounds, setSounds] = useState(soundEnabled);
  const [showWords, setShowWords] = useState(false);
  const [name, setName] = useState(local?.profile.name ?? "");
  const nameEditing = useRef(false);
  useEffect(() => { if (!nameEditing.current) setName(local?.profile.name ?? ""); }, [local?.profile.name]);
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const theme = local?.settings.theme ?? "auto";
  const isLight = theme === "light";
  const copy = (v: string, k: string) => { void navigator.clipboard?.writeText(v); setCopied(k); setTimeout(() => setCopied(null), 1600); };
  return (
    <Dialog title="Ajustes" onClose={onClose} wide>
      <div className="settings">
        <nav className="set-nav" aria-label="Seções dos ajustes">
          {SECS.map(({ v, t, I }) => (
            <button key={v} className={sec === v ? "on" : ""} aria-current={sec === v ? "page" : undefined} onClick={() => setSec(v)}><I /><span>{t}</span><IconChevronRight className="chev" /></button>
          ))}
          <div className="set-nav-foot">
            <button onClick={() => { onClose(); lock(); }}><IconLock /><span>Bloquear agora</span></button>
            <button onClick={onTerms}><IconFileText /><span>Termos e Privacidade</span></button>
          </div>
        </nav>
        <div className="set-body" key={sec}>
          {sec === "perfil" && (
            <>
              <ProfileImages />
              <div className="set-group">
                <label className="set-field"><span>Nome de exibição</span>
                  <input className="input" value={name} maxLength={40} onChange={(e) => { nameEditing.current = true; setName(e.target.value); }} onBlur={() => { if (nameEditing.current) setProfileName(name); else setName(local?.profile.name ?? ""); nameEditing.current = false; }} placeholder="Seu nome" />
                </label>
              </div>
              <div className="set-group">
                <SetRow icon={<IconHash />} title="Número SeuChatSeguro" desc={local?.profile.appNumber ? <span className="mono">{formatAppNumber(local.profile.appNumber)}</span> : "Aguardando configuração do servidor"}>
                  {local?.profile.appNumber && <button className="btn sm" onClick={() => copy(local.profile.appNumber!, "num")}><IconCopy />{copied === "num" ? "Copiado" : "Copiar"}</button>}
                </SetRow>
                <SetRow icon={<IconFingerprint />} title="ID técnico" desc={<span className="mono">{userId}</span>}>
                  <button className="btn sm" onClick={() => userId && copy(userId, "id")}><IconCopy />{copied === "id" ? "Copiado" : "Copiar"}</button>
                </SetRow>
              </div>
            </>
          )}
          {sec === "privacidade" && (
            <>
              <div className="set-hero"><IconShieldCheck /><div><b>Suas conversas são cifradas de ponta a ponta</b><span>Só você e quem participa da conversa conseguem ler.</span></div></div>
              <div className="set-group">
                <SetRow icon={<IconClock />} title="Bloqueio automático" desc="Tranca o app após um período sem uso">
                  <select className="input sm" value={local?.settings.autolockMin ?? 10} onChange={(e) => setAutolock(Number(e.target.value))}>
                    {[1, 5, 10, 30, 0].map((m) => <option key={m} value={m}>{m ? `${m} min` : "Nunca"}</option>)}
                  </select>
                </SetRow>
                {turnConfigured && (
                  <SetRow icon={<IconShield />} title="Proteger meu IP nas chamadas" desc="Encaminha as chamadas pelo servidor seguro">
                    <label className="switch"><input type="checkbox" checked={!!local?.settings.callRelayOnly} onChange={(e) => setCallRelayOnly(e.target.checked)} /><i /></label>
                  </SetRow>
                )}
                <SetRow icon={<IconLock />} title="Bloquear agora" desc="Exige a senha para abrir de novo">
                  <button className="btn sm" onClick={() => { onClose(); lock(); }}>Bloquear</button>
                </SetRow>
              </div>
              <div className="set-group">
                <SetRow icon={<IconBell />} title="Efeitos sonoros" desc="Sons de mensagens e chamadas neste aparelho"><label className="switch"><input type="checkbox" checked={sounds} onChange={(e) => { setSoundEnabled(e.target.checked); setSounds(e.target.checked); if (e.target.checked) sfx.tap(); }} /><i /></label></SetRow>
                <SetRow icon={<IconBell />} title="Status e digitação" desc="Seus contatos veem quando você está online ou digitando, de forma aproximada." />
                <SetRow icon={<IconImage />} title="Imagens" desc="Fotos passam por verificação de segurança antes do envio." />
              </div>
            </>
          )}
          {sec === "aparencia" && (
            <>
              <div className="theme-pick">
                {([["dark", "Black", "Escuro e discreto", IconMoon], ["light", "White", "Claro e minimalista", IconSun]] as const).map(([v, t, d, I]) => {
                  const on = v === "light" ? isLight : !isLight;
                  return (
                    <button key={v} className={`theme-card ${v} ${on ? "on" : ""}`} onClick={() => setTheme(v)} aria-pressed={on}>
                      <span className="theme-prev"><i /><i /><i /></span>
                      <span className="theme-t"><I /><b>{t}</b></span>
                      <span className="muted small">{d}</span>
                    </button>
                  );
                })}
              </div>
              <div className="set-group">
                <SetRow icon={<IconSparkle />} title="Animações" desc="Transições suaves são reduzidas automaticamente se o seu aparelho pedir menos movimento." />
                <SetRow icon={<IconDevice />} title="Instalar como app" desc="No celular, use “Adicionar à tela inicial” do navegador para abrir em tela cheia." />
              </div>
            </>
          )}
          {sec === "conta" && (
            <>
              <PasswordBlock />
              <div className="set-group">
                <SetRow icon={<IconKey />} title="Frase de recuperação" desc={showWords ? <span className="mono">{local?.mnemonic}</span> : "12 palavras para restaurar a conta em outro aparelho"}>
                  {!showWords ? <button className="btn sm" onClick={() => setShowWords(true)}>Mostrar</button>
                    : !local?.settings.backupDone && <button className="btn sm primary" onClick={markBackupDone}>Já anotei</button>}
                </SetRow>
                <SetRow icon={<IconLogout />} title="Sair deste aparelho" desc="Bloqueia o app; suas conversas continuam guardadas aqui.">
                  <button className="btn sm" onClick={() => { onClose(); lock(); }}>Sair</button>
                </SetRow>
              </div>
              <div className="set-group danger-zone">
                <SetRow icon={<IconTrash />} title="Excluir conta" desc="Apaga suas chaves e o identificador no servidor, além do histórico deste aparelho. Digite EXCLUIR para confirmar." />
                <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="EXCLUIR" />
                {err && <div className="error">{err}</div>}
                <button className="btn danger block" disabled={confirm !== "EXCLUIR"} onClick={async () => {
                  try { await deleteAccount(); } catch (x) { setErr(x instanceof Error ? x.message : "Falha ao excluir"); }
                }}><IconTrash /> Excluir conta definitivamente</button>
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

const hashKey = (): string | null => {
  const m = location.hash.match(/^#\/c\/(.+)$/);
  try { return m ? decodeURIComponent(m[1]) : null; } catch { return null; }
};

type Filter = "all" | "contacts" | "groups";

export default function Main() {
  const { local, online, notice, clearNotice, reconnect, userId, addContact, call } = useApp();
  const [active, setActive] = useState<string | null>(hashKey);
  const [assistant, setAssistant] = useState(() => location.hash === "#/assistant");
  const [filter, setFilter] = useState<Filter>("all");
  const [dlg, setDlg] = useState<"add" | "settings" | "group" | "qr" | null>(null);
  const [setSecInit, setSetSecInit] = useState<Sec>("perfil");
  const openSettings = (s: Sec = "perfil") => { setSetSecInit(s); setDlg("settings"); };
  const [rep, setRep] = useState<Msg | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const pushed = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((t: string) => {
    setToastMsg(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3500);
  }, []);

  // ---- navegação: cada conversa tem URL (#/c/<id>); o botão "voltar" do celular/navegador fecha a conversa ----
  useEffect(() => {
    const sync = () => { const k = hashKey(); const ai = location.hash === "#/assistant"; if (!k && !ai) pushed.current = false; setActive(k); setAssistant(ai); };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, []);
  const openChat = useCallback((k: string) => {
    const url = `#/c/${encodeURIComponent(k)}`;
    if (hashKey()) history.replaceState(null, "", url); // trocar de conversa não empilha histórico
    else { pushed.current = true; location.hash = url; }
    setActive(k); setAssistant(false);
  }, []);
  const closeChat = useCallback(() => {
    if (pushed.current) { pushed.current = false; history.back(); }
    else { history.replaceState(null, "", location.pathname + location.search); setActive(null); }
  }, []);

  const openAssistant = useCallback(() => {
    if (location.hash !== "#/assistant") { pushed.current = true; location.hash = "#/assistant"; }
    setActive(null); setAssistant(true);
  }, []);
  const closeAssistant = useCallback(() => {
    if (pushed.current) { pushed.current = false; history.back(); }
    else { history.replaceState(null, "", location.pathname + location.search); setAssistant(false); }
  }, []);

  // link de convite (#/add?id=...) e avisos da chamada
  useEffect(() => {
    if (!location.hash.startsWith("#/add")) return;
    const p = new URLSearchParams(location.hash.split("?")[1] ?? "");
    const id = (p.get("id") ?? "").toLowerCase();
    history.replaceState(null, "", location.pathname + location.search);
    if (ID_RE.test(id)) addContact(id, (p.get("n") ?? "").slice(0, 40)).then(() => toast("Contato adicionado")).catch((e) => toast(e instanceof Error ? e.message : "Erro"));
  }, [addContact, toast]);
  useEffect(() => { if (call.info) toast(call.info); }, [call.info, toast]);

  const threads = useMemo(() => {
    const last = new Map<string, Msg>();
    const unread = new Map<string, number>();
    for (const m of local?.messages ?? []) {
      const l = last.get(m.peer);
      if (!l || m.ts > l.ts) last.set(m.peer, m);
      if (m.dir === "in" && !m.readAt) unread.set(m.peer, (unread.get(m.peer) ?? 0) + 1);
    }
    const prev = (m?: Msg) => (m ? (m.kind === "text" ? m.text : msgLabel(m)) : undefined);
    const items = [
      ...(local?.contacts ?? []).map((c) => ({
        key: c.id, group: false, title: c.alias, seed: c.id, avatar: c.avatar, sort: last.get(c.id)?.ts ?? c.addedAt, unread: unread.get(c.id) ?? 0,
        preview: c.blocked ? "Bloqueado" : c.requested ? "Pedido de conversa" : prev(last.get(c.id)) ?? (c.appNumber ? formatAppNumber(c.appNumber) : shortId(c.id)),
        search: `${c.alias} ${c.name ?? ""} ${c.appNumber ?? ""}`,
      })),
      ...(local?.groups ?? []).map((g) => ({
        key: `g:${g.id}`, group: true, title: g.name, seed: g.id, avatar: g.avatar, sort: last.get(`g:${g.id}`)?.ts ?? g.addedAt, unread: unread.get(`g:${g.id}`) ?? 0,
        preview: g.requested ? "Convite de grupo" : prev(last.get(`g:${g.id}`)) ?? `${g.members.length} membros`, search: g.name,
      })),
    ];
    return items.sort((a, b) => b.sort - a.sort);
  }, [local]);
  const totalUnread = useMemo(() => threads.reduce((n, t) => n + t.unread, 0), [threads]);
  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) SeuChatSeguro` : "SeuChatSeguro";
    return () => { document.title = "SeuChatSeguro"; };
  }, [totalUnread]);

  const seenMessages = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!local) return;
    const ids = new Set(local.messages.map((m) => m.id));
    if (seenMessages.current && local.messages.some((m) => m.dir === "in" && !seenMessages.current!.has(m.id))) sfx.receive();
    seenMessages.current = ids;
  }, [local?.messages]);

  const term = q.trim().toLowerCase();
  const shown = threads.filter((t) => (filter === "all" || (filter === "groups") === t.group) && (!term || t.search.toLowerCase().includes(term)));
  const activeKey = active && threads.some((t) => t.key === active) ? active : null; // URL antiga/inexistente não deixa tela em branco
  const me = local?.profile.name || "Eu";
  const filters: { v: Filter; t: string }[] = [{ v: "all", t: "Conversas" }, { v: "contacts", t: "Contatos" }, { v: "groups", t: "Grupos" }];

  return (
    <div className={`app ${activeKey || assistant ? "chat-open" : ""}`}>
      <nav className="rail" aria-label="Menu">
        <span className="rail-logo"><Logo size={40} /></span>
        {([["all", "Conversas", IconChat], ["contacts", "Contatos", IconUser], ["groups", "Grupos", IconUsers]] as const).map(([v, t, I]) => (
          <button key={v} className={`rail-btn ${!assistant && filter === v ? "on" : ""}`} onClick={() => { setFilter(v); if (assistant) closeAssistant(); }} title={t} aria-label={t} aria-current={!assistant && filter === v ? "page" : undefined}>
            <I />{v === "all" && totalUnread > 0 && <span className="dot">{totalUnread > 99 ? "99+" : totalUnread}</span>}<span className="rail-tip">{t}</span>
          </button>
        ))}
        <button className={`rail-btn ${assistant ? "on" : ""}`} onClick={openAssistant} title="Assistente IA" aria-label="Assistente IA" aria-current={assistant ? "page" : undefined}><IconSparkle /><span className="rail-tip">Assistente IA</span></button>
        <button className="rail-btn" onClick={() => setDlg("qr")} title="QR code" aria-label="QR code"><IconQr /><span className="rail-tip">QR code</span></button>
        <span className="rail-space" />
        <button className="rail-btn" onClick={() => openSettings("aparencia")} title="Aparência" aria-label="Aparência"><IconPalette /><span className="rail-tip">Aparência</span></button>
        <button className="rail-btn" onClick={() => openSettings()} title="Ajustes" aria-label="Ajustes"><IconSettings /><span className="rail-tip">Ajustes</span></button>
        <button className="rail-me" onClick={() => openSettings()} aria-label="Meu perfil"><Avatar name={me} seed={userId ?? "me"} size="sm" src={local?.profile.avatar} /><i className={online ? "on" : ""} /></button>
      </nav>
      <aside className="side">
        <div className="side-head">
          <h2 className="side-brand"><span className="side-mobile-logo"><Logo size={34} /></span><span className="side-desktop-title">Conversas</span></h2>
          <span>
            <button className="icon-btn" aria-label="QR code" title="QR code" onClick={() => setDlg("qr")}><IconQr /></button>
            <button className="icon-btn" aria-label="Novo grupo" title="Novo grupo" onClick={() => setDlg("group")}><IconUsers /></button>
            <button className="icon-btn plus" aria-label="Novo contato" title="Novo contato" onClick={() => setDlg("add")}><IconPlus /></button>
          </span>
        </div>
        {(notice || !online) && (
          <div className="banner" style={{ margin: "0 12px 8px" }} role="status">
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}><IconWifiOff />{notice ?? "Sem conexão com o servidor"}</span>
            <button className="btn" style={{ minHeight: 36 }} onClick={() => { clearNotice(); void reconnect(); }}>Tentar</button>
          </div>
        )}
        {local && !local.settings.backupDone && (
          <div className="banner" style={{ margin: "0 12px 8px" }}>
            <span>Anote sua frase de recuperação para não perder a conta.</span>
            <button className="btn" style={{ minHeight: 36 }} onClick={() => openSettings("conta")}>Ver</button>
          </div>
        )}
        {local && !local.profile.appNumber && (
          <div className="banner" style={{ margin: "0 12px 8px" }} role="status">
            <span>Seu número exclusivo ainda não foi gerado. A configuração do servidor pode estar pendente.</span>
            <button className="btn" style={{ minHeight: 36 }} onClick={() => openSettings()}>Detalhes</button>
          </div>
        )}
        <div className="chips" role="tablist" aria-label="Filtrar">
          {filters.map((f) => <button key={f.v} role="tab" aria-selected={filter === f.v} className={`chip ${filter === f.v ? "on" : ""}`} onClick={() => setFilter(f.v)}>{f.t}</button>)}
        </div>
        {threads.length > 0 && (
          <div className="search"><IconSearch /><input className="input" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar conversa" /></div>
        )}
        <div className="list">
          {threads.length === 0 && (
            <div className="empty">
              <span className="ico"><IconChat /></span>
              <div><b style={{ color: "var(--text)", fontSize: 17 }}>Tudo pronto</b><br />Adicione alguém pelo número do app, QR code ou ID para começar uma conversa protegida.</div>
              <button className="btn primary" onClick={() => setDlg("add")}><IconPlus /> Novo contato</button>
            </div>
          )}
          {threads.length > 0 && shown.length === 0 && <div className="empty"><IconSearch style={{ width: 34, height: 34 }} /><div>Nada encontrado.</div></div>}
          {shown.map((t) => (
            <button key={t.key} className={`row ${activeKey === t.key ? "on" : ""}`} onClick={() => openChat(t.key)}>
              <Avatar name={t.title} seed={t.seed} src={t.avatar} group={t.group} />
              <span className="meta">
                <span className="name"><span>{t.title}</span>{t.unread > 0 && <span className="dot">{t.unread > 99 ? "99+" : t.unread}</span>}</span>
                <span className="prev">{t.preview}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="me-bar">
          <Avatar name={me} seed={userId ?? "me"} size="sm" src={local?.profile.avatar} />
          <div className="t"><b>{me}</b><span className="muted small">{local?.profile.appNumber ? formatAppNumber(local.profile.appNumber) : "Número do app pendente"}</span></div>
          <button className="icon-btn" aria-label="Configurações" onClick={() => openSettings()}><IconSettings /></button>
        </div>

        {/* navegação inferior (celular) */}
        <button className="fab" aria-label="Novo contato" onClick={() => setDlg("add")}><IconPlus /></button>
        <nav className="tabbar" aria-label="Navegação principal" style={{ ["--i" as string]: 0 }}>
          <span className="tab-ink" aria-hidden />
          <button className="tab on" onClick={() => { setFilter("all"); }} aria-current="page"><IconChat />Conversas{totalUnread > 0 && <span className="dot">{totalUnread > 99 ? "99+" : totalUnread}</span>}</button>
          <button className="tab" onClick={openAssistant}><IconSparkle />Assistente IA</button>
          <button className="tab" onClick={() => openSettings("perfil")}><IconUser />Perfil</button><button className="tab" onClick={() => openSettings()}><IconSettings />Ajustes</button>
        </nav>
      </aside>

      <main className="main">
        {assistant ? <NodiaChat onBack={closeAssistant} /> : activeKey ? (
          <Chat key={activeKey} peer={activeKey} onBack={closeChat} onAssistant={openAssistant} onReport={setRep} toast={toast} />
        ) : (
          <div className="placeholder welcome-pane"><IconChat style={{ width: 56, height: 56 }} /><div><b>Suas conversas</b><span>Selecione uma conversa para começar.</span></div><div className="pane-feats"><span><IconLock /> Ponta a ponta</span><span><IconShieldCheck /> Privacidade</span></div></div>
        )}
      </main>

      {dlg === "add" && <AddContact onClose={() => setDlg(null)} />}
      {dlg === "qr" && <Suspense fallback={null}><QrDialog onClose={() => setDlg(null)} toast={toast} /></Suspense>}
      {dlg === "group" && <NewGroup onClose={() => setDlg(null)} onCreated={openChat} />}
      {dlg === "settings" && <SettingsDialog initial={setSecInit} onClose={() => setDlg(null)} onTerms={() => { location.hash = "#/terms"; }} />}
      {rep && <ReportDialog msg={rep} onClose={() => setRep(null)} toast={toast} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
