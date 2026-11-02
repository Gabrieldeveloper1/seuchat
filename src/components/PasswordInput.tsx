import { useState } from "react";
import { IconEye, IconEyeOff } from "../icons";

export function strength(p: string): number {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 4);
}

export default function PasswordInput({
  value, onChange, autoComplete, autoFocus, placeholder, meter,
}: { value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean; placeholder?: string; meter?: boolean }) {
  const [show, setShow] = useState(false);
  const s = strength(value);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="pw">
        <input className="input" type={show ? "text" : "password"} value={value} placeholder={placeholder} autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} />
        <button type="button" className="icon-btn" aria-label={show ? "Ocultar senha" : "Mostrar senha"} onClick={() => setShow(!show)}>
          {show ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
      {meter && value && (
        <div className={`meter s${s}`} aria-label={`Força da senha: ${s} de 4`}>
          {[1, 2, 3, 4].map((i) => <i key={i} className={i <= s ? "on" : ""} />)}
        </div>
      )}
    </div>
  );
}
