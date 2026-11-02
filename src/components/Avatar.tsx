const COLORS = ["#7c5cff", "#e0489b", "#f97316", "#0ea5e9", "#8b5cf6", "#14b8a6", "#d946ef", "#f43f5e"];

export function colorFor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export const DEFAULT_AVATAR = "/default-avatar.svg";

export default function Avatar({ name, seed, size = "", src, group = false }: { name: string; seed: string; size?: "sm" | "xl" | ""; src?: string; group?: boolean }) {
  if (!group) {
    return (
      <img
        className={`avatar ${size}`}
        src={src || DEFAULT_AVATAR}
        alt=""
        loading="lazy"
        decoding="async"
        onError={(e) => { if (!e.currentTarget.src.endsWith(DEFAULT_AVATAR)) e.currentTarget.src = DEFAULT_AVATAR; }}
      />
    );
  }
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className={`avatar ${size}`} style={{ background: `linear-gradient(135deg, ${colorFor(seed)}, ${colorFor(seed + "x")})` }} aria-hidden>
      {letter}
    </span>
  );
}
