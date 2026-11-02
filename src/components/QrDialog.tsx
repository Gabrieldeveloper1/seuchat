import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import Dialog from "./Dialog";
import { useApp } from "../lib/store";
import { ID_RE } from "../lib/util";

export const addLink = (id: string, name: string) => `${location.origin}/#/add?id=${id}&n=${encodeURIComponent(name)}`;

export function parseAdd(text: string): { id: string; name: string } | null {
  const q = new URLSearchParams(text.split("?")[1] ?? "");
  const id = (q.get("id") ?? "").toLowerCase();
  return ID_RE.test(id) ? { id, name: (q.get("n") ?? "").slice(0, 40) } : null;
}

function Scanner({ onFound }: { onFound: (t: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch {
        return setErr("Permita o uso da câmera para escanear.");
      }
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      const tick = () => {
        if (stop) return;
        if (v.videoWidth) {
          c.width = v.videoWidth; c.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const r = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
          if (r?.data) return onFound(r.data);
        }
        requestAnimationFrame(tick);
      };
      tick();
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [onFound]);
  return err ? <div className="error">{err}</div> : <video ref={video} className="scan" muted playsInline />;
}

export default function QrDialog({ onClose, toast }: { onClose: () => void; toast: (t: string) => void }) {
  const { userId, local, addContact } = useApp();
  const [tab, setTab] = useState<"mine" | "scan">("mine");
  const [img, setImg] = useState("");
  const link = userId ? addLink(userId, local?.profile.name ?? "") : "";
  useEffect(() => {
    if (link) void QRCode.toDataURL(link, { margin: 1, width: 260, errorCorrectionLevel: "M" }).then(setImg);
  }, [link]);

  async function found(t: string) {
    const r = parseAdd(t);
    if (!r) return toast("Este QR code não é do SeuChatSeguro");
    try { await addContact(r.id, r.name); toast("Contato adicionado"); onClose(); } catch (e) { toast(e instanceof Error ? e.message : "Erro"); onClose(); }
  }

  return (
    <Dialog title="QR code" onClose={onClose}>
      <div className="tabs">
        <button type="button" className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>Meu código</button>
        <button type="button" className={tab === "scan" ? "on" : ""} onClick={() => setTab("scan")}>Escanear</button>
      </div>
      {tab === "mine" ? (
        <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
          {img && <img src={img} alt="Seu QR code" width={260} height={260} style={{ borderRadius: 16, background: "#fff" }} />}
          <p className="muted small center-text" style={{ margin: 0 }}>Peça para a pessoa escanear em Novo contato → QR code, ou abrir o link abaixo.</p>
          <button className="btn" onClick={() => { void navigator.clipboard?.writeText(link); toast("Link copiado"); }}>Copiar link de convite</button>
        </div>
      ) : (
        <Scanner onFound={(t) => void found(t)} />
      )}
    </Dialog>
  );
}
