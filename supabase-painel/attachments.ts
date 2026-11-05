// GERADO. Edite supabase/functions/attachments/index.ts e execute node scripts/generate-dashboard.mjs
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



// Anexos cifrados de ponta a ponta. O servidor só emite URLs assinadas e curtas
// para enviar/baixar bytes já cifrados pelo aparelho; ele não tem a chave.
const BUCKET = "attachments";
const MAX_SIZE = 25 * 1024 * 1024;
const MAX_PER_HOUR = 60;
const MAX_BYTES_PER_DAY = 500 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid) return fail(401, "unauthorized");

  let b: { op?: string; size?: number; id?: string; kind?: "video" | "file"; recipients?: unknown };
  try { b = await req.json(); } catch { return fail(400, "json"); }
  const db = admin();

  const { data: me } = await db.from("identities").select("banned_at").eq("user_id", uid).maybeSingle();
  if (!me || me.banned_at) return fail(403, "forbidden");

  if (b.op === "upload") {
    const size = Number(b.size);
    if (!Number.isInteger(size) || size <= 0 || size > MAX_SIZE) return fail(413, "Arquivo grande demais (máximo 25 MB).");

    if (b.kind !== "video" && b.kind !== "file") return fail(400, "Tipo de anexo inválido.");
    if (!Array.isArray(b.recipients) || !b.recipients.length || b.recipients.length > 100 || b.recipients.some((v) => typeof v !== "string" || !/^[a-z2-7]{26}$/.test(v) || v === uid)) return fail(400, "Destinatários inválidos.");
    const recipients = [...new Set(b.recipients as string[])];
    const { data: users, error: userError } = await db.from("identities").select("user_id").in("user_id", recipients).is("banned_at", null);
    if (userError) return fail(503, "Falha ao validar destinatários.");
    if (!users || users.length !== recipients.length) return fail(400, "Um destinatário está indisponível.");

    const hour = new Date(Date.now() - 3600_000).toISOString();
    const day = new Date(Date.now() - 86400_000).toISOString();
    const { count } = await db.from("attachments").select("id", { count: "exact", head: true }).eq("owner_id", uid).gte("created_at", hour);
    if ((count ?? 0) >= MAX_PER_HOUR) return fail(429, "Muitos anexos em pouco tempo. Aguarde um pouco.");
    const { data: today } = await db.from("attachments").select("size").eq("owner_id", uid).gte("created_at", day);
    const used = (today ?? []).reduce((n, r) => n + Number(r.size), 0);
    if (used + size > MAX_BYTES_PER_DAY) return fail(429, "Limite diário de anexos atingido.");

    const { data: row, error } = await db.from("attachments").insert({ owner_id: uid, size, kind: b.kind, expires_at: b.kind === "video" ? new Date(Date.now() + 10 * 86400_000).toISOString() : null }).select("id,expires_at").single();
    if (error || !row) return fail(500, "falha ao reservar anexo");
    const { error: aclError } = await db.from("attachment_recipients").insert(recipients.map((user_id) => ({ attachment_id: row.id, user_id })));
    if (aclError) { await db.from("attachments").delete().eq("id", row.id); return fail(500, "Falha ao proteger anexo."); }
    const { data: up, error: upErr } = await db.storage.from(BUCKET).createSignedUploadUrl(row.id);
    if (upErr || !up) { await db.from("attachments").delete().eq("id", row.id); return fail(500, "falha ao preparar envio"); }
    return json({ id: row.id, path: up.path, token: up.token, signedUrl: up.signedUrl, expiresAt: row.expires_at });
  }

  if (b.op === "download") {
    if (!b.id || !UUID.test(b.id)) return fail(400, "id");
    const { data: row } = await db.from("attachments").select("id,owner_id,expires_at").eq("id", b.id).maybeSingle();
    if (!row || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) return fail(404, "Anexo expirado ou removido.");
    if (row.owner_id !== uid) {
      const { data: permission, error: aclError } = await db.from("attachment_recipients").select("user_id").eq("attachment_id", row.id).eq("user_id", uid).maybeSingle();
      if (aclError) return fail(503, "Falha ao verificar permissão.");
      if (!permission) return fail(404, "Anexo indisponível.");
    }
    const { data: dl, error } = await db.storage.from(BUCKET).createSignedUrl(row.id, row.expires_at ? Math.max(1, Math.min(300, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000))) : 300);
    if (error || !dl) return fail(500, "falha ao preparar download");
    return json({ url: dl.signedUrl });
  }

  return fail(400, "op");
});
