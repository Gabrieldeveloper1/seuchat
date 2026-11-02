import { useState } from "react";
import { useApp } from "../lib/store";
import { IconCopy, IconKey } from "../icons";

export default function Mnemonic() {
  const { onboardingMnemonic, clearOnboarding, markBackupDone, local } = useApp();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const words = (onboardingMnemonic ?? "").split(" ");
  const name = local?.profile.name;
  return (
    <div className="center">
      <div className="card" style={{ maxWidth: 480 }}>
        <span className="avatar xl" style={{ background: "var(--grad)" }}><IconKey style={{ width: 32, height: 32 }} /></span>
        <div className="center-text">
          <h2>{name ? `Tudo pronto, ${name.split(" ")[0]}!` : "Tudo pronto!"}</h2>
          <p className="muted small" style={{ margin: "6px 0 0" }}>
            Guarde estas 12 palavras. É a única forma de recuperar sua conta se você trocar de celular ou perder o acesso. Anote em papel.
          </p>
        </div>
        <div className="words">{words.map((w, i) => <span key={i}><b>{i + 1}</b>{w}</span>)}</div>
        <button className="btn" onClick={() => { void navigator.clipboard?.writeText(words.join(" ")); setCopied(true); }}>
          <IconCopy /> {copied ? "Copiado" : "Copiar frase"}
        </button>
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>Anotei a frase em um lugar seguro.</span>
        </label>
        <button className="btn primary block" disabled={!saved} onClick={() => { markBackupDone(); clearOnboarding(); }}>Começar a conversar</button>
        <button className="btn ghost block" onClick={clearOnboarding}>Fazer isso depois</button>
      </div>
    </div>
  );
}
