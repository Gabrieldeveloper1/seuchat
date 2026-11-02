import { useState } from "react";
import { useApp } from "../lib/store";
import { IconLock, IconShieldCheck } from "../icons";
import PasswordInput from "../components/PasswordInput";

export default function Unlock() {
  const { unlock, busy, error } = useApp();
  const [pass, setPass] = useState("");
  return (
    <div className="auth">
      <section className="hero">
        <div className="logo"><IconShieldCheck /> SeuChatSeguro</div>
        <h1>Bem-vindo de volta.</h1>
      </section>
      <section className="panel">
        <form className="card" onSubmit={(e) => { e.preventDefault(); void unlock(pass); }}>
          <span className="avatar xl" style={{ background: "var(--grad)" }}><IconLock style={{ width: 32, height: 32 }} /></span>
          <div className="center-text">
            <h2>Digite sua senha</h2>
            <p className="muted small" style={{ margin: "4px 0 0" }}>Suas conversas ficam trancadas neste aparelho.</p>
          </div>
          <PasswordInput value={pass} onChange={setPass} autoComplete="current-password" autoFocus placeholder="Senha" />
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn primary block" disabled={busy || !pass}>{busy ? "Abrindo…" : "Entrar"}</button>
        </form>
      </section>
    </div>
  );
}
