// Efeitos sonoros sintetizados (Web Audio): sem arquivos extras, carregam instantaneamente.
const KEY = "scs.sound";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export const soundEnabled = () => localStorage.getItem(KEY) !== "off";
export function setSoundEnabled(on: boolean) { localStorage.setItem(KEY, on ? "on" : "off"); }

function ac(): AudioContext | null {
  if (!soundEnabled()) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

type Note = { f: number; t: number; d: number; v?: number; type?: OscillatorType; to?: number };
function play(notes: Note[]) {
  const c = ac();
  if (!c || !master) return;
  const now = c.currentTime + 0.01;
  for (const n of notes) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = n.type ?? "sine";
    o.frequency.setValueAtTime(n.f, now + n.t);
    if (n.to) o.frequency.exponentialRampToValueAtTime(n.to, now + n.t + n.d);
    const v = n.v ?? 0.18;
    g.gain.setValueAtTime(0.0001, now + n.t);
    g.gain.exponentialRampToValueAtTime(v, now + n.t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
    o.connect(g).connect(master);
    o.start(now + n.t);
    o.stop(now + n.t + n.d + 0.05);
  }
}

export const sfx = {
  send: () => play([{ f: 520, to: 880, t: 0, d: 0.12, v: 0.12 }]),
  receive: () => play([{ f: 880, t: 0, d: 0.18, v: 0.14 }, { f: 1318.5, t: 0.09, d: 0.32, v: 0.12 }]),
  tap: () => play([{ f: 1200, t: 0, d: 0.04, v: 0.05, type: "triangle" }]),
  recStart: () => play([{ f: 660, t: 0, d: 0.09, v: 0.14 }, { f: 990, t: 0.08, d: 0.12, v: 0.14 }]),
  recStop: () => play([{ f: 990, t: 0, d: 0.09, v: 0.12 }, { f: 660, t: 0.08, d: 0.14, v: 0.12 }]),
  error: () => play([{ f: 300, t: 0, d: 0.16, v: 0.12, type: "triangle" }, { f: 220, t: 0.12, d: 0.22, v: 0.12, type: "triangle" }]),
  connected: () => play([{ f: 523.25, t: 0, d: 0.18 }, { f: 659.25, t: 0.1, d: 0.18 }, { f: 783.99, t: 0.2, d: 0.35 }]),
  hangup: () => play([{ f: 659.25, t: 0, d: 0.16, v: 0.14 }, { f: 493.88, t: 0.13, d: 0.16, v: 0.14 }, { f: 392, t: 0.26, d: 0.3, v: 0.14 }]),
  notify: () => play([{ f: 1046.5, t: 0, d: 0.12, v: 0.1 }, { f: 1567.98, t: 0.08, d: 0.25, v: 0.09 }]),
};

/** Toque contínuo: "incoming" (toque elegante) ou "outgoing" (sinal de chamando). Retorna a função para parar. */
export function loop(kind: "incoming" | "outgoing"): () => void {
  const ring = () => kind === "incoming"
    ? play([{ f: 659.25, t: 0, d: 0.22 }, { f: 830.61, t: 0.18, d: 0.22 }, { f: 987.77, t: 0.36, d: 0.3 }, { f: 830.61, t: 0.62, d: 0.22 }, { f: 987.77, t: 0.8, d: 0.45 }])
    : play([{ f: 440, t: 0, d: 1.0, v: 0.07 }, { f: 480, t: 0, d: 1.0, v: 0.07 }]);
  ring();
  const id = window.setInterval(ring, kind === "incoming" ? 2400 : 3800);
  return () => window.clearInterval(id);
}
