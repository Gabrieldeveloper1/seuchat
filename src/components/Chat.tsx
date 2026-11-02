import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
const EmojiPicker = lazy(() => import("./EmojiPicker"));
import { useApp } from "../lib/store";
import { IconAttach, IconBack, IconBlock, IconCheck, IconCheckDouble, IconClock, IconFlag, IconMic, IconMore, IconPhone, IconReply, IconSend, IconSettings, IconShieldCheck, IconSmile, IconLoader, IconTrash, IconUser, IconVideo, IconX } from "../icons";
import { TTL_OPTIONS, type Msg } from "../types";
import { shortId } from "../lib/util";
import { imageSendingAllowed } from "../lib/imageFilter";
import { startRecording, type Recorder } from "../lib/media";
import { formatAppNumber } from "../lib/phone";
import { profileImage } from "../lib/media";
import type { GroupRole } from "../types";
import Avatar from "./Avatar";
import Dialog from "./Dialog";

function time(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function ProfileDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { local, startCall } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const c = local?.contacts.find((x) => x.id === id);
  if (!c) return null;
  const call = async (v: boolean) => { try { await startCall(id, v); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "Erro"); } };
  return (
    <Dialog title="Perfil" onClose={onClose}>
      <div className="banner-img" style={c.banner ? { backgroundImage: `url(${c.banner})` } : undefined}>
        <Avatar name={c.alias} seed={c.id} src={c.avatar} />
      </div>
      <div>
        <h2>{c.alias}</h2>
        {c.name && c.name !== c.alias && <div className="muted">Se identifica como {c.name}</div>}
        {c.appNumber && <div className="muted mono">Número SeuChatSeguro: {formatAppNumber(c.appNumber)}</div>}
        <div className="mono muted" style={{ marginTop: 6 }}>{c.id}</div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row-btns">
        <button className="btn" onClick={() => void call(false)}><IconPhone /> Voz</button>
        <button className="btn" onClick={() => void call(true)}><IconVideo /> Vídeo</button>
      </div>
    </Dialog>
  );
}

function GroupDialog({ gid, onClose, toast }: { gid: string; onClose: () => void; toast: (t: string) => void }) {
  const { local, userId, updateGroup, leaveGroup } = useApp();
  const g = local?.groups.find((x) => x.id === gid);
  const [name, setName] = useState(g?.name ?? "");
  const [description, setDescription] = useState(g?.description ?? "");
  const [sel, setSel] = useState<Set<string>>(new Set(g?.members.filter((m) => m !== userId)));
  const [roles, setRoles] = useState<GroupRole[]>(g?.roles ?? [{ id: "everyone", name: "@Everyone", permissions: [] }]);
  const [memberRoles, setMemberRoles] = useState<Record<string, string>>(g?.memberRoles ?? {});
  const [autoRole, setAutoRole] = useState(g?.autoRole ?? "everyone");
  const [avatar, setAvatar] = useState(g?.avatar ?? "");
  const [banner, setBanner] = useState(g?.banner ?? "");
  const [roleName, setRoleName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  if (!g || !local) return null;
  const owner = g.owner === userId;
  const label = (id: string) => (id === userId ? "Você" : local.contacts.find((c) => c.id === id)?.alias ?? shortId(id));
  const pool = local.contacts.filter((c) => !c.blocked && !c.requested);
  const myRole = roles.find((r) => r.id === (memberRoles[userId ?? ""] ?? "everyone"));
  const canViewAudit = owner || !!myRole?.permissions.includes("view_audit");
  const readImage = async (file: File | undefined, kind: "avatar" | "banner") => {
    if (!file) return;
    try {
      const image = await profileImage(file, kind);
      kind === "avatar" ? setAvatar(image) : setBanner(image);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Não foi possível usar esta imagem"); }
  };
  const togglePermission = (roleId: string, permission: string, enabled: boolean) => {
    setRoles((all) => all.map((r) => r.id !== roleId ? r : {
      ...r, permissions: enabled
        ? [...new Set([...r.permissions, permission])]
        : r.permissions.filter((p) => p !== permission),
    }));
  };
  const addRole = () => {
    const title = roleName.trim().slice(0, 32);
    if (!title || roles.length >= 16) return;
    const id = `role-${crypto.randomUUID().slice(0, 8)}`;
    setRoles((all) => [...all, { id, name: title, permissions: [] }]);
    setRoleName("");
  };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await updateGroup(gid, {
        name, description, members: [...sel], roles, memberRoles, autoRole, avatar, banner,
      });
      toast("Grupo atualizado");
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Erro ao salvar"); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title="Detalhes do grupo" onClose={onClose}>
      <div className="group-cover" style={banner ? { backgroundImage: `url(${banner})` } : undefined}>
        <div className="group-cover-avatar">
          <Avatar name={g.name} seed={g.id} src={avatar} group />
        </div>
      </div>
      {owner && (
        <>
          <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { void readImage(e.target.files?.[0], "avatar"); e.currentTarget.value = ""; }} />
          <input ref={bannerInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { void readImage(e.target.files?.[0], "banner"); e.currentTarget.value = ""; }} />
          <div className="row-btns">
            <button className="btn" onClick={() => avatarInput.current?.click()}>Imagem do grupo</button>
            <button className="btn" onClick={() => bannerInput.current?.click()}>Banner do grupo</button>
          </div>
        </>
      )}
      <div className="muted small">Membros: {g.members.length} · Criado por {label(g.owner)}</div>
      <label className="field">Nome do grupo
        <input className="input" value={name} maxLength={40} disabled={!owner} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">Descrição
        <textarea className="input" rows={3} maxLength={500} value={description} disabled={!owner} onChange={(e) => setDescription(e.target.value)} placeholder="Sobre este grupo" />
      </label>
      <div className="muted small">Membros ({g.members.length}){owner ? " — marque para incluir ou remover" : ""}</div>
      <div className="members">
        {owner
          ? [...new Map([...pool.map((c) => [c.id, c] as const), ...g.members.filter((m) => m !== userId).map((m) => [m, local.contacts.find((c) => c.id === m) ?? { id: m, alias: label(m), avatar: undefined }] as const)]).values()].map((c) => (
              <label key={c.id} className="member">
                <Avatar name={c.alias} seed={c.id} size="sm" src={c.avatar} /><span>{c.alias}</span>
                <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(c.id) : n.delete(c.id); setSel(n); }} />
              </label>
            ))
          : g.members.map((m) => (
              <div key={m} className="member">
                <Avatar name={label(m)} seed={m} size="sm" />
                <span>{label(m)}{m === g.owner ? " · dono" : ""}</span>
                <span className="role-badge">{roles.find((r) => r.id === (memberRoles[m] ?? "everyone"))?.name ?? "@Everyone"}</span>
              </div>
            ))}
      </div>
      {owner && <>
        <section className="group-roles">
          <h3>Cargos e permissões</h3>
          <p className="muted small">@Everyone começa sem permissões. Sem cargo com permissões, membros só podem ler e sair do grupo. Configure envio de mensagens e chamadas nos cargos abaixo.</p>
          <label className="field">Cargo automático
            <select className="input" value={autoRole} onChange={(e) => setAutoRole(e.target.value)}>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          {roles.map((role) => (
            <div className="role-card" key={role.id}>
              <div className="role-card-head"><b>{role.name}</b>{role.id !== "everyone" && <button className="btn ghost" onClick={() => {
                setRoles((all) => all.filter((r) => r.id !== role.id));
                setMemberRoles((map) => Object.fromEntries(Object.entries(map).map(([id, value]) => [id, value === role.id ? autoRole : value])));
                if (autoRole === role.id) setAutoRole("everyone");
              }}>Remover</button>}</div>
              <label className="check"><input type="checkbox" checked={role.permissions.includes("send_messages")} disabled={role.id === "everyone"} onChange={(e) => togglePermission(role.id, "send_messages", e.target.checked)} /><span>Enviar mensagens</span></label>
              <label className="check"><input type="checkbox" checked={role.permissions.includes("voice_call")} disabled={role.id === "everyone"} onChange={(e) => togglePermission(role.id, "voice_call", e.target.checked)} /><span>Iniciar chamadas em grupo</span></label>
              <label className="check"><input type="checkbox" checked={role.permissions.includes("view_audit")} disabled={role.id === "everyone"} onChange={(e) => togglePermission(role.id, "view_audit", e.target.checked)} /><span>Ver registro de auditoria</span></label>
            </div>
          ))}
          <div className="row-btns">
            <input className="input" value={roleName} maxLength={32} onChange={(e) => setRoleName(e.target.value)} placeholder="Nome do novo cargo" />
            <button className="btn" disabled={!roleName.trim() || roles.length >= 16} onClick={addRole}>Criar cargo</button>
          </div>
          <h4>Distribuir cargos</h4>
          {g.members.map((id) => id !== userId && (
            <label className="field role-member" key={id}>
              <span>{label(id)}</span>
              <select className="input" value={memberRoles[id] ?? "everyone"} onChange={(e) => setMemberRoles((map) => ({ ...map, [id]: e.target.value }))}>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          ))}
        </section>
      </>}
      {canViewAudit && (
        <section className="group-audit">
          <h3>Registro de auditoria</h3>
          {(g.audit ?? []).length ? [...(g.audit ?? [])].reverse().slice(0, 30).map((entry) => (
            <div className="audit-entry" key={entry.id}>
              <span>{label(entry.actor)} · {entry.action}{entry.target ? ` · ${label(entry.target)}` : ""}</span>
              <time>{new Date(entry.ts).toLocaleString("pt-BR")}</time>
            </div>
          )) : <p className="muted small">Ainda não há eventos registrados.</p>}
        </section>
      )}
      {err && <div className="error" role="alert">{err}</div>}
      {owner && (
        <button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar alterações"}</button>
      )}
      <button className="btn danger" onClick={async () => { await leaveGroup(gid); onClose(); }}>Sair do grupo</button>
    </Dialog>
  );
}

const PAGE = 80;
const coarse = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

function ChatMenu({ peer, onClose, onProfile, onGroup }: { peer: string; onClose: () => void; onProfile: () => void; onGroup: () => void }) {
  const { local, userId, setContactTtl, setBlocked, updateGroup } = useApp();
  const group = peer.startsWith("g:") ? local?.groups.find((g) => g.id === peer.slice(2)) : undefined;
  const contact = group ? undefined : local?.contacts.find((c) => c.id === peer);
  if (!group && !contact) return null;
  const ttl = group ? group.ttl : contact!.ttl;
  const canTtl = !group || group.owner === userId;
  return (
    <Dialog title="Opções da conversa" onClose={onClose}>
      <button className="menu-item" onClick={() => { onClose(); (group ? onGroup : onProfile)(); }}>
        {group ? <IconSettings /> : <IconUser />}{group ? "Ver e editar grupo" : "Ver perfil"}
      </button>
      <label className="field"><span style={{ display: "flex", gap: 8, alignItems: "center" }}><IconClock /> Mensagens temporárias</span>
        <select className="input" value={ttl} disabled={!canTtl} onChange={(e) => (group ? void updateGroup(group.id, { ttl: Number(e.target.value) }) : setContactTtl(peer, Number(e.target.value)))}>
          {TTL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value ? `Apagar ${o.label} após ler` : "Sem autodestruição"}</option>)}
        </select>
        {!canTtl && <span className="muted small" style={{ fontWeight: 400 }}>Só o criador do grupo altera isto.</span>}
      </label>
      {contact && (
        <button className={`menu-item ${contact.blocked ? "" : "bad"}`} onClick={() => { setBlocked(peer, !contact.blocked); onClose(); }}>
          <IconBlock />{contact.blocked ? "Desbloquear contato" : "Bloquear contato"}
        </button>
      )}
    </Dialog>
  );
}

export default function Chat({ peer, onBack, onReport, toast }: { peer: string; onBack: () => void; onReport: (m: Msg) => void; toast: (t: string) => void }) {
  const app = useApp();
  const { local, userId, activity, typing, sendActivity, sendText, sendImage, sendAudio, markRead, setBlocked, acceptContact, deleteMessage, startCall, startGroupCall, acceptGroup, leaveGroup } = app;
  const isGroup = peer.startsWith("g:");
  const contact = isGroup ? undefined : local?.contacts.find((c) => c.id === peer);
  const group = isGroup ? local?.groups.find((g) => g.id === peer.slice(2)) : undefined;
  const all = useMemo(() => (local?.messages ?? []).filter((m) => m.peer === peer).sort((a, b) => a.ts - b.ts), [local?.messages, peer]);
  const [limit, setLimit] = useState(PAGE);
  const msgs = all.length > limit ? all.slice(all.length - limit) : all;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [mentions, setMentions] = useState<string[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [dlg, setDlg] = useState<"profile" | "group" | "menu" | null>(null);
  const [recSec, setRecSec] = useState<number | null>(null);
  const rec = useRef<Recorder | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const insertEmoji = useCallback((emoji: string) => {
    const el = ta.current;
    const start = el?.selectionStart ?? null;
    const end = el?.selectionEnd ?? null;
    setText((cur) => {
      if (start === null || end === null) return cur + emoji;
      return cur.slice(0, start) + emoji + cur.slice(end);
    });
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = (start ?? el.value.length) + emoji.length;
      if (!matchMedia("(pointer: coarse)").matches) el.focus();
      el.setSelectionRange(pos, pos);
    });
  }, []);
  const lastTypingSent = useRef(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 3000); return () => clearInterval(timer); }, []);
  const activityRef = useRef(activity);
  activityRef.current = activity;
  useEffect(() => {
    if (isGroup || !contact || contact.blocked || contact.requested) return;
    let attempts = 0;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      const recent = Date.now() - (activityRef.current[peer] ?? 0) < 65_000;
      // Não acumula sondagens sem limite na fila de contatos ausentes.
      if (attempts >= 3 && !recent) return;
      attempts++;
      sendActivity(peer, "ping");
    };
    const wake = () => { if (document.visibilityState === "visible") { attempts = 0; ping(); } };
    ping();
    const timer = window.setInterval(ping, 25_000);
    document.addEventListener("visibilitychange", wake);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", wake); };
  }, [peer, isGroup, contact?.blocked, contact?.requested, sendActivity]);
  const stick = useRef(true); // só rola para o fim se a pessoa já estava no fim

  const lastId = msgs[msgs.length - 1]?.id;
  const lastOut = msgs[msgs.length - 1]?.dir === "out";
  useEffect(() => {
    if (stick.current || lastOut) end.current?.scrollIntoView({ block: "end" });
    if (document.visibilityState === "visible") markRead(peer);
  }, [lastId, lastOut, peer, markRead]);
  useEffect(() => {
    const v = () => document.visibilityState === "visible" && markRead(peer);
    document.addEventListener("visibilitychange", v);
    return () => document.removeEventListener("visibilitychange", v);
  }, [peer, markRead]);
  useEffect(() => {
    if (recSec === null) return;
    const i = setInterval(() => setRecSec((s) => (s === null ? s : s + 1)), 1000);
    return () => clearInterval(i);
  }, [recSec === null]);
  useEffect(() => () => rec.current?.cancel(), [peer]);
  useEffect(() => { // caixa de texto cresce com o conteúdo
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const onScroll = useCallback(() => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  if (!contact && !group) return null;
  const title = group ? group.name : contact!.alias;
  const ownRole = group?.roles?.find((r) => r.id === (group.memberRoles?.[userId ?? ""] ?? "everyone"));
  const canSendGroup = !group || group.owner === userId || !!ownRole?.permissions.includes("send_messages");
  const canCallGroup = !!group && (group.owner === userId || !!ownRole?.permissions.includes("voice_call"));
  const locked = !!contact?.blocked || !!group?.requested || !canSendGroup;
  const nameOf = (id?: string) => (id ? local?.contacts.find((c) => c.id === id)?.alias ?? shortId(id) : "");
  const mentionMatch = group ? text.match(/(?:^|\s)@([^\s@]*)$/) : null;
  const mentionOptions = mentionMatch
    ? group!.members.filter((id) => id !== userId).map((id) => ({ id, name: nameOf(id) }))
      .filter((x) => x.name.toLowerCase().includes(mentionMatch[1].toLowerCase())).slice(0, 6)
    : [];

  async function wrap(f: () => Promise<void>, fail: string) {
    setSending(true);
    try { await f(); } catch (e) { toast(e instanceof Error ? e.message : fail); } finally { setSending(false); }
  }
  const send = () => {
    const draft = text;
    if (!draft.trim() || locked) return;
    const reply = replyTo ?? undefined;
    const selected = mentions.filter((id) => draft.includes(`@${nameOf(id)}`));
    stick.current = true;
    setText(""); setMentions([]); setReplyTo(null); ta.current?.focus();
    void sendText(peer, draft, reply, selected).catch((e) => {
      setText((current) => current || draft);
      toast(e instanceof Error ? e.message : "Falha ao enviar");
    });
  };
  const pick = (f?: File) => f && void wrap(async () => { stick.current = true; await sendImage(peer, f); }, "Falha ao enviar imagem").finally(() => { if (file.current) file.current.value = ""; });

  async function startRec() {
    try { rec.current = await startRecording(() => void finishRec(true)); setRecSec(0); } catch (e) { toast(e instanceof Error ? e.message : "Falha ao gravar"); }
  }
  async function finishRec(send: boolean) {
    const r = rec.current;
    rec.current = null;
    setRecSec(null);
    if (!r) return;
    if (!send) return r.cancel();
    await wrap(async () => { const a = await r.stop(); if (a.dur >= 1) { stick.current = true; await sendAudio(peer, a.dataUrl, a.dur); } }, "Falha ao enviar áudio");
  }
  const call = (v: boolean) => (group ? startGroupCall(group.id, v) : startCall(peer, v)).catch((e) => toast(e instanceof Error ? e.message : "Falha na chamada"));
  const toggleSel = (id: string) => { if (window.getSelection()?.toString()) return; setSel((cur) => (cur === id ? null : id)); };
  const typers = Object.entries(typing[peer] ?? {}).filter(([, ts]) => now - ts < 8000).map(([id]) => nameOf(id));
  const lastSeen = contact?.lastSeen;
  const isOnline = !!contact && !!activity[contact.id] && now - activity[contact.id] < 65_000;
  const subtitle = typers.length ? (group ? `${typers.slice(0, 2).join(", ")} ${typers.length > 1 ? "estão digitando" : "está digitando"}` : "digitando…")
    : group ? `${group.members.length} membros` : isOnline ? "Online" : lastSeen ? `Offline · visto por último ${new Date(lastSeen).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Status indisponível";

  return (
    <>
      <div className="chat-head">
        <button className="icon-btn back" onClick={onBack} aria-label="Voltar para as conversas"><IconBack /></button>
        <button className="who-btn" onClick={() => setDlg(group ? "group" : "profile")} aria-label={`Abrir ${group ? "grupo" : "perfil"} de ${title}`}>
          <span className={`av-wrap ${isOnline ? "online" : ""}`}><Avatar name={title} seed={group?.id ?? contact!.id} size="sm" src={group?.avatar ?? contact?.avatar} group={!!group} /></span>
          <span className="t"><b>{title}</b><span className={`small ${isOnline || typers.length ? "presence-active" : "muted"}`}>{subtitle}</span></span>
        </button>
        {contact && !contact.blocked && !contact.requested && (
          <>
            <button className="icon-btn" aria-label="Chamada de voz" title="Chamada de voz" onClick={() => void call(false)}><IconPhone /></button>
            <button className="icon-btn" aria-label="Chamada de vídeo" title="Chamada de vídeo" onClick={() => void call(true)}><IconVideo /></button>
          </>
        )}
        {group && !group.requested && canCallGroup && (
          <>
            <button className="icon-btn" aria-label="Chamada de voz em grupo" title="Chamada de voz em grupo (até 5 pessoas)" onClick={() => void call(false)}><IconPhone /></button>
            <button className="icon-btn" aria-label="Chamada de vídeo em grupo" title="Chamada de vídeo em grupo (até 5 pessoas)" onClick={() => void call(true)}><IconVideo /></button>
          </>
        )}
        <button className="icon-btn" aria-label="Mais opções" title="Mais opções" onClick={() => setDlg("menu")}><IconMore /></button>
      </div>

      {contact?.requested && (
        <div className="banner" style={{ margin: 12 }}>
          <span>Este contato escreveu para você e ainda não foi aceito. Confirmações de leitura e chamadas estão desligadas.</span>
          <span style={{ display: "flex", gap: 6 }}>
            <button className="btn" style={{ minHeight: 38 }} onClick={() => acceptContact(peer)}>Aceitar</button>
            <button className="btn danger" style={{ minHeight: 38 }} onClick={() => setBlocked(peer, true)}>Bloquear</button>
          </span>
        </div>
      )}
      {group?.requested && (
        <div className="banner" style={{ margin: 12 }}>
          <span>Você foi convidado para este grupo por alguém que não está nos seus contatos.</span>
          <span style={{ display: "flex", gap: 6 }}>
            <button className="btn" style={{ minHeight: 38 }} onClick={() => acceptGroup(group.id)}>Entrar</button>
            <button className="btn danger" style={{ minHeight: 38 }} onClick={() => void leaveGroup(group.id).then(onBack)}>Recusar</button>
          </span>
        </div>
      )}
      {group && !group.requested && !canSendGroup && (
        <div className="banner" style={{ margin: 12 }} role="status">Seu cargo não permite enviar mensagens. Peça ao dono do grupo para ajustar suas permissões.</div>
      )}
      {contact?.blocked && <div className="banner" style={{ margin: 12 }}>Contato bloqueado: você não recebe nem envia mensagens.</div>}

      <div className="msgs" ref={box} onScroll={onScroll} onClick={(e) => e.target === e.currentTarget && setSel(null)}>
        {all.length > limit && <button className="btn ghost older" onClick={() => setLimit((l) => l + PAGE)}>Mensagens anteriores</button>}
        {all.length === 0 && (
          <div className="placeholder"><IconShieldCheck /><div>Conversa protegida de ponta a ponta.<br />{group ? "Só os membros do grupo podem ler." : `Só você e ${title} podem ler.`}</div></div>
        )}
        {!group?.requested && msgs.map((m, i) => (
          <Fragment key={m.id + (m.from ?? "")}>
            {(i === 0 || new Date(msgs[i - 1].ts).toDateString() !== new Date(m.ts).toDateString()) && (
              <div className="day">{new Date(m.ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}</div>
            )}
            <div className={`bubble ${m.dir} ${sel === m.id ? "sel" : ""} ${m.mentions?.includes(userId ?? "") ? "mentioned" : ""}`} onClick={() => toggleSel(m.id)}>
              {group && m.dir === "in" && <div className="who">{nameOf(m.from)}</div>}
              {m.mentions?.includes(userId ?? "") && <div className="mention-notice">Mencionou você</div>}
              {m.reply && <div className="quote">{m.reply.text}</div>}
              {m.image && <img src={m.image} alt="Imagem recebida" loading="lazy" decoding="async" />}
              {m.audio && <div className="audio" onClick={(e) => e.stopPropagation()}><audio controls preload="metadata" src={m.audio} />{m.dur ? <span className="small">{m.dur}s</span> : null}</div>}
              {m.text}
              <div className="foot">
                {m.ttl > 0 && <IconClock aria-label="Mensagem temporária" />}
                <span>{time(m.ts)}</span>
                {m.dir === "out" && m.pending && <span className="small muted" aria-label="Enviando">…</span>}
                {m.dir === "out" && !m.pending && !group && (m.readAt ? <IconCheckDouble aria-label="Lida" /> : <IconCheck aria-label="Enviada" />)}
                {m.dir === "out" && !m.pending && group && <IconCheck aria-label="Enviada" />}
                {m.reported && <span className="reported">denunciada</span>}
              </div>
            </div>
            {sel === m.id && (
              <div className={`msg-actions ${m.dir}`}>
                <button onClick={() => { setReplyTo(m); setSel(null); ta.current?.focus(); }}><IconReply /> Responder</button>
                {m.dir === "in" && m.frank && !m.reported && <button className="bad" onClick={() => { setSel(null); onReport(m); }}><IconFlag /> Denunciar</button>}
                <button className="bad" onClick={() => { deleteMessage(m.id); setSel(null); }}><IconTrash /> Apagar</button>
              </div>
            )}
          </Fragment>
        ))}
        {typers.length > 0 && <div className="typing-indicator" role="status" aria-label={subtitle}><span className="typing-dots" aria-hidden="true"><i /><i /><i /></span><span>{subtitle}</span></div>}
        <div ref={end} />
      </div>

      {replyTo && (
        <div className="replybar">
          <IconReply />
          <span>{replyTo.text ?? (replyTo.kind === "audio" ? "Áudio" : "Imagem")}</span>
          <button className="icon-btn" style={{ width: 36, height: 36 }} aria-label="Cancelar resposta" onClick={() => setReplyTo(null)}><IconX /></button>
        </div>
      )}
      {mentionOptions.length > 0 && (
        <div className="mention-menu" role="listbox" aria-label="Mencionar membro">
          {mentionOptions.map((option) => (
            <button key={option.id} type="button" role="option" onClick={() => {
              const replacement = `@${option.name} `;
              setText((current) => current.replace(/(?:^|\s)@([^\s@]*)$/, (match) => `${match.startsWith(" ") ? " " : ""}${replacement}`));
              setMentions((ids) => [...new Set([...ids, option.id])]);
              ta.current?.focus();
            }}>
              <Avatar name={option.name} seed={option.id} size="sm" src={local?.contacts.find((c) => c.id === option.id)?.avatar} />
              <span>{option.name}</span>
            </button>
          ))}
        </div>
      )}
      {emojiOpen && <Suspense fallback={<div className="emoji-pop emoji-loading"><IconLoader className="spin" /> Carregando emojis…</div>}><EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} /></Suspense>}
      <div className="composer">
        {recSec !== null ? (
          <>
            <button className="icon-btn" aria-label="Cancelar gravação" onClick={() => void finishRec(false)}><IconTrash /></button>
            <div className="rec"><i /> Gravando {Math.floor(recSec / 60)}:{String(recSec % 60).padStart(2, "0")}</div>
            <button className="btn primary send" aria-label="Enviar áudio" disabled={sending} onClick={() => void finishRec(true)}><IconSend /></button>
          </>
        ) : (
          <>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <button className="icon-btn" aria-label="Anexar imagem" disabled={sending || locked || !imageSendingAllowed()} title={imageSendingAllowed() ? "Anexar imagem" : "Envio de imagens desativado"} onClick={() => file.current?.click()}><IconAttach /></button>
            <button className={`icon-btn emoji-toggle ${emojiOpen ? "on" : ""}`} data-emoji-toggle aria-label="Emojis" aria-expanded={emojiOpen} disabled={locked} onClick={() => setEmojiOpen((v) => !v)}><IconSmile /></button>
            <textarea ref={ta} className="input" rows={1} placeholder="Mensagem" value={text} disabled={locked} enterKeyHint="send" autoComplete="off" onChange={(e) => { const value = e.target.value; setText(value); if (value.trim() && Date.now() - lastTypingSent.current > 4000) { lastTypingSent.current = Date.now(); sendActivity(peer, "typing"); } }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !coarse()) { e.preventDefault(); send(); } }} />
            {text.trim() ? (
              <button className="btn primary send" aria-label="Enviar" disabled={sending || locked} onClick={send}><IconSend /></button>
            ) : (
              <button className="btn primary send" aria-label="Gravar áudio" disabled={sending || locked} onClick={() => void startRec()}><IconMic /></button>
            )}
          </>
        )}
      </div>
      {dlg === "menu" && <ChatMenu peer={peer} onClose={() => setDlg(null)} onProfile={() => setDlg("profile")} onGroup={() => setDlg("group")} />}
      {dlg === "profile" && contact && <ProfileDialog id={contact.id} onClose={() => setDlg(null)} />}
      {dlg === "group" && group && <GroupDialog gid={group.id} onClose={() => setDlg(null)} toast={toast} />}
    </>
  );
}
