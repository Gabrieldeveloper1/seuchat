import { useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from "react";
import { EMOJI_GROUPS, TONEABLE } from "../lib/emojiData";
import spriteData from "../lib/emojiSprites.json";
const sprites: Record<string, (string | number)[]> = spriteData;
function Glyph({ ch }: { ch: string }) {
  const sprite = sprites[ch];
  if (!sprite) return <span aria-hidden>{ch}</span>;
  return <span aria-hidden className="emoji-glyph" style={{ backgroundImage: `url(/emoji/${sprite[0]}.webp)`, backgroundPosition: `-${Number(sprite[1]) * 32}px -${Number(sprite[2]) * 32}px` }} />;
}
import { IconBall, IconBulb, IconClock, IconFlagSolid, IconFood, IconHand, IconHeart, IconLeaf, IconPlane, IconSearch, IconSmile, IconX } from "../icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
const ICONS: Record<string, Icon> = { recent: IconClock, smileys: IconSmile, people: IconHand, nature: IconLeaf, food: IconFood, travel: IconPlane, activities: IconBall, objects: IconBulb, symbols: IconHeart, flags: IconFlagSolid };
const TONES = ["", "\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"];
const TONE_SWATCH = ["#ffc93a", "#f7dece", "#f3d2a2", "#d5ab88", "#af7e57", "#7c533e"];
const RECENT_KEY = "scs.emoji.recent";
const TONE_KEY = "scs.emoji.tone";

const DATA = EMOJI_GROUPS.map((g) => {
  const e = g.e.split("\u0001");
  const n = g.n.split("\u0001");
  return { key: g.key, label: g.label, items: e.map((ch, i) => ({ ch, name: n[i] ?? "" })).filter((item) => !!sprites[item.ch]) };
});

function withTone(ch: string, tone: number): string {
  if (!tone) return ch;
  const base = ch.replace(/\uFE0F/g, "");
  return TONEABLE.has(base) ? [...base][0] + TONES[tone] + [...base].slice(1).join("") : ch;
}

function loadRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.slice(0, 32) : []; } catch { return []; }
}

export default function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [tone, setTone] = useState(() => Number(localStorage.getItem(TONE_KEY) ?? 0) || 0);
  const [recent, setRecent] = useState(loadRecent);
  const [cat, setCat] = useState(recent.length ? "recent" : "smileys");
  const [toneOpen, setToneOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (box.current && !box.current.contains(t) && !t.closest("[data-emoji-toggle]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [onClose]);

  const term = q.trim().toLowerCase();
  const results = useMemo(() => term ? DATA.flatMap((g) => g.items).filter((i) => i.name.toLowerCase().includes(term)).slice(0, 240) : [], [term]);

  function pick(ch: string) {
    const tinted = withTone(ch, tone);
    const out = sprites[tinted] ? tinted : ch;
    onPick(out);
    const next = [ch, ...recent.filter((r) => r !== ch)].slice(0, 32);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* armazenamento indisponível */ }
  }
  function jump(key: string) { setCat(key); setQ(""); if (body.current) body.current.scrollTop = 0; }
  const sections = [...(recent.length ? [{ key: "recent", label: "Recentes", items: recent.filter((ch) => !!sprites[ch]).map((ch) => ({ ch, name: ch })) }] : []), ...DATA];
  const current = sections.find((s) => s.key === cat) ?? sections[0];

  return (
    <div className="emoji-pop" ref={box} role="dialog" aria-label="Emojis">
      <div className="emoji-top">
        <div className="emoji-search">
          <IconSearch />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar emoji (em inglês: heart, fire, smile…)" aria-label="Buscar emoji" />
          {q && <button type="button" aria-label="Limpar" onClick={() => setQ("")}><IconX /></button>}
        </div>
        <div className="tone-wrap">
          <button type="button" className="tone-btn" aria-label="Tom de pele" onClick={() => setToneOpen((v) => !v)} style={{ background: TONE_SWATCH[tone] }} />
          {toneOpen && (
            <div className="tone-menu">
              {TONE_SWATCH.map((c, i) => (
                <button type="button" key={c} aria-label={`Tom ${i}`} className={i === tone ? "on" : ""} style={{ background: c }}
                  onClick={() => { setTone(i); setToneOpen(false); localStorage.setItem(TONE_KEY, String(i)); }} />
              ))}
            </div>
          )}
        </div>
      </div>
      <nav className="emoji-cats" aria-label="Categorias">
        {sections.map((s) => { const I = ICONS[s.key]; return (
          <button type="button" key={s.key} title={s.label} aria-label={s.label} className={!term && cat === s.key ? "on" : ""} onClick={() => jump(s.key)}><I /></button>
        ); })}
      </nav>
      <div className="emoji-body" ref={body}>
        {term ? (
          results.length ? <div className="emoji-grid">{results.map((i) => <button type="button" key={i.ch} title={i.name} onClick={() => pick(i.ch)}><Glyph ch={sprites[withTone(i.ch, tone)] ? withTone(i.ch, tone) : i.ch} /></button>)}</div>
            : <div className="emoji-empty"><IconSmile /><span>Nenhum emoji encontrado</span></div>
        ) : (
          <section key={current.key}><h4>{current.label}</h4><div className="emoji-grid">{current.items.map((i) => <button type="button" key={i.ch} title={i.name} aria-label={i.name || i.ch} onClick={() => pick(i.ch)}><Glyph ch={sprites[withTone(i.ch, tone)] ? withTone(i.ch, tone) : i.ch} /></button>)}</div></section>
        )}
      </div>
    </div>
  );
}
