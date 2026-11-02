// Leitor de RSS simples e tolerante (sem dependências), usado pela função "news".
export interface NewsItem { title: string; link: string; source: string; date: number; summary?: string; image?: string }

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
const strip = (s: string) => decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
};
const safeUrl = (u: string) => { try { const x = new URL(decode(u).trim()); return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : ""; } catch { return ""; } };

export function parseRss(xml: string, fallbackSource: string): NewsItem[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const out: NewsItem[] = [];
  for (const it of items) {
    let title = strip(tag(it, "title"));
    const link = safeUrl(strip(tag(it, "link")));
    if (!title || !link) continue;
    let source = strip(tag(it, "source")) || fallbackSource;
    // Google Notícias põe " - Fonte" no fim do título
    const dash = title.lastIndexOf(" - ");
    if (dash > 20 && source !== fallbackSource && title.slice(dash + 3) === source) title = title.slice(0, dash);
    const date = Date.parse(strip(tag(it, "pubDate"))) || 0;
    const rawDesc = tag(it, "description");
    const img = it.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i)?.[1]
      ?? it.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i)?.[1]
      ?? decode(rawDesc).match(/<img[^>]*src="([^"]+)"/i)?.[1];
    const summary = strip(tag(it, "atom:subtitle") || rawDesc).slice(0, 280);
    out.push({ title: title.slice(0, 220), link, source: source.slice(0, 60), date, summary: summary && summary !== title ? summary : undefined, image: img ? safeUrl(img) || undefined : undefined });
  }
  return out;
}
