import { useState } from "react";
import { useApp } from "../lib/store";
import { IconLock, IconPhone, IconZap, Wordmark, IconLoader } from "../icons";
import PasswordInput from "../components/PasswordInput";
import { isValidMnemonic } from "../lib/crypto";

export default function Welcome() {
  const { createAccount, restoreAccount, busy, error } = useApp();
  const [tab, setTab] = useState<"new" | "restore">("new");
  const [name, setName] = useState("");
  const [pass, setPass] = useState("");
  const [words, setWords] = useState<string[]>(Array(12).fill(""));
  const [ok, setOk] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  function setWord(i: number, v: string) {
    const parts = v.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      const next = Array(12).fill("");
      parts.slice(0, 12).forEach((w, k) => (next[k] = w));
      setWords(next);
    } else setWords(words.map((w, k) => (k === i ? v.trim().toLowerCase() : w)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalErr(null);
    if (tab === "new" && !name.trim()) return setLocalErr("Como você quer ser chamado?");
    if (tab === "restore" && words.some((w) => !w)) return setLocalErr("Preencha as 12 palavras");
    if (tab === "restore" && !isValidMnemonic(words.join(" "))) return setLocalErr("Frase inválida. Confira as 12 palavras e a ordem.");
    if (pass.length < 8) return setLocalErr("Use uma senha com pelo menos 8 caracteres");
    if (!ok) return setLocalErr("Confirme que tem 18 anos ou mais e aceita os Termos");
    if (tab === "new") void createAccount(name, pass);
    else void restoreAccount(words.join(" "), pass);
  }

  return (
    <div className="auth">
      <section className="hero">
        <div className="logo"><Wordmark /></div>
        <span className="hero-kicker">Mensageiro privado · Criptografia de ponta a ponta</span>
        <h1>Seu espaço para <em>conversar</em>.<br />Com privacidade, sempre.</h1>
        <ul>
          <li><span><IconLock /></span> Criptografia de ponta a ponta em cada mensagem</li>
          <li><span><IconPhone /></span> Encontre amigos pelo seu número exclusivo do app</li>
          <li><span><IconZap /></span> Comece com seu nome e uma senha</li>
        </ul>
      </section>

      <section className="panel">
        <form className="card" onSubmit={submit}>
          <div>
            <h2>{tab === "new" ? "Criar sua conta" : "Entrar em outro aparelho"}</h2>
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              {tab === "new" ? "Crie sua conta para começar." : "Use as 12 palavras de recuperação para trazer sua conta."}
            </p>
          </div>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "new"} className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>Criar conta</button>
            <button type="button" role="tab" aria-selected={tab === "restore"} className={tab === "restore" ? "on" : ""} onClick={() => setTab("restore")}>Já tenho conta</button>
          </div>

          {tab === "new" ? (
            <>
              <label className="field">Seu nome
                <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} autoComplete="nickname" placeholder="Como os amigos vão te ver" />
              </label>
              <div className="banner" role="note">Ao criar a conta, o SeuChatSeguro gera um número exclusivo no formato 10259-5251. Não é um telefone e não precisa de SMS.</div>
            </>
          ) : (
            <div><p className="small muted">Digite as 12 palavras em inglês, na ordem, ou cole a frase completa.</p><button type="button" className="btn sm" onClick={async () => { try { setWord(0, await navigator.clipboard.readText()); } catch { setLocalErr("Não foi possível acessar a área de transferência. Cole a frase em um campo."); } }}>Colar frase</button><div className="words" onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t.trim().split(/\s+/).length > 1) { e.preventDefault(); setWord(0, t); } }}>
              {words.map((w, i) => (
                <input key={i} value={w} aria-label={`Palavra ${i + 1}`} placeholder={String(i + 1)} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setWord(i, e.target.value)} />
              ))}
            </div></div>
          )}

          <label className="field">{tab === "new" ? "Crie uma senha" : "Nova senha neste aparelho"}
            <PasswordInput value={pass} onChange={setPass} autoComplete="new-password" meter={tab === "new"} />
          </label>
          <p className="small muted" style={{ margin: 0 }}>A senha abre suas conversas neste aparelho. Não é enviada a ninguém.</p>

          <label className="check">
            <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
            <span>Tenho 18 anos ou mais e aceito os{" "}
              <a href="#/terms" target="_blank" rel="noopener noreferrer">Termos e Privacidade</a>.
            </span>
          </label>
          {(localErr || error) && <div className="error" role="alert">{localErr || error}</div>}
          <button className="btn primary block" disabled={busy}>
            {busy ? <><IconLoader className="spin" /> Aguarde…</> : tab === "new" ? "Criar conta" : "Restaurar conta"}
          </button>
        </form>
      </section>
    </div>
  );
}
