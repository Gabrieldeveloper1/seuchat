import type { ReactNode, SVGProps } from "react";

// Ícones SVG vetoriais inline (grade 24×24, traço de 1.9px, cantos arredondados).
// Herdam a cor via currentColor e escalam com o tamanho do botão (1em por padrão = 20px).
type P = SVGProps<SVGSVGElement>;
const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  focusable: false,
  "aria-hidden": true,
};
const make = (children: ReactNode) => (p: P) => <svg {...base} {...p}>{children}</svg>;

const PHONE = "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z";

// ---- mensagens ----
export const IconSend = make(<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></>);
export const IconAttach = make(<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />);
export const IconImage = make(<><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>);
export const IconCheck = make(<path d="m20 6-11 11-5-5" />);
export const IconCheckDouble = make(<><path d="M18 6 7 17l-5-5" /><path d="m22 10-7.5 7.5L13 16" /></>);
export const IconClock = make(<><circle cx="12" cy="12" r="9.5" /><path d="M12 6.5V12l3.5 2" /></>);
export const IconReply = make(<><path d="M9 14 4 9l5-5" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></>);
export const IconFlag = make(<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22v-7" /></>);
export const IconTrash = make(<><path d="M3 6h18" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M10 11v6M14 11v6" /></>);
export const IconCopy = make(<><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>);

// ---- navegação ----
export const IconBack = make(<path d="m15 18-6-6 6-6" />);
export const IconChevronDown = make(<path d="m6 9 6 6 6-6" />);
export const IconX = make(<path d="M18 6 6 18M6 6l12 12" />);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconMore = make(<><circle cx="12" cy="5" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="19" r="1.3" fill="currentColor" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="7.5" /><path d="m21 21-4.35-4.35" /></>);
export const IconChat = make(<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />);
export const IconSettings = make(<><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></>);

// ---- pessoas e segurança ----
export const IconUser = make(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>);
export const IconUsers = make(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>);
export const IconShield = make(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />);
export const IconShieldCheck = make(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></>);
export const IconLock = make(<><rect x="3" y="11" width="18" height="11" rx="2.5" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>);
export const IconKey = make(<path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />);
export const IconBlock = make(<><circle cx="12" cy="12" r="10" /><path d="m4.93 4.93 14.14 14.14" /></>);
export const IconEye = make(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconEyeOff = make(<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><path d="m1 1 22 22" /></>);
export const IconQr = make(<><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="16" y="3" width="5" height="5" rx="1" /><rect x="3" y="16" width="5" height="5" rx="1" /><path d="M21 16h-3a2 2 0 0 0-2 2v3M21 21v.01M12 7v3a2 2 0 0 1-2 2H7M3 12h.01M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1" /></>);
export const IconMoon = make(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />);
export const IconZap = make(<path d="M13 2 3 14h9l-1 8 10-12h-9z" />);
export const IconWifiOff = make(<><path d="m1 1 22 22" /><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" /></>);
export const IconCamera = make(<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>);

// ---- chamadas ----
export const IconPhone = make(<path d={PHONE} />);
export const IconPhoneOff = make(<><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91" /><path d="m23 1-22 22" /></>);
/** Desligar: o fone clássico girado (botão vermelho). */
export const IconHangup = make(<g transform="rotate(135 12 12)"><path d={PHONE} /></g>);
export const IconMic = make(<><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" /></>);
export const IconMicOff = make(<><path d="m1 1 22 22" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8" /></>);
export const IconVideo = make(<><path d="m23 7-7 5 7 5z" /><rect x="1" y="5" width="15" height="14" rx="2.5" /></>);
export const IconVideoOff = make(<><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" /><path d="m1 1 22 22" /></>);
export const IconVolume = make(<><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></>);
export const IconVolumeOff = make(<><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m23 9-6 6M17 9l6 6" /></>);
/** Monitor com seta saindo: compartilhar tela (computador). */
export const IconScreen = make(<><path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3" /><path d="M8 21h8M12 17v4M17 8l5-5M17 3h5v5" /></>);
/** Celular com seta para cima: "Compartilhamento de tela" (como no Instagram). */
export const IconPhoneUp = make(<><rect x="6.5" y="2" width="11" height="20" rx="2.5" /><path d="M12 16.5V9M9 11.8 12 9l3 2.8" /></>);
/** Dois cartões com play: abrir o menu de compartilhar na chamada. */
export const IconShare = make(<><rect x="8" y="3" width="13" height="13" rx="3.5" /><path d="M5.2 8A3 3 0 0 0 3 10.9V18a3 3 0 0 0 3 3h7.1a3 3 0 0 0 2.9-2.2" /><path d="m13 7.8 3.4 2.2-3.4 2.2z" fill="currentColor" /></>);
export const IconPlay = make(<path d="m6 4 14 8-14 8z" fill="currentColor" />);
export const IconCast = make(<><path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" /><path d="M2 20h.01" /></>);
export const IconFlip = make(<><path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></>);
