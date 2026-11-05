import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/store";
import NodiaMarkdown from "./NodiaMarkdown";
import { IconBack, IconSend, IconShieldCheck, IconSparkle, IconTrash } from "../icons";

const portrait = `${import.meta.env.BASE_URL}nodia-avatar.webp`;
const suggestions = ["Como protejo minha conta?", "Como enviar um vídeo?", "Meu perfil não aparece em outro aparelho"];

export default function NodiaChat({ onBack }: { onBack: () => void }) {
  const { local, nodiaBusy, nodiaDraft, consentNodia, clearNodia, sendNodia } = useApp();
  const [text, setText] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const messages = local?.nodiaMessages ?? [];
  useEffect(() => { if(stick.current && scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight; }, [messages.length, nodiaBusy, nodiaDraft, pending]);
  const send = async () => {
    const content = text.trim();
    if (!content || nodiaBusy || !local?.nodiaConsent) return;
    setError(""); setPending(content); setText(""); stick.current=true;
    try { await sendNodia(content); }
    catch (e) { const partial=!!(e && typeof e === "object" && "partial" in e && e.partial); if(!partial)setText(content); setError(partial ? "A resposta foi interrompida. Você pode perguntar novamente." : "Nodia está indisponível no momento. Aguarde um pouco e tente novamente."); }
    finally { setPending(""); }
  };
  return <div className="nodiapane">
    <header className="nodia-head">
      <button className="icon-btn nodia-back" onClick={onBack} aria-label="Voltar"><IconBack /></button>
      <img className="nodia-head-avatar" src={portrait} alt="" />
      <div className="nodia-head-text"><strong>Nodia <svg className="nodia-verified" viewBox="0 0 24 24" role="img" aria-label="Assistente oficial verificada"><title>Assistente oficial verificada</title><path fill="currentColor" d="m12 1 2.5 1.7 3-.1 1.2 2.7 2.6 1.5-.5 3 1.2 2.2-1.2 2.7.5 2.5-2.6 1.5-1.2 2.7-3-.1L12 23l-2.5-1.7-3 .1-1.2-2.7-2.6-1.5.5-2.5L2 12l1.2-2.2-.5-3 2.6-1.5 1.2-2.7 3 .1z"/><path fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="m7.5 12 3 3 6-6"/></svg> <span>IA</span></strong><small>Assistente do SeuChatSeguro</small></div>
      <button className="icon-btn" aria-label="Limpar conversa com Nodia" title="Limpar conversa" disabled={nodiaBusy || !messages.length} onClick={() => { if (confirm("Apagar a conversa com a Nodia deste aparelho?")) clearNodia(); }}><IconTrash /></button>
    </header>
    <div className="nodia-scroll" ref={scroll} onScroll={e=>{const n=e.currentTarget;stick.current=n.scrollHeight-n.scrollTop-n.clientHeight<100}}>
      <div className="nodia-inner">
        <div className="nodia-hero"><div className="nodia-orbit"><img src={portrait} alt="Nodia" /></div><div className="nodia-label"><IconSparkle /> ASSISTENTE IA</div><h1>Olá, eu sou a Nodia.</h1><p>Estou aqui para ajudar você a aproveitar seu espaço com mais tranquilidade.</p></div>
        <div className="nodia-privacy"><IconShieldCheck /><div><strong>Converse com segurança</strong><p>As mensagens desta conversa são processadas por um serviço de IA externo e não usam criptografia ponta a ponta. Não envie sua senha, chaves ou frase de recuperação.</p>{!local?.nodiaConsent && <button className="btn primary" onClick={consentNodia}>Entendi e quero conversar</button>}</div></div>
        {local?.nodiaConsent && messages.length === 0 && !pending && <div className="nodia-starters"><div className="nodia-section-title">POR ONDE COMEÇAR</div><div>{suggestions.map((s) => <button key={s} onClick={() => setText(s)}>{s} <span>↗</span></button>)}</div></div>}
        <div className="nodia-messages">{messages.map((m) => <div key={m.id} className={`nodia-line ${m.role === "user" ? "mine" : "hers"}`}>{m.role === "assistant" && <img src={portrait} alt="" />}<div className="nodia-bubble">{m.role === "assistant" ? <NodiaMarkdown content={m.content}/> : m.content}</div></div>)}{pending && <div className="nodia-line mine"><div className="nodia-bubble">{pending}</div></div>}{nodiaBusy && <div className="nodia-line hers"><img src={portrait} alt="" />{nodiaDraft ? <div className="nodia-bubble"><NodiaMarkdown content={nodiaDraft} streaming/></div> : <div className="nodia-bubble nodia-thinking"><span /> <span /> <span /><b>Nodia está preparando uma resposta</b></div>}</div>}<span className="sr-only" role="status">{nodiaBusy ? (nodiaDraft ? "Nodia está escrevendo" : "Nodia está preparando uma resposta") : ""}</span></div>
      </div>
    </div>
    {local?.nodiaConsent && <form className="nodia-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}><div className="nodia-compose-inner">{error && <div className="nodia-error" role="alert">{error}</div>}<div className="nodia-input-wrap"><textarea aria-label="Mensagem para Nodia" placeholder="Pergunte à Nodia..." maxLength={3000} rows={1} value={text} disabled={nodiaBusy} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><button type="submit" className="nodia-send" disabled={!text.trim() || nodiaBusy} aria-label="Enviar para Nodia"><IconSend /></button></div></div></form>}
  </div>;
}
