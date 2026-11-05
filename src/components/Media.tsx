import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/store";
import { fmtSize, isAudioRef, isRiskyName, isVideoRef } from "../lib/files";
import type { FileRef } from "../types";
import { IconAlert, IconDownload, IconFile, IconFilm, IconLoader, IconPause, IconPlay } from "../icons";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const SPEEDS = [1, 1.5, 2];

/** Player de voz com forma de onda, arrastar para avançar e velocidade 1×/1,5×/2×. */
export function VoicePlayer({ src, fileRef, dur = 0, wave, out }: { src?: string; fileRef?: FileRef; dur?: number; wave?: number[]; out?: boolean }) {
  const { downloadFile } = useApp();
  const a = useRef<HTMLAudioElement | null>(null);
  const [url, setUrl] = useState(src);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [len, setLen] = useState(dur);
  const [speed, setSpeed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bars = wave?.length ? wave : Array.from({ length: 40 }, (_, i) => 6 + ((i * 37) % 17));

  useEffect(() => () => { a.current?.pause(); }, []);
  async function ensure(): Promise<HTMLAudioElement | null> {
    if (a.current) return a.current;
    let u = url;
    if (!u && fileRef) {
      setBusy(true); setErr(null);
      try { u = await downloadFile(fileRef); setUrl(u); } catch (e) { setErr(e instanceof Error ? e.message : "Falha"); return null; } finally { setBusy(false); }
    }
    if (!u) return null;
    const el = new Audio(u);
    el.preload = "auto";
    el.ontimeupdate = () => setT(el.currentTime);
    el.onloadedmetadata = () => { if (isFinite(el.duration)) setLen(el.duration); };
    el.onended = () => { setPlaying(false); setT(0); };
    el.onpause = () => setPlaying(false);
    el.onplay = () => setPlaying(true);
    a.current = el;
    return el;
  }
  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const el = await ensure();
    if (!el) return;
    if (el.paused) { el.playbackRate = SPEEDS[speed]; void el.play(); } else el.pause();
  }
  async function seekTo(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const el = await ensure();
    if (!el) return;
    const d = isFinite(el.duration) ? el.duration : len;
    el.currentTime = p * d; setT(p * d);
  }
  const p = len ? t / len : 0;
  return (
    <div className={`voice ${out ? "out" : ""}`} onClick={(e) => e.stopPropagation()}>
      <button className="voice-play" aria-label={playing ? "Pausar" : "Reproduzir"} onClick={toggle} disabled={busy}>
        {busy ? <IconLoader className="spin" /> : playing ? <IconPause /> : <IconPlay />}
      </button>
      <div className="voice-main">
        <div className="voice-wave" onPointerDown={seekTo} role="slider" aria-label="Posição do áudio" aria-valuemin={0} aria-valuemax={Math.round(len)} aria-valuenow={Math.round(t)}>
          {bars.map((h, i) => <i key={i} className={i / bars.length < p ? "on" : ""} style={{ height: `${Math.max(12, (h / 31) * 100)}%` }} />)}
        </div>
        <div className="voice-meta">
          <span>{err ?? fmt(playing || t ? t : len)}</span>
          <button className="voice-speed" onClick={(e) => { e.stopPropagation(); const n = (speed + 1) % SPEEDS.length; setSpeed(n); if (a.current) a.current.playbackRate = SPEEDS[n]; }}>{SPEEDS[speed]}×</button>
        </div>
      </div>
    </div>
  );
}

export function FileMessage({ f, out }: { f: FileRef; out?: boolean }) {
  const { downloadFile } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [prog, setProg] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (f.voice || isAudioRef(f)) return <VoicePlayer fileRef={f} dur={f.dur} out={out} />;
  async function get() {
    setErr(null); setProg(0);
    try { const u = await downloadFile(f, setProg); setUrl(u); return u; }
    catch (e) { setErr(e instanceof Error ? e.message : "Falha ao baixar"); return null; }
    finally { setProg(null); }
  }
  if (isVideoRef(f)) {
    const ratio = f.w && f.h ? Math.max(0.56, Math.min(1.78, f.w / f.h)) : 16 / 9;
    return (
      <div className="vid-msg" style={{ aspectRatio: String(ratio) }} onClick={(e) => e.stopPropagation()}>
        {url ? <video src={url} controls autoPlay playsInline /> : (
          <button className="vid-cover" onClick={() => void get()} aria-label="Reproduzir vídeo" style={f.thumb ? { backgroundImage: `url(${f.thumb})` } : undefined}>
            <span className="vid-play">{prog !== null ? <Ring p={prog} /> : <IconPlay />}</span>
            <span className="vid-info"><IconFilm /> {f.dur ? fmt(f.dur) : "Vídeo"} · {fmtSize(f.size)}{f.expiresAt ? " · disponível por 10 dias" : ""}</span>
          </button>
        )}
        {err && <div className="att-err"><IconAlert /> {err}</div>}
      </div>
    );
  }
  const risky = isRiskyName(f.name);
  const ext = (f.name.split(".").pop() ?? "").slice(0, 4).toUpperCase();
  return (
    <div className="file-msg" onClick={(e) => e.stopPropagation()}>
      <span className="file-ico"><IconFile /><b>{ext}</b></span>
      <span className="file-txt"><b title={f.name}>{f.name}</b><span>{fmtSize(f.size)}{risky ? " · confira antes de abrir" : ""}</span></span>
      <button className="file-dl" aria-label="Baixar arquivo" disabled={prog !== null} onClick={async () => {
        if (risky && !confirm(`"${f.name}" pode executar programas no seu aparelho. Abra só se confiar em quem enviou. Baixar mesmo assim?`)) return;
        const u = url ?? (await get());
        if (!u) return;
        const el = document.createElement("a");
        el.href = u; el.download = f.name; el.rel = "noopener";
        document.body.appendChild(el); el.click(); el.remove();
      }}>{prog !== null ? <Ring p={prog} /> : <IconDownload />}</button>
      {err && <div className="att-err"><IconAlert /> {err}</div>}
    </div>
  );
}

export function Ring({ p }: { p: number }) {
  const r = 9, c = 2 * Math.PI * r;
  return (
    <svg className="ring-prog" width="24" height="24" viewBox="0 0 24 24" aria-label={`${Math.round(p * 100)}%`}>
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.5" />
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.04, p))} transform="rotate(-90 12 12)" />
    </svg>
  );
}

/** Ondas ao vivo enquanto grava. */
export function LiveWave({ level }: { level: () => number }) {
  const [bars, setBars] = useState<number[]>(() => Array(28).fill(0.08));
  useEffect(() => {
    const id = setInterval(() => setBars((b) => [...b.slice(1), Math.max(0.08, level())]), 90);
    return () => clearInterval(id);
  }, [level]);
  return <div className="live-wave" aria-hidden>{bars.map((v, i) => <i key={i} style={{ transform: `scaleY(${v})` }} />)}</div>;
}
