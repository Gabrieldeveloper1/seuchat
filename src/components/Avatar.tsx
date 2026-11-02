const COLORS = ["#7c5cff", "#e0489b", "#f97316", "#0ea5e9", "#8b5cf6", "#14b8a6", "#d946ef", "#f43f5e"];

export function colorFor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export const DEFAULT_AVATAR = "/default-avatar.svg";

export const DEFAULT_GROUP_AVATAR = "/default-group.jpg";

export default function Avatar({ name, seed: _seed, size = "", src, group = false }: { name: string; seed: string; size?: "sm" | "xl" | ""; src?: string; group?: boolean }) {
  const fallback = group ? DEFAULT_GROUP_AVATAR : DEFAULT_AVATAR;
  return <img className={`avatar ${size}`} src={src || fallback} alt={group ? `Imagem de ${name}` : ""} loading="lazy" decoding="async"
    onError={(e) => { if (!e.currentTarget.src.endsWith(fallback)) e.currentTarget.src = fallback; }} />;
}
