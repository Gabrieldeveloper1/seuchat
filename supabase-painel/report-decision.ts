import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, jwtVerify } from "npm:jose@5";

// ---- util compartilhado (inline) ----
// Utilidades compartilhadas das Edge Functions (Deno).

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
  const state = r.status === "actioned" ? `✅ Aprovada por ${r.by}` : r.status === "dismissed" ? `❌ Rejeitada por ${r.by}` : "⏳ Aguardando decisão";
  return {
    title: "Nova denúncia", color, timestamp: new Date().toISOString(),
    fields: [
      { name: "Categoria", value: CAT[r.category] ?? r.category, inline: true },
      { name: "Estado", value: state, inline: true },
      { name: "ID denunciado", value: `\`${r.reportedId}\`` },
      { name: "Denúncia", value: `\`${r.id}\`` },
      ...(r.autoBanned ? [{ name: "Ação automática", value: "ID banido preventivamente. Rejeitar desfaz o banimento." }] : []),
    ],
    footer: { text: "O conteúdo da mensagem NÃO é enviado ao Discord. Use o script decrypt-evidence." },
  };
}

/** Envia a denúncia ao Discord (somente metadados). Devolve o id da mensagem para editar depois. */
export async function discordNotify(r: ReportCard): Promise<string | null> {
  const hook = Deno.env.get("DISCORD_WEBHOOK_URL"), site = Deno.env.get("SITE_URL");
  if (!hook || !site || !Deno.env.get("DISCORD_LINK_KEY")) return null;
  const exp = Date.now() + 7 * 86400_000;
  const link = async (a: string) => `${site.replace(/\/$/, "")}/#/mod?r=${r.id}&a=${a}&e=${exp}&s=${await signDecision(r.id, a, exp)}`;
  const res = await fetch(`${hook}?wait=true&with_components=true`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "SeuChatSeguro Moderação", embeds: [embed(r)],
      components: [{ type: 1, components: [
        { type: 2, style: 5, label: "Aprovar", url: await link("approve") },
        { type: 2, style: 5, label: "Rejeitar", url: await link("reject") },
      ] }],
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

// ---- função ----

// Decisão do administrador (links do Discord). Exige: link assinado e não expirado + chave de administrador.
// MODERATION_ADMIN_KEYS="ana:chave1,bruno:chave2"  (a chave identifica quem decidiu na auditoria)
function adminName(key: string): string | null {
  for (const pair of (Deno.env.get("MODERATION_ADMIN_KEYS") ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i > 0 && key.length >= 16 && eq(enc.encode(pair.slice(i + 1).trim()), enc.encode(key))) return pair.slice(0, i).trim();
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  let b: { r?: string; a?: string; e?: string; s?: string; key?: string };
  try { b = await req.json(); } catch { return fail(400, "json"); }
  const exp = Number(b.e);
  if (!b.r || !/^[0-9a-f-]{36}$/.test(b.r) || (b.a !== "approve" && b.a !== "reject") || !b.s || !(exp > Date.now())) return fail(400, "link inválido ou expirado");
  if (!eq(enc.encode(await signDecision(b.r, b.a, exp)), enc.encode(b.s))) return fail(403, "assinatura do link inválida");
  const who = adminName(b.key ?? "");
  if (!who) { await new Promise((r) => setTimeout(r, 1500)); return fail(403, "chave de administrador incorreta"); }

  const db = admin();
  const { data: rep } = await db.from("reports").select("id,category,reported_id,status,discord_message_id,decided_by").eq("id", b.r).maybeSingle();
  if (!rep) return fail(404, "denúncia não encontrada");
  if (rep.status === "actioned" || rep.status === "dismissed") return fail(409, `já decidida por ${rep.decided_by ?? "outro administrador"}`);

  const approve = b.a === "approve";
  if (approve) {
    const { data: ban } = await db.from("bans").select("id").eq("user_id", rep.reported_id).limit(1);
    if (!ban?.length) {
      await db.from("identities").update({ banned_at: new Date().toISOString() }).eq("user_id", rep.reported_id);
      await db.from("bans").insert({ user_id: rep.reported_id, reason: `report_approved:${rep.category}`, report_id: rep.id });
      await db.from("relay_messages").delete().eq("sender_id", rep.reported_id);
    }
  } else {
    // rejeitar desfaz o banimento preventivo criado por ESTA denúncia (a evidência segue preservada se houver legal_hold)
    const { data: mine } = await db.from("bans").select("id").eq("report_id", rep.id);
    if (mine?.length) {
      await db.from("bans").delete().eq("report_id", rep.id);
      const { data: other } = await db.from("bans").select("id").eq("user_id", rep.reported_id).limit(1);
      if (!other?.length) await db.from("identities").update({ banned_at: null }).eq("user_id", rep.reported_id);
    }
  }
  const status = approve ? "actioned" : "dismissed";
  await db.from("reports").update({ status, decided_by: who, decided_at: new Date().toISOString() }).eq("id", rep.id);
  await db.from("audit_log").insert({ actor: who, action: approve ? "report_approved" : "report_rejected", target: rep.id });
  if (rep.discord_message_id) await discordResolve(rep.discord_message_id, { id: rep.id, category: rep.category, reportedId: rep.reported_id, autoBanned: false, status, by: who });
  return json({ ok: true, status, by: who });
});
