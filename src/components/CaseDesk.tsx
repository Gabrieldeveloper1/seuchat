import { useCallback, useEffect, useState } from "react";
import { useApp } from "../lib/store";
import type { ModerationCase } from "../lib/api";
import { IconBack, IconFlag, IconRefresh, IconShieldCheck } from "../icons";
import CaseConversation from "./CaseConversation";

const avatar = `${import.meta.env.BASE_URL}nodia-avatar.webp`;
const statusName = (s: ModerationCase["status"]) => ({open:"Recebida",reviewing:"Em análise",actioned:"Concluída",dismissed:"Concluída"}[s]);
const appealName = (s: NonNullable<ModerationCase["appeal"]>["status"]) => ({open:"Em análise",accepted:"Aceita",rejected:"Não aceita"}[s]);
export default function CaseDesk({ id, onList, onOpen, onBack, onAssistant }: { id:string; onList:()=>void; onOpen:(id:string)=>void; onBack:()=>void; onAssistant:()=>void }) {
  const { listCases, appealCase } = useApp();
  const [cases,setCases]=useState<ModerationCase[]>([]); const [busy,setBusy]=useState(true); const [error,setError]=useState("");
  const [showAppeal,setShowAppeal]=useState(false);
  const [reason,setReason]=useState<"mistake" | "context" | "other">("mistake"); const [note,setNote]=useState(""); const [sending,setSending]=useState(false);
  const refresh=useCallback(async()=>{setError("");try{const r=await listCases();setCases(r);return r}catch{setError("Não foi possível consultar os casos. Verifique a conexão e tente novamente.");return null}finally{setBusy(false)}},[listCases]);
  useEffect(()=>{setBusy(id ? !cases.some(c=>c.id===id) : !cases.length);setShowAppeal(false);void refresh();},[id,refresh]);
  useEffect(()=>{const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh()},30000);return()=>clearInterval(timer)},[refresh]);
  const current=cases.find((c)=>c.id===id);
  const canAppeal=!!current && !current.appeal && ((current.role==='reporter' && current.status==='dismissed') || (current.role==='reported' && current.status==='actioned'));
  return <div className="nodiapane case-pane">
    <header className="nodia-head"><button className="icon-btn" onClick={id?onList:onBack} aria-label="Voltar"><IconBack /></button><img className="nodia-head-avatar" src={avatar} alt="" /><div className="nodia-head-text"><strong>Nodia <IconShieldCheck aria-label="Assistente oficial" style={{width:17,height:17,color:"#356be5"}} /></strong><small>Central de denúncias</small></div><button className="icon-btn" onClick={()=>void refresh()} aria-label="Atualizar status"><IconRefresh /></button></header>
    <div className="case-scroll"><div className="case-inner">
      {!id ? <><div className="case-heading"><span><IconFlag /> CENTRAL DE SEGURANÇA</span><h1>Denúncias e apelações</h1><p>Consulte seus casos e acompanhe as respostas da equipe.</p></div><div className="case-warning"><IconShieldCheck /><p>Você pode denunciar diferentes situações. Nesta versão, o banimento está limitado a suspeitas verificadas de <b>abuso ou exploração sexual de crianças e adolescentes</b>, após análise humana. Conteúdo comum envolvendo crianças não justifica banimento. A Nodia não decide casos.</p></div>{busy?<p className="muted">Carregando casos…</p>:!cases.length&&!error?<p className="case-empty">Você ainda não possui casos disponíveis.</p>:null}{cases.map(c=><button key={`${c.id}-${c.role}`} className="case-card" onClick={()=>onOpen(c.id)}><span><b>{c.role==='reporter'?'Minha denúncia':'Decisão sobre minha conta'}</b><small>Protocolo {c.id.slice(0,8)} · {new Date(c.createdAt).toLocaleDateString('pt-BR')}</small></span><span className="case-chip">{c.appeal?.status==='open'?'Apelação em análise':statusName(c.status)}</span></button>)}</> : <>
        {busy?<p className="muted">Carregando caso…</p>:current?<><div className="case-top"><div><span>PROTOCOLO {current.id.slice(0,8).toUpperCase()}</span><h1>{current.role==='reporter'?'Sua denúncia':'Decisão sobre sua conta'}</h1></div><span className="case-chip">{statusName(current.status)}</span></div><div className="case-timeline"><span>Denúncia: <b>{statusName(current.status)}</b></span>{current.appeal&&<span>Apelação: <b>{appealName(current.appeal.status)}</b></span>}</div>
        {current.status==='actioned' && <p className="case-result">{current.role==='reported' ? 'Este caso resultou em banimento. Você pode solicitar revisão se ainda não apelou.' : 'A equipe concluiu o caso com aplicação de uma medida.'}</p>}{current.status==='dismissed' && <p className="case-result">{current.role==='reported' ? 'O banimento vinculado a este caso foi revisto. Outras decisões podem continuar em vigor.' : 'A equipe concluiu o caso sem aplicar uma medida por esta denúncia.'}</p>}
        {current.role==='reporter' ? <CaseConversation id={current.id} /> : <div className="case-notice"><IconShieldCheck/><span>Use o formulário para solicitar revisão da decisão.</span></div>}
        <div className="case-quick"><button onClick={()=>void refresh()}>Ver status</button>{canAppeal&&<button onClick={()=>setShowAppeal(true)}>Fazer apelação</button>}<button onClick={onAssistant}>Assistente IA</button></div>
        {showAppeal&&canAppeal&&<form className="case-appeal" onSubmit={async(e)=>{e.preventDefault();setError("");setSending(true);try{await appealCase(current.id,reason,note.trim());setNote("");setShowAppeal(false);await refresh();}catch{setError('Não foi possível registrar a apelação. Tente novamente.')}finally{setSending(false)}}}><h2>Solicitar apelação</h2><p>A explicação será cifrada para a equipe de moderação, não para o serviço de IA. Não inclua imagens, links, conteúdo explícito, senhas ou dados pessoais desnecessários.</p><label>Motivo<select className="input" value={reason} onChange={e=>setReason(e.target.value as typeof reason)}><option value="mistake">Acredito que houve um erro</option><option value="context">É necessário rever o contexto</option><option value="other">Outro motivo</option></select></label><label>Explique seu pedido<textarea className="input" minLength={10} maxLength={1500} required value={note} onChange={e=>setNote(e.target.value)} rows={4} placeholder="Descreva por que a decisão deve ser revista." /></label><div><button type="submit" className="btn primary" disabled={sending}>{sending?'Enviando…':'Enviar apelação'}</button><button type="button" className="btn" onClick={()=>setShowAppeal(false)}>Cancelar</button></div></form>}
        </>:!error?<p className="case-empty">Caso indisponível para esta conta.</p>:null}</>}
      {error&&<div className="error" role="alert">{error} <button className="btn sm" onClick={()=>void refresh()}>Tentar novamente</button></div>}
    </div></div>

  </div>;
}
