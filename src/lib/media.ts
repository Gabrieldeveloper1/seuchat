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
    return c.toDataURL("image/jpeg", 0.8);
  } finally {
    bmp.close();
  }
}

export const MAX_AUDIO_SEC = 45;

export interface Recorder { stop(): Promise<{ dataUrl: string; dur: number }>; cancel(): void }

/** Grava voz em Opus ~16 kbps (45 s ≈ 90 KB, cabe no limite do relay). */
export async function startRecording(onAutoStop: () => void): Promise<Recorder> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Gravação de áudio não suportada neste navegador");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => {
    throw new Error("Permita o uso do microfone para gravar");
  });
  const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 16000 });
  const chunks: Blob[] = [];
  const t0 = Date.now();
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(500);
  const timer = setTimeout(onAutoStop, MAX_AUDIO_SEC * 1000);
  const end = () => { clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); };
  return {
    cancel() { try { rec.stop(); } catch { /* */ } end(); },
    stop: () =>
      new Promise((res, rej) => {
        rec.onstop = () => {
          end();
          const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
          const fr = new FileReader();
          fr.onload = () => {
            const base = String(fr.result).replace(/^data:[^;]*/, `data:${(rec.mimeType || "audio/webm").split(";")[0]}`);
            res({ dataUrl: base, dur: Math.min(MAX_AUDIO_SEC, Math.round((Date.now() - t0) / 1000)) });
          };
          fr.onerror = () => rej(new Error("Falha ao gravar"));
          fr.readAsDataURL(blob);
        };
        try { rec.stop(); } catch (e) { rej(e); }
      }),
  };
}
