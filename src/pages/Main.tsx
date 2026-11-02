import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/store";
import Chat from "../components/Chat";
import Dialog from "../components/Dialog";
import Terms from "../components/Terms";
import { IconCamera, IconChat, IconCopy, IconLock, IconPhone, IconPlus, IconQr, IconSearch, IconSettings, IconShieldCheck, IconTrash, IconUser, IconUsers, IconWifiOff } from "../icons";
const QrDialog = lazy(() => import("../components/QrDialog"));
import { profileImage } from "../lib/media";
import { turnConfigured } from "../lib/callEngine";
import { ID_RE } from "../lib/util";
import Avatar from "../components/Avatar";
import PasswordInput from "../components/PasswordInput";
import { formatPhone } from "../lib/phone";
import { blocklistStatus } from "../lib/imageFilter";
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
  const { addContact, addContactByPhone } = useApp();
  const [mode, setMode] = useState<"phone" | "id">("phone");
  const [val, setVal] = useState("");
  const [alias, setAlias] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Novo contato" onClose={onClose}>
      <div className="tabs">
        <button type="button" className={mode === "phone" ? "on" : ""} onClick={() => { setMode("phone"); setVal(""); setErr(null); }}>Por telefone</button>
        <button type="button" className={mode === "id" ? "on" : ""} onClick={() => { setMode("id"); setVal(""); setErr(null); }}>Por ID</button>
      </div>
      <form style={{ display: "grid", gap: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          if (mode === "phone") await addContactByPhone(val, alias.trim());
          else await addContact(val, alias.trim());
          onClose();
        } catch (x) { setErr(x instanceof Error ? x.message : "Erro"); } finally { setBusy(false); }
      }}>
        {mode === "phone" ? (
          <label className="field">Número do contato
            <input className="input" type="tel" inputMode="tel" autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder="(21) 99999-0000" autoComplete="off" />
            <span className="muted small">Sem código do país, usamos +55 (Brasil). Para outro país, comece com +.</span>
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
        <button className="btn primary" disabled={busy || !val}>{busy ? "Procurando…" : "Adicionar"}</button>
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
      }}>{busy ? "Enviando…" : "Enviar denúncia"}</button>
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
      }}>{busy ? "Criando…" : "Criar grupo"}</button>
    </Dialog>
  );
}

function ProfileImages() {
  const { local, userId, setProfileImages } = useApp();
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
    <div className="kv">
      <div className="banner-img" style={pr?.banner ? { backgroundImage: `url(${pr.banner})` } : undefined}>
        <Avatar name={pr?.name || "Eu"} seed={userId ?? "me"} src={pr?.avatar} />
      </div>
      <input ref={av} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0], "avatar"); e.target.value = ""; }} />
      <input ref={bn} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0], "banner"); e.target.value = ""; }} />
      <div className="row-btns">
        <button className="btn" onClick={() => av.current?.click()}><IconCamera /> Foto</button>
        <button className="btn" onClick={() => bn.current?.click()}><IconCamera /> Banner</button>
        {pr?.avatar && <button className="btn ghost" onClick={() => setProfileImages(null, undefined)}>Remover foto</button>}
        {pr?.banner && <button className="btn ghost" onClick={() => setProfileImages(undefined, null)}>Remover banner</button>}
      </div>
      <span className="muted small">Seus contatos aceitos veem a foto e o banner. As imagens passam pelo mesmo filtro de segurança.</span>
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function PhoneBlock() {
  const { local, linkPhone } = useApp();
  const [phone, setPhone] = useState(local?.profile.phone ?? "");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"edit" | "code">("edit");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await linkPhone(phone, step === "code" ? code : undefined);
      if (r.step === "code") { setStep("code"); setMsg("Código enviado por SMS."); }
      else { setStep("edit"); setCode(""); setMsg(r.verified ? "Número verificado." : "Número vinculado (sem verificação por SMS)."); }
    } catch (x) { setErr(x instanceof Error ? x.message : "Falha"); } finally { setBusy(false); }
  }
  const cur = local?.profile;
  return (
    <div className="kv">
      <span className="muted small">Telefone {cur?.phone ? `· ${formatPhone(cur.phone)} ${cur.phoneVerified ? "✓ verificado" : "(não verificado)"}` : "(ninguém te acha pelo número)"}</span>
      {step === "edit" ? (
        <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(21) 99999-0000" />
      ) : (
        <input className="input mono" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código do SMS" autoFocus />
      )}
      {msg && <span className="ok">{msg}</span>}
      {err && <div className="error">{err}</div>}
      <button className="btn" disabled={busy || (step === "edit" ? !phone : !code)} onClick={() => void go()}>
        <IconPhone /> {step === "edit" ? (cur?.phone ? "Trocar número" : "Vincular número") : "Confirmar código"}
      </button>
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
    <div className="kv">
      <span className="muted small">Trocar senha deste aparelho</span>
      <PasswordInput value={o} onChange={setO} autoComplete="current-password" placeholder="Senha atual" />
      <PasswordInput value={n} onChange={setN} autoComplete="new-password" placeholder="Nova senha" meter />
      {msg && <span className="ok">{msg}</span>}
      {err && <div className="error">{err}</div>}
      <button className="btn" disabled={!o || !n} onClick={async () => {
        setErr(null); setMsg(null);
        try { await changePassword(o, n); setMsg("Senha alterada."); setO(""); setN(""); } catch (x) { setErr(x instanceof Error ? x.message : "Falha"); }
      }}>Alterar senha</button>
    </div>
  );
}

function SettingsDialog({ onClose, onTerms }: { onClose: () => void; onTerms: () => void }) {
  const { userId, local, setCallRelayOnly, setAutolock, setTheme, setProfileName, setProfileBio, markBackupDone, lock, deleteAccount } = useApp();
  const [showWords, setShowWords] = useState(false);
  const [name, setName] = useState(local?.profile.name ?? "");
  const [bio, setBio] = useState(local?.profile.bio ?? "");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const f = blocklistStatus();
  const fText = f.status === "ok" ? `ativo (${f.count} hashes)` : f.status === "invalid" ? "lista inválida (envio de imagens bloqueado)" : "lista não configurada (modo desenvolvimento)";
  const theme = local?.settings.theme ?? "auto";
  return (
    <Dialog title="Configurações" onClose={onClose}>
      <ProfileImages />
      <div className="kv">
        <span className="muted small">Seu nome</span>
        <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => setProfileName(name)} />
      </div>
      <div className="kv">
        <span className="muted small">Bio do perfil</span>
        <textarea className="input bio-input" value={bio} maxLength={280} rows={3} placeholder="Conte um pouco sobre você" onChange={(e) => setBio(e.target.value)} />
        <span className="muted small">{bio.length}/280 · visível para contatos aceitos</span>
        <button className="btn" disabled={bio.trim() === (local?.profile.bio ?? "")} onClick={() => setProfileBio(bio)}>Salvar bio</button>
      </div>
      <PhoneBlock />
      <div className="kv">
        <span className="muted small">Seu ID (alternativa ao telefone)</span>
        <span className="mono">{userId}</span>
        <button className="btn" onClick={() => userId && navigator.clipboard?.writeText(userId)}><IconCopy /> Copiar ID</button>
      </div>
      <div className="kv">
        <span className="muted small">Aparência</span>
        <div className="seg">
          {(["auto", "light", "dark"] as const).map((t) => (
            <button key={t} className={theme === t ? "on" : ""} onClick={() => setTheme(t)}>{t === "auto" ? "Automático" : t === "light" ? "Claro" : "Escuro"}</button>
          ))}
        </div>
      </div>
      <div className="kv">
        <span className="muted small">Bloqueio automático</span>
        <select className="input" value={local?.settings.autolockMin ?? 10} onChange={(e) => setAutolock(Number(e.target.value))}>
          {[1, 5, 10, 30, 0].map((m) => <option key={m} value={m}>{m ? `Após ${m} min parado` : "Nunca"}</option>)}
        </select>
      </div>
      <label className="check kv">
        <input type="checkbox" checked={!!local?.settings.callRelayOnly} disabled={!turnConfigured} onChange={(e) => setCallRelayOnly(e.target.checked)} />
        <span>Esconder meu IP nas chamadas (usar só o servidor TURN){!turnConfigured && <span className="muted small" style={{ display: "block" }}>Indisponível: o servidor TURN não foi configurado. Sem ele, quem está na chamada vê o seu IP.</span>}</span>
      </label>
      <PasswordBlock />
      <div className="kv">
        <span className="muted small">Frase de recuperação</span>
        {showWords ? (
          <>
            <span className="mono">{local?.mnemonic}</span>
            {!local?.settings.backupDone && <button className="btn" onClick={markBackupDone}>Já anotei</button>}
          </>
        ) : <button className="btn" onClick={() => setShowWords(true)}>Mostrar</button>}
      </div>
      <div className="kv">
        <span className="muted small">Filtro de segurança de imagens</span>
        <span>{fText}</span>
      </div>
      <button className="btn" onClick={() => { onClose(); lock(); }}><IconLock /> Bloquear agora</button>
      <button className="btn" onClick={onTerms}>Termos e Privacidade</button>
      <div className="kv" style={{ borderBottom: 0 }}>
        <span className="muted small">Excluir conta: apaga suas chaves e telefone no servidor e todo o histórico deste aparelho. Digite EXCLUIR para confirmar.</span>
        <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {err && <div className="error">{err}</div>}
        <button className="btn danger" disabled={confirm !== "EXCLUIR"} onClick={async () => {
          try { await deleteAccount(); } catch (x) { setErr(x instanceof Error ? x.message : "Falha ao excluir"); }
        }}><IconTrash /> Excluir conta</button>
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
  const [filter, setFilter] = useState<Filter>("all");
  const [dlg, setDlg] = useState<"add" | "settings" | "terms" | "group" | "qr" | null>(null);
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
    const sync = () => { const k = hashKey(); if (!k) pushed.current = false; setActive(k); };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync); };
  }, []);
  const openChat = useCallback((k: string) => {
    const url = `#/c/${encodeURIComponent(k)}`;
    if (hashKey()) history.replaceState(null, "", url); // trocar de conversa não empilha histórico
    else { pushed.current = true; location.hash = url; }
    setActive(k);
  }, []);
  const closeChat = useCallback(() => {
    if (pushed.current) { pushed.current = false; history.back(); }
    else { history.replaceState(null, "", location.pathname + location.search); setActive(null); }
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
    const prev = (m?: Msg) => (m ? (m.kind === "image" ? "Imagem" : m.kind === "audio" ? "Áudio" : m.text) : undefined);
    const items = [
      ...(local?.contacts ?? []).map((c) => ({
        key: c.id, group: false, title: c.alias, seed: c.id, avatar: c.avatar, sort: last.get(c.id)?.ts ?? c.addedAt, unread: unread.get(c.id) ?? 0,
        preview: c.blocked ? "Bloqueado" : c.requested ? "Pedido de conversa" : prev(last.get(c.id)) ?? (c.phone ? formatPhone(c.phone) : shortId(c.id)),
        search: `${c.alias} ${c.name ?? ""} ${c.phone ?? ""}`,
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

  const term = q.trim().toLowerCase();
  const shown = threads.filter((t) => (filter === "all" || (filter === "groups") === t.group) && (!term || t.search.toLowerCase().includes(term)));
  const activeKey = active && threads.some((t) => t.key === active) ? active : null; // URL antiga/inexistente não deixa tela em branco
  const me = local?.profile.name || "Eu";
  const filters: { v: Filter; t: string }[] = [{ v: "all", t: "Conversas" }, { v: "contacts", t: "Contatos" }, { v: "groups", t: "Grupos" }];

  return (
    <div className={`app ${activeKey ? "chat-open" : ""}`}>
      <aside className="side">
        <div className="side-head">
          <h2><IconShieldCheck /> SeuChatSeguro</h2>
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
            <button className="btn" style={{ minHeight: 36 }} onClick={() => setDlg("settings")}>Ver</button>
          </div>
        )}
        {local?.settings.phoneMigrationRequired && !local.profile.phone && (
          <div className="banner" style={{ margin: "0 12px 8px" }} role="status">
            <span>Olá! Agora usamos números personalizados. Crie o seu para que outras pessoas encontrem você.</span>
            <button className="btn" style={{ minHeight: 36 }} onClick={() => setDlg("settings")}>Migrar</button>
          </div>
        )}
        <div className="chips" role="tablist" aria-label="Filtrar">
          {filters.map((f) => <button key={f.v} role="tab" aria-selected={filter === f.v} className={`chip ${filter === f.v ? "on" : ""}`} onClick={() => setFilter(f.v)}>{f.t}</button>)}
        </div>
        {threads.length > 3 && (
          <div className="search"><IconSearch /><input className="input" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar conversa" /></div>
        )}
        <div className="list">
          {threads.length === 0 && (
            <div className="empty">
              <span className="ico"><IconShieldCheck /></span>
              <div><b style={{ color: "var(--text)", fontSize: 17 }}>Tudo pronto</b><br />Adicione alguém pelo telefone, QR code ou ID para começar uma conversa protegida.</div>
              <button className="btn primary" onClick={() => setDlg("add")}><IconPlus /> Novo contato</button>
            </div>
          )}
          {threads.length > 0 && shown.length === 0 && <div className="empty"><div>Nada encontrado.</div></div>}
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
          <div className="t"><b>{me}</b><span className="muted small">{local?.profile.phone ? formatPhone(local.profile.phone) : "Sem telefone vinculado"}</span></div>
          <button className="icon-btn" aria-label="Configurações" onClick={() => setDlg("settings")}><IconSettings /></button>
        </div>

        {/* navegação inferior (celular) */}
        <button className="fab" aria-label="Novo contato" onClick={() => setDlg("add")}><IconPlus /></button>
        <nav className="tabbar" aria-label="Navegação principal">
          <button className={`tab ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")} aria-current={filter === "all" ? "page" : undefined}>
            <IconChat />Conversas{totalUnread > 0 && <span className="dot">{totalUnread > 99 ? "99+" : totalUnread}</span>}
          </button>
          <button className={`tab ${filter === "contacts" ? "on" : ""}`} onClick={() => setFilter("contacts")} aria-current={filter === "contacts" ? "page" : undefined}><IconUser />Contatos</button>
          <button className={`tab ${filter === "groups" ? "on" : ""}`} onClick={() => setFilter("groups")} aria-current={filter === "groups" ? "page" : undefined}><IconUsers />Grupos</button>
          <button className="tab" onClick={() => setDlg("settings")}><IconSettings />Ajustes</button>
        </nav>
      </aside>

      <main className="main">
        {activeKey ? (
          <Chat key={activeKey} peer={activeKey} onBack={closeChat} onReport={setRep} toast={toast} />
        ) : (
          <div className="placeholder"><IconLock /><div><b style={{ color: "var(--text)", fontSize: 17 }}>SeuChatSeguro</b><br />Selecione uma conversa.<br />Mensagens cifradas de ponta a ponta.</div></div>
        )}
      </main>

      {dlg === "add" && <AddContact onClose={() => setDlg(null)} />}
      {dlg === "qr" && <Suspense fallback={null}><QrDialog onClose={() => setDlg(null)} toast={toast} /></Suspense>}
      {dlg === "group" && <NewGroup onClose={() => setDlg(null)} onCreated={openChat} />}
      {dlg === "settings" && <SettingsDialog onClose={() => setDlg(null)} onTerms={() => setDlg("terms")} />}
      {dlg === "terms" && <Terms onClose={() => setDlg(null)} />}
      {rep && <ReportDialog msg={rep} onClose={() => setRep(null)} toast={toast} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
