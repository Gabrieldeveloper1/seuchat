import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/store";
import { screenShareSupported } from "../lib/callEngine";
import Avatar, { colorFor } from "./Avatar";
import {
  IconCamera, IconCast, IconChevronDown, IconFlip, IconHangup, IconMic, IconMicOff, IconPhone, IconPhoneUp, IconScreen,
  IconShare, IconUsers, IconVideo, IconVideoOff, IconVolume, IconVolumeOff, IconX,
} from "../icons";

function Vid({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const r = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = r.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => {});
  }, [stream]);
  return <video ref={r} className={className} autoPlay playsInline muted={muted} />;
}

function useRing(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let ctx: AudioContext | null = null;
    try { ctx = new AudioContext(); } catch { return; }
    const beep = () => {
      if (!ctx || ctx.state === "closed") return;
      void ctx.resume().catch(() => {});
      for (const [t, f] of [[0, 440], [0.25, 523]] as const) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; g.gain.value = 0.06;
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
      }
    };
    beep();
    const i = setInterval(beep, 2200);
    return () => { clearInterval(i); void ctx?.close(); };
  }, [on]);
}

/** Mantém a tela do celular acesa durante a chamada. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const get = () => navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
    void get();
    const vis = () => document.visibilityState === "visible" && void get();
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); void lock?.release().catch(() => {}); };
  }, [on]);
}

export default function CallOverlay() {
  const { call, local, userId, acceptCall, rejectCall, hangup, toggleMic, toggleCam, shareScreen, switchCamera } = useApp();
  const [sec, setSec] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [mini, setMini] = useState(false);
  const [sheet, setSheet] = useState<null | "share" | "people" | "confirm">(null);
  const [deaf, setDeaf] = useState(false);
  const [hint, setHint] = useState(false);
  useRing(call.phase === "incoming");
  useWakeLock(call.phase !== "idle");

  useEffect(() => {
    if (!call.startedAt) return setSec(0);
    const i = setInterval(() => setSec(Math.floor((Date.now() - call.startedAt!) / 1000)), 1000);
    return () => clearInterval(i);
  }, [call.startedAt]);
  useEffect(() => {
    if (call.phase === "idle") { setMini(false); setSheet(null); setDeaf(false); setErr(null); }
    if (call.phase === "connected") { setHint(true); const t = setTimeout(() => setHint(false), 5000); return () => clearTimeout(t); }
  }, [call.phase]);
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(null), 5000); return () => clearTimeout(t); }, [err]);

  if (call.phase === "idle") return null;

  const c = local?.contacts.find((x) => x.id === call.peer);
  const name = c?.alias ?? "Contato";
  const live = call.phase === "connected";
  const hasRemoteVideo = !!call.remote?.getVideoTracks().some((t) => t.readyState === "live" && !t.muted);
  const camOn = !!call.local?.getVideoTracks().some((t) => t.enabled && t.readyState === "live") && call.cam;
  const mm = String(Math.floor(sec / 60)).padStart(2, "0"), ss = String(sec % 60).padStart(2, "0");
  const status = call.phase === "incoming" ? `Chamada de ${call.video ? "vídeo" : "voz"}` : call.phase === "calling" ? "Chamando…" : `${mm}:${ss}`;
  const myAvatar = local?.profile.avatar;
  const myName = local?.profile.name || "Você";
  const run = (f: () => Promise<void> | void) => async () => { setErr(null); try { await f(); } catch (e) { setErr(e instanceof Error ? e.message : "Erro"); } };

  // O áudio do contato fica num elemento próprio e invisível: continua tocando mesmo minimizado.
  const audio = <Vid stream={call.remote} muted={deaf} className="hidden-media" />;

  if (mini && live) {
    return (
      <>
        {audio}
        <button className="call-mini" onClick={() => setMini(false)} aria-label="Voltar para a chamada">
          <i className="live-dot" /> {name} · {mm}:{ss}
          <span className="hang" role="button" aria-label="Encerrar" onClick={(e) => { e.stopPropagation(); void hangup(); }}><IconHangup /></span>
        </button>
      </>
    );
  }

  const bgUrl = c?.avatar;
  const bg = (seed: string, src?: string) => (
    <div className="tile-bg" style={src ? { backgroundImage: `url(${src})` } : { background: `linear-gradient(135deg, ${colorFor(seed)}, ${colorFor(seed + "x")})` }} />
  );

  const remoteTile = (
    <div className="tile">
      {bg(call.peer ?? "", bgUrl)}
      {call.remoteScreen ? (
        <>
          <Vid stream={call.remoteScreen} muted className="contain" />
          {hasRemoteVideo && <div className="pip"><Vid stream={call.remote} muted /></div>}
          <div className="tile-label"><IconScreen /> {name} está compartilhando a tela</div>
        </>
      ) : hasRemoteVideo ? (
        <>
          <Vid stream={call.remote} muted />
          <div className="tile-label">{name}</div>
        </>
      ) : (
        <div className="tile-id">
          {call.phase !== "connected" && <><i className="rings" /><i className="rings b" /></>}
          <Avatar name={name} seed={call.peer ?? ""} src={c?.avatar} />
          <h2>{name}</h2>
          <p>{status}</p>
        </div>
      )}
      {!live && call.local && camOn && <div className="pip"><Vid stream={call.local} muted className="mirror" /></div>}
    </div>
  );

  const meTile = (
    <div className="tile">
      {bg(userId ?? "me", myAvatar)}
      {camOn && !call.sharing ? (
        <>
          <Vid stream={call.local} muted className="mirror" />
          <button className="tile-flip" aria-label="Virar câmera" onClick={run(switchCamera)}><IconFlip /></button>
        </>
      ) : (
        <div className="tile-id">
          <Avatar name={myName} seed={userId ?? "me"} src={myAvatar} />
          {call.sharing && <p>Você está compartilhando a tela</p>}
        </div>
      )}
      {call.sharing && <button className="stop-share" onClick={run(shareScreen)}><IconX /> Parar</button>}
      <div className="tile-label">{myName}{!call.mic && <IconMicOff />}</div>
    </div>
  );

  return (
    <div className="call" role="dialog" aria-label={`Chamada com ${name}`}>
      {audio}
      <div className="call-top">
        {live ? <button className="icon-btn" aria-label="Minimizar chamada" onClick={() => setMini(true)}><IconChevronDown /></button> : <span style={{ width: 44 }} />}
        <div className="call-title"><b>{name}</b><span>{status}</span></div>
        <button className="icon-btn" aria-label="Participantes" onClick={() => setSheet("people")}><IconUsers /></button>
      </div>

      <div className={`call-tiles ${live ? "" : "solo"}`}>
        {remoteTile}
        {live && meTile}
      </div>

      {err && <div className="error call-err" role="alert">{err}</div>}
      {hint && live && !call.sharing && !sheet && <div className="call-hint">Compartilhe sua tela com {name.split(" ")[0]}</div>}

      {call.phase === "incoming" ? (
        <div className="incoming-bar">
          <figure><button className="dock-btn hang" style={{ margin: 0, width: 68, height: 68, borderRadius: "50%" }} aria-label="Recusar" onClick={() => void rejectCall()}><IconHangup /></button>Recusar</figure>
          <figure><button className="dock-btn good" style={{ borderRadius: "50%" }} aria-label="Atender" onClick={run(acceptCall)}><IconPhone /></button>Atender</figure>
        </div>
      ) : (
        <div className="call-dock">
          <button className={`dock-btn ${camOn ? "live" : "off"}`} aria-label={camOn ? "Desligar câmera" : "Ligar câmera"} aria-pressed={camOn} onClick={run(() => toggleCam())}>{camOn ? <IconVideo /> : <IconVideoOff />}</button>
          <button className={`dock-btn ${call.mic ? "" : "off"}`} aria-label={call.mic ? "Silenciar microfone" : "Ativar microfone"} aria-pressed={!call.mic} onClick={toggleMic}>{call.mic ? <IconMic /> : <IconMicOff />}</button>
          {live && (
            <button className={`dock-btn ${call.sharing ? "live" : ""}`} aria-label={call.sharing ? "Parar compartilhamento" : "Compartilhar"} onClick={() => (call.sharing ? void run(shareScreen)() : setSheet("share"))}><IconShare /></button>
          )}
          {live && <button className={`dock-btn ${deaf ? "off" : ""}`} aria-label={deaf ? "Ativar som" : "Silenciar som da chamada"} aria-pressed={deaf} onClick={() => setDeaf(!deaf)}>{deaf ? <IconVolumeOff /> : <IconVolume />}</button>}
          <button className="dock-btn hang" aria-label="Encerrar chamada" onClick={() => void hangup()}><IconHangup /></button>
        </div>
      )}

      {sheet === "share" && (
        <div className="call-sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="call-sheet" role="dialog" aria-label="Compartilhar">
            <div className="grab" />
            <h3>Compartilhar</h3>
            <div className="opts" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
              <button className="opt" disabled={!screenShareSupported()} onClick={() => setSheet("confirm")}>
                <span className="ob"><IconPhoneUp /></span>Compartilhamento de tela
                {!screenShareSupported() && <small>Só no computador ou no app Android</small>}
              </button>
              <button className="opt" onClick={() => { setSheet(null); void run(() => (camOn ? switchCamera() : toggleCam()))(); }}>
                <span className="ob"><IconCamera /></span>{camOn ? "Virar câmera" : "Ligar câmera"}
                <small>{camOn ? "Frontal ↔ traseira" : "Chamada com vídeo normal"}</small>
              </button>
            </div>
          </div>
        </div>
      )}

      {sheet === "confirm" && (
        <div className="call-wrap-center">
          <div className="confirm" role="alertdialog" aria-label="Iniciar transmissão">
            <div className="cico"><IconCast /></div>
            <h3>Iniciar gravação ou transmissão com o app SeuChatSeguro?</h3>
            <p>O SeuChatSeguro terá acesso a todas as informações visíveis na tela ou reproduzidas no dispositivo durante a transmissão. Isso inclui informações como senhas, detalhes de pagamento, fotos, mensagens e áudio que você tocar.</p>
            <div className="acts">
              <button className="no" onClick={() => setSheet(null)}>Cancelar</button>
              <button className="yes" onClick={() => { setSheet(null); void run(shareScreen)(); }}>Iniciar agora</button>
            </div>
          </div>
        </div>
      )}

      {sheet === "people" && (
        <div className="call-sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="call-sheet" role="dialog" aria-label="Participantes">
            <div className="grab" />
            <h3>Na chamada (2)</h3>
            <div className="people">
              <div className="member"><Avatar name={myName} seed={userId ?? "me"} size="sm" src={myAvatar} /><span>{myName} (você)</span>{!call.mic && <IconMicOff />}</div>
              <div className="member"><Avatar name={name} seed={call.peer ?? ""} size="sm" src={c?.avatar} /><span>{name}</span></div>
            </div>
            <p className="small" style={{ margin: 0, opacity: 0.65, textAlign: "center" }}>Chamadas em grupo ainda não são suportadas.</p>
          </div>
        </div>
      )}
    </div>
  );
}
