import { useState } from "react";
import { SUPABASE_ANON, SUPABASE_URL } from "../lib/api";
import PasswordInput from "../components/PasswordInput";
import { IconShield } from "../icons";

/** Página aberta pelos botões do Discord: #/mod?r=...&a=approve|reject&e=...&s=... */
export default function Moderation() {
  const q = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const approve = q.get("a") === "approve";
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);

  async function go() {
    setBusy(true);
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/report-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        body: JSON.stringify({ r: q.get("r"), a: q.get("a"), e: q.get("e"), s: q.get("s"), key }),
      });
      const t = await r.text();
      setRes(r.ok ? { ok: true, text: `Denúncia ${approve ? "aprovada" : "rejeitada"}. Você pode fechar esta aba.` } : { ok: false, text: t });
    } catch { setRes({ ok: false, text: "Sem conexão com o servidor" }); } finally { setBusy(false); }
  }

  return (
    <div className="center">
      <div className="card">
        <div className="brand"><IconShield /> Moderação</div>
        <h2>{approve ? "Aprovar denúncia" : "Rejeitar denúncia"}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          {approve ? "O ID denunciado será banido e sua fila de mensagens apagada." : "A denúncia será arquivada e qualquer banimento preventivo dela será desfeito."}
        </p>
        <p className="mono muted" style={{ margin: 0 }}>{q.get("r")}</p>
        {!res?.ok && <PasswordInput value={key} onChange={setKey} autoComplete="off" placeholder="Chave de administrador" autoFocus />}
        {res && <div className={res.ok ? "ok" : "error"} role="status">{res.text}</div>}
        {!res?.ok && <button className={`btn ${approve ? "primary" : "danger"} block`} disabled={busy || !key} onClick={() => void go()}>{busy ? "Enviando…" : approve ? "Confirmar aprovação" : "Confirmar rejeição"}</button>}
      </div>
    </div>
  );
}
