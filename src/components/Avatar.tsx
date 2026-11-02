const COLORS = ["#7c5cff", "#e0489b", "#f97316", "#0ea5e9", "#8b5cf6", "#14b8a6", "#d946ef", "#f43f5e"];

export function colorFor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export default function Avatar({ name, seed, size = "", src }: { name: string; seed: string; size?: "sm" | "xl" | ""; src?: string }) {
  if (src) return <img className={`avatar ${size}`} src={src} alt="" loading="lazy" decoding="async" />;
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className={`avatar ${size}`} style={{ background: `linear-gradient(135deg, ${colorFor(seed)}, ${colorFor(seed + "x")})` }} aria-hidden>
      {letter}
    </span>
  );
}
