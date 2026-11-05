import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useApp } from "./lib/store";
import Welcome from "./pages/Welcome";
import Unlock from "./pages/Unlock";
import Mnemonic from "./pages/Mnemonic";
import Main from "./pages/Main";
import TermsPage from "./pages/TermsPage";
const Moderation = lazy(() => import("./pages/Moderation"));
import CallOverlay from "./components/CallOverlay";
import { Logo } from "./icons";
import Splash from "./components/Splash";

/** Proteção possível na web: cortina quando a aba perde o foco/fica oculta e bloqueio de impressão.
 *  A web NÃO consegue impedir capturas de tela; isso só existe no app nativo (Android FLAG_SECURE). */
function useCurtain(active: boolean) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!active) return setHidden(false);
    const on = () => setHidden(document.visibilityState === "hidden" || !document.hasFocus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        void navigator.clipboard?.writeText("").catch(() => {});
        setHidden(true);
        setTimeout(on, 1500);
      }
    };
    document.addEventListener("visibilitychange", on);
    window.addEventListener("blur", on);
    window.addEventListener("focus", on);
    window.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("visibilitychange", on);
      window.removeEventListener("blur", on);
      window.removeEventListener("focus", on);
      window.removeEventListener("keyup", onKey);
    };
  }, [active]);
  return hidden;
}

function useAutolock(minutes: number, enabled: boolean, lock: () => void) {
  const last = useRef(Date.now());
  useEffect(() => {
    if (!enabled || !minutes) return;
    const bump = () => (last.current = Date.now());
    const evs = ["pointerdown", "keydown", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, bump));
    const t = setInterval(() => {
      if (Date.now() - last.current > minutes * 60_000) lock();
    }, 5000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [minutes, enabled, lock]);
}

export default function App() {
  const app = useApp();
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const f = () => setRoute(location.hash);
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  const inApp = app.phase === "app";
  const curtain = useCurtain(inApp);
  const theme = app.local?.settings.theme ?? "auto";
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  // cor da barra do navegador/celular acompanha o tema
  useEffect(() => {
    const paint = () => {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", bg));
    };
    paint();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", paint);
    return () => mq.removeEventListener("change", paint);
  }, [theme]);
  useAutolock(app.local?.settings.autolockMin ?? 0, inApp && app.call.phase === "idle", app.lock);

  let body;
  if (route.startsWith("#/terms")) return <TermsPage />;
  if (route.startsWith("#/mod") || route.startsWith("#/appeal-mod")) return <Suspense fallback={<Splash label="Abrindo moderação" />}><Moderation /></Suspense>;
  if (app.phase === "boot") body = <Splash />;
  else if (app.phase === "welcome") body = <Welcome />;
  else if (app.phase === "locked") body = <Unlock />;
  else if (app.onboardingMnemonic) body = <Mnemonic />;
  else body = <Main />;

  return (
    <>
      {body}
      {inApp && <CallOverlay />}
      {curtain && (
        <div className="curtain" role="presentation">
          <div style={{ textAlign: "center", display: "grid", gap: 10, justifyItems: "center" }}>
            <Logo size={56} />
            <div>Conteúdo oculto por privacidade</div>
          </div>
        </div>
      )}
    </>
  );
}
