import { grayOf, imageSendingAllowed, isBlocked, pdqFromGray } from "./imageFilter";

/** Foto de perfil (256×256) ou banner (640×200), recortada ao centro e passada pelo mesmo filtro de hashes. */
export async function profileImage(file: File, kind: "avatar" | "banner"): Promise<string> {
  if (!imageSendingAllowed()) throw new Error("Envio de imagens desativado: lista de segurança indisponível.");
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size > 15 * 1024 * 1024) throw new Error("Arquivo de imagem inválido.");
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error("Arquivo de imagem inválido.");
  try {
    if (isBlocked(pdqFromGray(grayOf(bmp)))) throw new Error("Este arquivo viola as regras da plataforma e não pode ser usado.");
    const [w, h] = kind === "avatar" ? [256, 256] : [640, 200];
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const r = Math.max(w / bmp.width, h / bmp.height);
    const dw = bmp.width * r, dh = bmp.height * r;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
    // Limites compatíveis com a validação dos destinatários e o relay.
    const limit = kind === "avatar" ? 58_000 : 115_000;
    for (let quality = 0.8; quality >= 0.2; quality -= 0.1) {
      const result = c.toDataURL("image/jpeg", quality);
      if (result.length <= limit) return result;
    }
    throw new Error("A imagem é muito detalhada. Escolha outra imagem.");
  } finally {
    bmp.close();
  }
}

export const MAX_AUDIO_SEC = 600; // 10 min (acima de 60 s vai como anexo cifrado)

export interface RecResult { dataUrl: string; blob: Blob; mime: string; dur: number; wave: number[] }
export interface Recorder {
  stop(): Promise<RecResult>;
  cancel(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** nível atual do microfone (0–1), para a animação ao vivo */
  level(): number;
}

/** Grava voz em Opus (~24 kbps) com medição de nível para a forma de onda. */
export async function startRecording(onAutoStop: () => void): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Gravação de áudio não suportada neste navegador");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).catch(() => {
    throw new Error("Permita o uso do microfone para gravar");
  });
  const mimeFull = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mimeFull, audioBitsPerSecond: 24000 });
  const chunks: Blob[] = [];
  let ctx: AudioContext | null = null;
  let an: AnalyserNode | null = null;
  try {
    ctx = new AudioContext();
    an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
  } catch { /* sem medidor */ }
  const buf = new Uint8Array(512);
  const samples: number[] = [];
  let lastLevel = 0;
  const readLevel = () => {
    if (!an) return 0;
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
  };
  let paused = false;
  let active = 0; // ms gravados (sem pausas)
  let since = Date.now();
  const meter = setInterval(() => { if (!paused) { lastLevel = readLevel(); samples.push(lastLevel); } }, 100);
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(500);
  const timer = setInterval(() => { if (!paused && active + Date.now() - since >= MAX_AUDIO_SEC * 1000) onAutoStop(); }, 500);
  const end = () => { clearInterval(timer); clearInterval(meter); stream.getTracks().forEach((t) => t.stop()); void ctx?.close().catch(() => {}); };
  const wave = () => {
    const n = 48;
    if (!samples.length) return Array(n).fill(2);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i * samples.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * samples.length) / n));
      let m = 0;
      for (let k = a; k < b && k < samples.length; k++) m = Math.max(m, samples[k]);
      out.push(Math.max(2, Math.round(m * 31)));
    }
    return out;
  };
  return {
    get paused() { return paused; },
    level: () => (paused ? 0 : lastLevel),
    pause() { if (paused || rec.state !== "recording") return; rec.pause(); paused = true; active += Date.now() - since; },
    resume() { if (!paused) return; rec.resume(); paused = false; since = Date.now(); },
    cancel() { try { rec.stop(); } catch { /* */ } end(); },
    stop: () =>
      new Promise((res, rej) => {
        if (!paused) active += Date.now() - since;
        rec.onstop = () => {
          end();
          const mime = (rec.mimeType || "audio/webm").split(";")[0];
          const blob = new Blob(chunks, { type: mime });
          const fr = new FileReader();
          fr.onload = () => {
            const dataUrl = String(fr.result).replace(/^data:[^;]*/, `data:${mime}`);
            res({ dataUrl, blob, mime, dur: Math.min(MAX_AUDIO_SEC, Math.round(active / 1000)), wave: wave() });
          };
          fr.onerror = () => rej(new Error("Falha ao gravar"));
          fr.readAsDataURL(blob);
        };
        try { if (rec.state === "paused") rec.resume(); rec.stop(); } catch (e) { rej(e); }
      }),
  };
}
