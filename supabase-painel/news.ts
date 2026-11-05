// GERADO. Edite supabase/functions/news/index.ts e execute node scripts/generate-dashboard.mjs
// Utilidades compartilhadas das Edge Functions (Deno).
import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, jwtVerify } from "npm:jose@5";

export const enc = new TextEncoder();

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
export const fail = (status: number, msg: string) =>
  new Response(msg, { status, headers: cors });

export function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64e = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
/** bytea vindo do PostgREST: "\\x0a1b..." */
export const fromPg = (h: string) => {
  const s = h.startsWith("\\x") ? h.slice(2) : h;
  const u = new Uint8Array(s.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return u;
};
/** bytea para inserir via PostgREST */
export const toPg = (u: Uint8Array) => "\\x" + Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

export const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of p) {
    o.set(x, i);
    i += x.length;
  }
  return o;
};

export const eq = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
};

export async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export const sha256 = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));

const A = "abcdefghijklmnopqrstuvwxyz234567";
export function base32(u: Uint8Array): string {
  let bits = 0, val = 0, out = "";
  for (const b of u) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += A[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
    val &= (1 << bits) - 1;
  }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}

/** ID público: base32 dos 16 primeiros bytes de SHA-256(chave pública de identidade). */
export async function userIdFromIdKey(idKey: Uint8Array) {
  return base32((await sha256(idKey)).slice(0, 16));
}

// ---- JWT (assinado com o JWT secret do projeto para que a RLS do Postgres o aceite) ----
const jwtKey = () => enc.encode(Deno.env.get("JWT_SECRET")!);

export async function issueJwt(userId: string) {
  return await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(jwtKey());
}

export async function authUser(req: Request): Promise<string | null> {
  const t = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, jwtKey(), { audience: "authenticated" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// ---- Moderação via Discord (webhook com botões-link assinados) ----
const b64url = (u: Uint8Array) => b64e(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function signDecision(id: string, action: string, exp: number) {
  return b64url(await hmac(b64d(Deno.env.get("DISCORD_LINK_KEY")!), enc.encode(`${id}.${action}.${exp}`)));
}

export interface ReportCard { id: string; category: string; reportedId: string; autoBanned: boolean; status?: string; by?: string }
const CAT: Record<string, string> = { csam: "Abuso infantil (CSAM)", harassment: "Assédio/ameaça", spam: "Spam/golpe", other: "Outro" };

function embed(r: ReportCard) {
  const color = r.status === "actioned" ? 0xdc2626 : r.status === "dismissed" ? 0x64748b : r.category === "csam" ? 0xdc2626 : 0xf59e0b;
  const state = r.status === "reviewing" ? "🔎 Em análise" : r.status === "actioned" ? `✅ Aprovada por ${r.by}` : r.status === "dismissed" ? `❌ Rejeitada por ${r.by}` : "⏳ Aguardando decisão";
  return {
    title: "Nova denúncia", color, timestamp: new Date().toISOString(),
    fields: [
      { name: "Categoria", value: CAT[r.category] ?? r.category, inline: true },
      { name: "Estado", value: state, inline: true },
      { name: "ID denunciado", value: `\`${r.reportedId}\`` },
      { name: "Denúncia", value: `\`${r.id}\`` },
      ...(r.autoBanned ? [{ name: "Ação automática", value: "ID banido preventivamente. Rejeitar desfaz o banimento." }] : []),
    ],
    footer: { text: "O conteúdo não é enviado ao Discord. Abra a central do administrador." },
  };
}

/** Envia a denúncia ao Discord (somente metadados). Devolve o id da mensagem para editar depois. */
export async function discordNotify(r: ReportCard): Promise<string | null> {
  const hook = Deno.env.get("DISCORD_WEBHOOK_URL"), site = Deno.env.get("SITE_URL");
  if (!hook || !site) return null;
  const res = await fetch(`${hook}?wait=true&with_components=true`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "SeuChatSeguro Moderação", embeds: [embed(r)],
      components: [{ type: 1, components: [{ type: 2, style: 5, label: "Abrir central", url: `${site.replace(/\/$/, "")}/#/admin-cases` }] }],
    }),
  });
  return res.ok ? String((await res.json()).id) : null;
}

/** Atualiza a mensagem após a decisão (remove os botões). */
export async function discordResolve(messageId: string, r: ReportCard) {
  const hook = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!hook) return;
  await fetch(`${hook}/messages/${messageId}?with_components=true`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed(r)], components: [] }),
  }).catch(() => {});
}

/** Apenas metadados da apelação; nunca envia mensagem denunciada ou conteúdo ao Discord. */
export async function discordAppeal(id: string, reportId: string, role: string): Promise<void> {
  const hook=Deno.env.get("DISCORD_WEBHOOK_URL"), site=Deno.env.get("SITE_URL");
  if (!hook || !site) return;
  await fetch(`${hook}?wait=true&with_components=true`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"SeuChatSeguro Moderação",embeds:[{title:"Apelação recebida",description:`Denúncia: ${reportId}\nPapel: ${role === "reported" ? "conta denunciada" : "denunciante"}\nA revisão é feita pelo administrador da conta autorizada.`,color:0x356be5}],components:[{type:1,components:[{type:2,style:5,label:"Abrir central",url:`${site.replace(/\/$/, "")}/#/admin-cases`}]}]})});
}


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
