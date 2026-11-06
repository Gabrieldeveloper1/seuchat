import { useState } from "react";
import { useApp } from "../lib/store";
import { IconLock, IconFingerprint, Wordmark, IconLoader } from "../icons";
import PasswordInput from "../components/PasswordInput";

export default function Unlock() {
  const { unlock, busy, error } = useApp();
  const [pass, setPass] = useState("");
  return (
    <div className="auth">
      <section className="hero">
        <div className="logo"><Wordmark /></div>
        <span className="hero-kicker">Sessão protegida</span>
        <h1>Bem-vindo de volta.</h1>
      </section>
      <section className="panel">
        <form className="card" onSubmit={(e) => { e.preventDefault(); void unlock(pass); }}>
          <span className="lock-badge lock-badge-phone"><IconFingerprint style={{ width: 30, height: 30 }} aria-hidden="true" /></span>
          <div className="center-text">
            <h2>Digite sua senha</h2>
            <p className="muted small" style={{ margin: "4px 0 0" }}>Suas conversas ficam trancadas neste aparelho.</p>
          </div>
          <PasswordInput value={pass} onChange={setPass} autoComplete="current-password" autoFocus placeholder="Senha" />
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn primary block" disabled={busy || !pass}>{busy ? <><IconLoader className="spin" /> Abrindo…</> : <><IconLock /> Entrar</>}</button>
        </form>
      </section>
    </div>
  );
}
