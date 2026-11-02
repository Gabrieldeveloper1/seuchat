import { authUser, cors, fail, json } from "../_shared/util.ts";
import { parseRss, type NewsItem } from "../_shared/rss.ts";

// Notícias do dia a partir de RSS públicos. O servidor busca as fontes para o aparelho
// não expor o IP aos sites de notícia; o resultado fica em cache por 10 minutos.
const G = (q: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:1d")}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
const FEEDS: Record<string, [string, string][]> = {
  destaques: [["https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419", "Google Notícias"], ["https://g1.globo.com/rss/g1/", "g1"]],
  brasil: [["https://g1.globo.com/rss/g1/", "g1"], [G("Brasil"), "Google Notícias"]],
  mundo: [["https://feeds.bbci.co.uk/portuguese/rss.xml", "BBC News Brasil"], [G("internacional"), "Google Notícias"]],
  economia: [[G("economia"), "Google Notícias"]],
  tecnologia: [[G("tecnologia"), "Google Notícias"]],
  esportes: [[G("esportes futebol"), "Google Notícias"]],
  entretenimento: [[G("entretenimento famosos"), "Google Notícias"]],
  ciencia: [[G("ciência saúde"), "Google Notícias"]],
};
const cache = new Map<string, { at: number; items: NewsItem[] }>();
const TTL = 10 * 60 * 1000;

async function load(cat: string): Promise<NewsItem[]> {
  const hit = cache.get(cat);
  if (hit && Date.now() - hit.at < TTL) return hit.items;
  const lists = await Promise.all(FEEDS[cat].map(async ([url, src]) => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "SeuChatSeguro-News/1.0" } });
      clearTimeout(t);
      return r.ok ? parseRss(await r.text(), src) : [];
    } catch { return []; }
  }));
  const seen = new Set<string>();
  const items = lists.flat().filter((i) => { const k = i.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.date - a.date).slice(0, 40);
  if (items.length) cache.set(cat, { at: Date.now(), items });
  return items.length ? items : hit?.items ?? [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  if (!(await authUser(req))) return fail(401, "unauthorized");
  let b: { cat?: string };
  try { b = await req.json(); } catch { return fail(400, "json"); }
  const cat = b.cat && FEEDS[b.cat] ? b.cat : "destaques";
  const items = await load(cat);
  if (!items.length) return fail(503, "Não foi possível carregar as notícias agora.");
  return json({ cat, items, updatedAt: cache.get(cat)?.at ?? Date.now() });
});
