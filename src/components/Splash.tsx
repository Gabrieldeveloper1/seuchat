import { Logo } from "../icons";

/** Tela de abertura: aparece enquanto o cofre local e a conexão são preparados. */
export default function Splash({ label = "Preparando seu cofre seguro" }: { label?: string }) {
  return (
    <div className="splash" role="status" aria-live="polite" aria-label={label}>
      <div className="splash-glow" aria-hidden />
      <div className="splash-mark">
        <span className="splash-ring" aria-hidden />
        <span className="splash-ring b" aria-hidden />
        <Logo size={96} />
      </div>
      <div className="splash-name">SeuChat<b>Seguro</b></div>
      <div className="splash-bar" aria-hidden><i /></div>
      <div className="splash-label">{label}</div>
      <div className="splash-foot">Criptografia de ponta a ponta</div>
    </div>
  );
}
