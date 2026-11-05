// GERADO. Edite supabase/functions/turn-credentials/index.ts e execute node scripts/generate-dashboard.mjs
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



async function hmacSha1(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
  let binary = "";
  signature.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid) return fail(401, "unauthorized");
  const db = admin();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await db.from("audit_log").select("id", { count: "exact", head: true })
    .eq("actor", uid).eq("action", "turn-credentials").gte("created_at", since);
  if (error) return fail(500, "falha ao validar limite");
  if ((count ?? 0) >= 60) return fail(429, "muitas chamadas em pouco tempo");
  const { error: auditError } = await db.from("audit_log").insert({ actor: uid, action: "turn-credentials" });
  if (auditError) return fail(500, "falha ao registrar solicitação");

  const sharedSecret = Deno.env.get("TURN_SHARED_SECRET");
  const urls = (Deno.env.get("TURN_URL") ?? "").split(",").map((x) => x.trim()).filter((x) => /^turns?:/i.test(x));
  if (!sharedSecret || sharedSecret.length < 32 || !urls.length) return fail(503, "Servidor TURN não configurado corretamente.");

  // Coturn REST credentials: username is expiry:opaque-user-id; credential is HMAC-SHA1(secret).
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const username = `${expiresAt}:${uid}`;
  const credential = await hmacSha1(sharedSecret, username);
  return json({ iceServers: [{ urls, username, credential }], expiresAt });
});