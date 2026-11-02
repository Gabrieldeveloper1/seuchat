import { useEffect, useRef, type ReactNode } from "react";
import { IconX } from "../icons";

/** Janela no computador; folha (bottom sheet) no celular. Esc fecha, o fundo não rola. */
export default function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    const body = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = body;
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "wide" : ""}`} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} style={{ outline: "none" }}>
        <div className="grab" aria-hidden />
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><IconX /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
