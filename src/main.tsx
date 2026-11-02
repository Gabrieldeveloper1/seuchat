import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppProvider } from "./lib/store";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);

// remove a abertura estática (index.html) com uma transição suave
requestAnimationFrame(() => {
  const s = document.getElementById("boot-splash");
  if (!s) return;
  s.classList.add("out");
  setTimeout(() => s.remove(), 450);
});
