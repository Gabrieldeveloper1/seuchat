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

// ---- marca (Black Chique) ----
let logoSeq = 0;
export function Logo({ size = 36, framed = true, ...p }: P & { size?: number; framed?: boolean }) {
  const id = `lg${++logoSeq}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable={false} {...p}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f6e7b8" /><stop offset=".5" stopColor="#d4af5f" /><stop offset="1" stopColor="#9a7630" /></linearGradient>
        <radialGradient id={`${id}b`} cx=".3" cy=".2" r="1"><stop offset="0" stopColor="#26231d" /><stop offset="1" stopColor="#070708" /></radialGradient>
      </defs>
      {framed && <><rect width="64" height="64" rx="16" fill={`url(#${id}b)`} /><rect x="1.5" y="1.5" width="61" height="61" rx="14.5" fill="none" stroke={`url(#${id}g)`} strokeOpacity=".55" /></>}
      <path d="M18 16h28a7 7 0 0 1 7 7v15a7 7 0 0 1-7 7H31l-9 7v-7h-4a7 7 0 0 1-7-7V23a7 7 0 0 1 7-7z" fill="none" stroke={`url(#${id}g)`} strokeWidth="3.6" strokeLinejoin="round" />
      <circle cx="32" cy="27.5" r="4.4" fill={`url(#${id}g)`} />
      <path d="M30.2 30h3.6l1.4 7.5h-6.4z" fill={`url(#${id}g)`} />
    </svg>
  );
}
export function Wordmark() {
  return <span className="wordmark"><Logo size={34} /><span>SeuChat<b>Seguro</b></span></span>;
}
export const IconPalette = make(<><circle cx="13.5" cy="6.5" r="1.2" fill="currentColor" /><circle cx="17.5" cy="10.5" r="1.2" fill="currentColor" /><circle cx="8.5" cy="7.5" r="1.2" fill="currentColor" /><circle cx="6.5" cy="12.5" r="1.2" fill="currentColor" /><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 23 9.8C23 5.5 18.1 2 12 2z" /></>);
export const IconLogout = make(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>);
export const IconInfo = make(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>);
// ---- emojis, carregamento e ajustes ----
export const IconSmile = make(<><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><path d="M9 9h.01M15 9h.01" strokeWidth="2.6" /></>);
export const IconHand = make(<><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></>);
export const IconLeaf = make(<><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" /></>);
export const IconFood = make(<><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" /></>);
export const IconPlane = make(<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />);
export const IconBall = make(<><circle cx="12" cy="12" r="10" /><path d="M4.93 4.93c4.08 2.38 8.07 7.23 9.2 14.9M19.07 4.93c-4.08 2.38-8.07 7.23-9.2 14.9M2 12h20" /></>);
export const IconBulb = make(<><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6M10 22h4" /></>);
export const IconHeart = make(<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z" />);
export const IconFlagSolid = make(<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" fill="currentColor" fillOpacity=".15" /><path d="M4 22v-7" /></>);
export const IconSparkle = make(<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z" />);
export const IconLoader = make(<><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></>);
export const IconBell = make(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>);
export const IconFingerprint = make(<><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4M14 13.12c0 2.38 0 6.38-1 8.88M17.29 21.02c.12-.6.43-2.3.5-3.02M2 12a10 10 0 0 1 18-6M2 16h.01M21.8 16c.2-2 .131-5.354 0-6M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2M8.65 22c.21-.66.45-1.32.57-2M9 6.8a6 6 0 0 1 9 5.2v2" /></>);
export const IconHash = make(<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />);
export const IconFileText = make(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" /></>);
export const IconChevronRight = make(<path d="m9 18 6-6-6-6" />);
export const IconDevice = make(<><rect x="5" y="2" width="14" height="20" rx="2.5" /><path d="M12 18h.01" /></>);
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>);
