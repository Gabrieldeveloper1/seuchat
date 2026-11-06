import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/store";
import NodiaMarkdown from "./NodiaMarkdown";
import NodiaLoader from "./NodiaLoader";
import Dialog from "./Dialog";
import { IconAttach, IconBack, IconChat, IconChevronRight, IconLock, IconMic, IconPhone, IconSend, IconShieldCheck, IconSparkle, IconTrash, IconUser, IconVolume } from "../icons";

const portrait = `${import.meta.env.BASE_URL}nodia-avatar.webp`;
type RecognitionResult = ArrayLike<{ transcript: string }>;
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
const helpTopics = [
  { title: "Conta e segurança", detail: "Proteção, senha e recuperação", prompt: "Como posso proteger minha conta e recuperar o acesso com segurança?", Icon: IconLock },
  { title: "Conversas e encaminhamento", detail: "Mensagens, respostas e grupos", prompt: "Como encaminhar uma mensagem para um contato ou grupo?", Icon: IconChat },
  { title: "Fotos, vídeos e arquivos", detail: "Envio e recebimento de mídia", prompt: "Como enviar fotos, vídeos e arquivos em uma conversa?", Icon: IconAttach },
  { title: "Perfil e privacidade", detail: "Dados visíveis e configurações", prompt: "Como ajusto meu perfil e minhas opções de privacidade?", Icon: IconUser },
];

export default function NodiaChat({ onBack, active }: { onBack: () => void; active: boolean }) {
  const { local, nodiaBusy, nodiaDraft, consentNodia, clearNodia, sendNodia } = useApp();
  const [text, setText] = useState("");
  const loader = "coffee";
  type Queued = {id:string; text:string; failed?:boolean};
  const [queue, setQueue] = useState<Queued[]>([]);
  const queueRef = useRef<Queued[]>([]);
  const running = useRef(false);
  const setQueueNow = (items:Queued[]) => { queueRef.current=items; setQueue(items); };
  const [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const voiceActive = useRef(false);
  const waitingForVoiceReply = useRef(false);
  const startRecognitionRef = useRef<() => void>(() => {});
  const lastVoiceReply = useRef<string | null>(null);
  const [voiceDialog, setVoiceDialog] = useState(false);
  const [voiceCall, setVoiceCall] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const stick = useRef(true);
  const messages = local?.nodiaMessages ?? [];
  useEffect(() => { if(stick.current && scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight; }, [messages.length, nodiaBusy, nodiaDraft, queue.length]);
  const speakMessage = (content: string, onDone?: () => void) => {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setVoiceStatus("A leitura em voz alta não é compatível com este navegador.");
      onDone?.();
      return;
    }
    const plain = content
      .replace(/```[\s\S]*?```/g, " bloco de código omitido ")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[>#*_`~|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!plain) { onDone?.(); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(plain);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.lang.toLowerCase() === "pt-br")
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("pt"))
      ?? null;
    utterance.lang = utterance.voice?.lang ?? "pt-BR";
    utterance.rate = 0.96;
    utterance.onend = () => onDone?.();
    utterance.onerror = () => onDone?.();
    window.speechSynthesis.speak(utterance);
  };
  const startVoiceConversation = () => {
    const browser = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const SpeechRecognitionAPI = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setVoiceStatus("O ditado por voz ainda não é compatível com este navegador. Você pode ouvir respostas e continuar digitando.");
      return;
    }
    if (!local?.nodiaConsent || nodiaBusy || queue.length) return;
    voiceActive.current = true;
    waitingForVoiceReply.current = false;
    lastVoiceReply.current = [...messages].reverse().find((message) => message.role === "assistant")?.id ?? null;
    setVoiceCall(true);
    setVoiceStatus("Estou ouvindo. Fale sua pergunta.");
    const listen = () => {
      if (!voiceActive.current || nodiaBusy || waitingForVoiceReply.current) return;
      const current = new SpeechRecognitionAPI();
      recognition.current = current;
      current.lang = "pt-BR";
      current.continuous = false;
      current.interimResults = false;
      current.onresult = (event) => {
        const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
        if (!transcript || !voiceActive.current) return;
        waitingForVoiceReply.current = true;
        setVoiceStatus("Nodia está preparando a resposta…");
        void sendNodia(transcript).catch((e) => {
          waitingForVoiceReply.current = false;
          setVoiceStatus(e instanceof Error ? e.message : "Não foi possível enviar sua pergunta.");
          window.setTimeout(() => startRecognitionRef.current(), 1200);
        });
      };
      current.onerror = (event) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        voiceActive.current = false;
        setVoiceCall(false);
        setVoiceStatus(event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Acesso ao microfone negado. Libere a permissão do navegador para conversar por voz."
          : "O microfone ou o reconhecimento de voz ficou indisponível.");
      };
      current.onend = () => {
        if (recognition.current === current) recognition.current = null;
        if (voiceActive.current && !waitingForVoiceReply.current) window.setTimeout(() => startRecognitionRef.current(), 350);
      };
      try { current.start(); }
      catch {
        voiceActive.current = false;
        setVoiceCall(false);
        setVoiceStatus("Não foi possível iniciar o microfone. Tente novamente.");
      }
    };
    startRecognitionRef.current = listen;
    listen();
  };
  const stopVoiceConversation = () => {
    voiceActive.current = false;
    waitingForVoiceReply.current = false;
    recognition.current?.abort();
    recognition.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setVoiceCall(false);
    setVoiceStatus("");
  };
  useEffect(() => {
    if (!active && voiceActive.current) {
      stopVoiceConversation();
      setVoiceDialog(false);
    }
  }, [active]);
  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!voiceCall || !latest || latest.role !== "assistant" || latest.id === lastVoiceReply.current) return;
    lastVoiceReply.current = latest.id;
    setVoiceStatus("Nodia está falando…");
    speakMessage(latest.content, () => {
      if (!voiceActive.current) return;
      waitingForVoiceReply.current = false;
      setVoiceStatus("Sua vez. Estou ouvindo.");
      window.setTimeout(() => startRecognitionRef.current(), 350);
    });
  }, [messages, voiceCall]);
  useEffect(() => () => {
    voiceActive.current = false;
    recognition.current?.abort();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
  const drain = async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queueRef.current.length) {
        const entry=queueRef.current[0];
        if (entry.failed) break;
        setError(""); stick.current=true;
        try {
          await sendNodia(entry.text);
          setQueueNow(queueRef.current.filter(item=>item.id!==entry.id));
        } catch (e) {
          const partial=!!(e && typeof e === "object" && "partial" in e && e.partial);
          if (partial) {
            const remaining=queueRef.current.filter(item=>item.id!==entry.id);
            setQueueNow(remaining.map((item,i)=>i===0?{...item,failed:true}:item));
            setError(remaining.length ? "A resposta foi interrompida. As próximas mensagens continuam na fila." : "A resposta foi interrompida. Você pode perguntar novamente.");
          } else {
            setQueueNow(queueRef.current.map(item=>item.id===entry.id?{...item,failed:true}:item));
            setError("Nodia está indisponível no momento. Sua mensagem continua na fila para tentar novamente.");
          }
          break;
        }
      }
    } finally { running.current=false; }
  };
  const send = () => {
    const content=text.trim();
    if(!content || !local?.nodiaConsent || queueRef.current.length>=5)return;
    setText(""); if (!queueRef.current[0]?.failed) setError(""); stick.current=true;
    setQueueNow([...queueRef.current,{id:crypto.randomUUID(),text:content}]);
    void drain();
  };
  const discardFailed = () => { setQueueNow(queueRef.current.slice(1)); setError(""); void drain(); };
  const retry = () => { setQueueNow(queueRef.current.map((item,i)=>i===0?{...item,failed:false}:item)); void drain(); };
  return <div className="nodiapane">
    <header className="nodia-head">
      <button className="icon-btn nodia-back" onClick={onBack} aria-label="Voltar"><IconBack /></button>
      <img className="nodia-head-avatar" src={portrait} alt="" />
      <div className="nodia-head-text"><strong>Nodia <svg className="nodia-verified" viewBox="0 0 24 24" role="img" aria-label="Assistente oficial verificada"><title>Assistente oficial verificada</title><path fill="currentColor" d="m12 1 2.5 1.7 3-.1 1.2 2.7 2.6 1.5-.5 3 1.2 2.2-1.2 2.7.5 2.5-2.6 1.5-1.2 2.7-3-.1L12 23l-2.5-1.7-3 .1-1.2-2.7-2.6-1.5.5-2.5L2 12l1.2-2.2-.5-3 2.6-1.5 1.2-2.7 3 .1z"/><path fill="none" stroke="var(--verified-mark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="m7.5 12 3 3 6-6"/></svg> <span>IA</span></strong><small>Assistente do SeuChatSeguro</small></div>
      <button className={`icon-btn nodia-call-button ${voiceCall ? "on" : ""}`} aria-label="Conversar por voz com a Nodia" title="Conversa por voz" disabled={!local?.nodiaConsent || nodiaBusy || queue.length > 0} onClick={() => setVoiceDialog(true)}><IconPhone /></button>
      <button className="icon-btn" aria-label="Limpar conversa com Nodia" title="Limpar conversa" disabled={nodiaBusy || queue.length > 0 || !messages.length} onClick={() => { if (confirm("Apagar a conversa com a Nodia deste aparelho?")) clearNodia(); }}><IconTrash /></button>
    </header>
    <div className="nodia-scroll" ref={scroll} onScroll={e=>{const n=e.currentTarget;stick.current=n.scrollHeight-n.scrollTop-n.clientHeight<100}}>
      <div className="nodia-inner">
        <div className="nodia-hero"><div className="nodia-orbit"><img src={portrait} alt="Nodia" /></div><div className="nodia-label"><IconSparkle /> ASSISTENTE IA</div><h1>Olá, eu sou a Nodia.</h1><p>Estou aqui para ajudar você a aproveitar seu espaço com mais tranquilidade.</p></div>
        <div className="nodia-privacy"><IconShieldCheck /><div><strong>Converse com segurança</strong><p>As mensagens desta conversa são processadas por um serviço de IA externo e não usam criptografia ponta a ponta. Não envie sua senha, chaves ou frase de recuperação.</p>{!local?.nodiaConsent && <button className="btn primary" onClick={consentNodia}>Entendi e quero conversar</button>}</div></div>
        {local?.nodiaConsent && messages.length === 0 && !queue.length && <section className="nodia-help" aria-labelledby="nodia-help-title">
          <div className="nodia-help-heading"><div><span className="nodia-section-title">CENTRAL DE AJUDA</span><h2 id="nodia-help-title">O que você precisa resolver?</h2></div><p>Escolha um assunto para começar uma conversa com a Nodia.</p></div>
          <div className="nodia-help-list">{helpTopics.map(({ title, detail, prompt, Icon }) => <button key={title} type="button" onClick={() => setText(prompt)}>
            <span className="nodia-help-icon"><Icon /></span><span className="nodia-help-copy"><b>{title}</b><small>{detail}</small></span><IconChevronRight className="nodia-help-arrow" />
          </button>)}</div>
        </section>}
        <div className="nodia-messages">{messages.map((m) => <div key={m.id} className={`nodia-line ${m.role === "user" ? "mine" : "hers"}`}>{m.role === "assistant" && <img src={portrait} alt="" />}<div className="nodia-bubble">{m.role === "assistant" ? <><NodiaMarkdown content={m.content}/><button type="button" className="nodia-speak" aria-label="Ouvir mensagem da Nodia" title="Ouvir em voz alta" onClick={() => speakMessage(m.content)}><IconVolume /> Ouvir</button></> : m.content}</div></div>)}{queue.slice(0,1).map(item=><div key={item.id} className="nodia-line mine"><div className="nodia-bubble">{item.text}{item.failed&&<small className="nodia-queue-status">Não enviada</small>}</div></div>)}{nodiaBusy && <div className="nodia-line hers"><img src={portrait} alt="" />{nodiaDraft ? <div className="nodia-bubble"><NodiaMarkdown content={nodiaDraft} streaming/></div> : <div className="nodia-bubble nodia-thinking"><NodiaLoader/><b>Nodia está preparando uma resposta</b></div>}</div>}{queue.slice(1).map(item=><div key={item.id} className="nodia-line mine"><div className="nodia-bubble">{item.text}<small className="nodia-queue-status">Na fila</small></div></div>)}<span className="sr-only" role="status">{nodiaBusy ? (nodiaDraft ? "Nodia está escrevendo" : "Nodia está preparando uma resposta") : ""}</span></div>
      </div>
    </div>
    {local?.nodiaConsent && <form className="nodia-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}><div className="nodia-compose-inner">{error && <div className="nodia-error" role="alert"><span className="nodia-signal" aria-hidden="true"><span>!</span></span>{error} {queue[0]?.failed && <><button type="button" className="btn sm" onClick={retry}>Tentar novamente</button><button type="button" className="btn sm" onClick={discardFailed}>Remover da fila</button></>}</div>}<div className="nodia-input-wrap"><textarea aria-label="Mensagem para Nodia" placeholder="Pergunte à Nodia..." maxLength={3000} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} /><button type="submit" className="nodia-send" disabled={!text.trim() || queue.length>=5} aria-label="Enviar para Nodia"><IconSend /></button></div>{queue.length>1&&<small>{queue.length-1} mensagem(ns) aguardando resposta anterior</small>}</div></form>}
    {voiceDialog && <Dialog title="Conversa por voz" onClose={() => { stopVoiceConversation(); setVoiceDialog(false); }}>
      <div className="nodia-voice-dialog">
        <div className={`nodia-voice-avatar ${voiceCall ? "active" : ""}`}><img src={portrait} alt="" /><span>{voiceCall ? <IconMic /> : <IconPhone />}</span></div>
        <p className="nodia-voice-status" role="status">{voiceStatus || "Converse com a Nodia usando o microfone e o áudio do seu aparelho."}</p>
        <p className="muted small">A voz é sintetizada pelo navegador e depende das vozes instaladas no dispositivo. O reconhecimento de fala pode ser processado pelo provedor do navegador; sua pergunta também será enviada ao serviço de IA conforme o aviso de privacidade.</p>
        <div className="row-btns">
          {!voiceCall ? <button className="btn primary" disabled={nodiaBusy || queue.length > 0} onClick={startVoiceConversation}><IconMic /> Iniciar conversa</button> : <button className="btn danger" onClick={stopVoiceConversation}><IconPhone /> Encerrar conversa</button>}
          <button className="btn" onClick={() => { stopVoiceConversation(); setVoiceDialog(false); }}>Fechar</button>
        </div>
      </div>
    </Dialog>}
  </div>;
}
