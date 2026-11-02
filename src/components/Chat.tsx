import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/store";
import { IconAttach, IconBack, IconBlock, IconCheck, IconCheckDouble, IconClock, IconFlag, IconMic, IconMore, IconPhone, IconReply, IconSend, IconSettings, IconShieldCheck, IconTrash, IconUser, IconVideo, IconX } from "../icons";
import { TTL_OPTIONS, type Msg } from "../types";
import { shortId } from "../lib/util";
import { imageSendingAllowed } from "../lib/imageFilter";
import { startRecording, type Recorder } from "../lib/media";
import { formatPhone } from "../lib/phone";
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
        {c.phone && <div className="muted">{formatPhone(c.phone)}</div>}
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
  const [sel, setSel] = useState<Set<string>>(new Set(g?.members.filter((m) => m !== userId)));
  if (!g || !local) return null;
  const owner = g.owner === userId;
  const label = (id: string) => (id === userId ? "Você" : local.contacts.find((c) => c.id === id)?.alias ?? shortId(id));
  const pool = local.contacts.filter((c) => !c.blocked && !c.requested);
  return (
    <Dialog title="Grupo" onClose={onClose}>
      <label className="field">Nome
        <input className="input" value={name} maxLength={40} disabled={!owner} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="muted small">Membros ({g.members.length}){owner ? " — marque para incluir" : ""}</div>
      <div className="members">
        {owner
          ? pool.map((c) => (
              <label key={c.id} className="member">
                <Avatar name={c.alias} seed={c.id} size="sm" src={c.avatar} /><span>{c.alias}</span>
                <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(c.id) : n.delete(c.id); setSel(n); }} />
              </label>
            ))
          : g.members.map((m) => <div key={m} className="member"><Avatar name={label(m)} seed={m} size="sm" /><span>{label(m)}{m === g.owner ? " · criador" : ""}</span></div>)}
      </div>
      {owner && (
        <button className="btn primary" onClick={async () => {
          try { await updateGroup(gid, { name, members: [...sel] }); toast("Grupo atualizado"); onClose(); } catch (e) { toast(e instanceof Error ? e.message : "Erro"); }
        }}>Salvar alterações</button>
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
  const { local, sendText, sendImage, sendAudio, markRead, setBlocked, acceptContact, deleteMessage, startCall, startGroupCall, acceptGroup, leaveGroup } = app;
  const isGroup = peer.startsWith("g:");
  const contact = isGroup ? undefined : local?.contacts.find((c) => c.id === peer);
  const group = isGroup ? local?.groups.find((g) => g.id === peer.slice(2)) : undefined;
  const all = useMemo(() => (local?.messages ?? []).filter((m) => m.peer === peer).sort((a, b) => a.ts - b.ts), [local?.messages, peer]);
  const [limit, setLimit] = useState(PAGE);
  const msgs = all.length > limit ? all.slice(all.length - limit) : all;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [dlg, setDlg] = useState<"profile" | "group" | "menu" | null>(null);
  const [recSec, setRecSec] = useState<number | null>(null);
  const rec = useRef<Recorder | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
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
  const locked = !!contact?.blocked || !!group?.requested;
  const nameOf = (id?: string) => (id ? local?.contacts.find((c) => c.id === id)?.alias ?? shortId(id) : "");

  async function wrap(f: () => Promise<void>, fail: string) {
    setSending(true);
    try { await f(); } catch (e) { toast(e instanceof Error ? e.message : fail); } finally { setSending(false); }
  }
  const send = () => text.trim() && !sending && void wrap(async () => { stick.current = true; await sendText(peer, text, replyTo ?? undefined); setText(""); setReplyTo(null); ta.current?.focus(); }, "Falha ao enviar");
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
  const call = (v: boolean) => startCall(peer, v).catch((e) => toast(e instanceof Error ? e.message : "Falha na chamada"));
  const groupCall = (v: boolean) => group && startGroupCall(group.id, v).catch((e) => toast(e instanceof Error ? e.message : "Falha na chamada em grupo"));
  const toggleSel = (id: string) => { if (window.getSelection()?.toString()) return; setSel((cur) => (cur === id ? null : id)); };
  const subtitle = group ? `${group.members.length} membros` : `${contact!.name && contact!.name !== contact!.alias ? `${contact!.name} · ` : ""}${contact!.phone ? formatPhone(contact!.phone) : shortId(contact!.id)}`;

  return (
    <>
      <div className="chat-head">
        <button className="icon-btn back" onClick={onBack} aria-label="Voltar para as conversas"><IconBack /></button>
        <button className="who-btn" onClick={() => setDlg(group ? "group" : "profile")} aria-label={`Abrir ${group ? "grupo" : "perfil"} de ${title}`}>
          <Avatar name={title} seed={group?.id ?? contact!.id} size="sm" src={contact?.avatar} />
          <span className="t"><b>{title}</b><span className="muted small">{subtitle}</span></span>
        </button>
        {contact && !contact.blocked && !contact.requested && (
          <>
            <button className="icon-btn" aria-label="Chamada de voz" title="Chamada de voz" onClick={() => void call(false)}><IconPhone /></button>
            <button className="icon-btn" aria-label="Chamada de vídeo" title="Chamada de vídeo" onClick={() => void call(true)}><IconVideo /></button>
          </>
        )}
        {group && !group.requested && (
          <>
            <button className="icon-btn" aria-label="Chamada de voz em grupo" title="Chamada de voz em grupo" onClick={() => void groupCall(false)}><IconPhone /></button>
            <button className="icon-btn" aria-label="Chamada de vídeo em grupo" title="Chamada de vídeo em grupo" onClick={() => void groupCall(true)}><IconVideo /></button>
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
            <div className={`bubble ${m.dir} ${sel === m.id ? "sel" : ""}`} onClick={() => toggleSel(m.id)}>
              {group && m.dir === "in" && <div className="who">{nameOf(m.from)}</div>}
              {m.reply && <div className="quote">{m.reply.text}</div>}
              {m.image && <img src={m.image} alt="Imagem recebida" loading="lazy" decoding="async" />}
              {m.audio && <div className="audio" onClick={(e) => e.stopPropagation()}><audio controls preload="metadata" src={m.audio} />{m.dur ? <span className="small">{m.dur}s</span> : null}</div>}
              {m.text}
              <div className="foot">
                {m.ttl > 0 && <IconClock aria-label="Mensagem temporária" />}
                <span>{time(m.ts)}</span>
                {m.dir === "out" && !group && (m.readAt ? <IconCheckDouble aria-label="Lida" /> : <IconCheck aria-label="Enviada" />)}
                {m.dir === "out" && group && <IconCheck aria-label="Enviada" />}
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
        <div ref={end} />
      </div>

      {replyTo && (
        <div className="replybar">
          <IconReply />
          <span>{replyTo.text ?? (replyTo.kind === "audio" ? "Áudio" : "Imagem")}</span>
          <button className="icon-btn" style={{ width: 36, height: 36 }} aria-label="Cancelar resposta" onClick={() => setReplyTo(null)}><IconX /></button>
        </div>
      )}
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
            <textarea ref={ta} className="input" rows={1} placeholder="Mensagem" value={text} disabled={locked} enterKeyHint="send" autoComplete="off" onChange={(e) => setText(e.target.value)}
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
