// GERADO. Edite supabase/functions/report-verify/index.ts e execute node scripts/generate-dashboard.mjs
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


import nacl from "npm:tweetnacl@1";

// Denúncia verificável (message franking). O denunciante é o DESTINATÁRIO da mensagem.
const SERVER_KEY = () => b64d(Deno.env.get("FRANKING_SERVER_KEY")!);

/** "Sealed box" simples para a moderação: efêmera(32) || nonce(24) || nacl.box. */
function seal(msg: Uint8Array, recipientPub: Uint8Array) {
  const eph = nacl.box.keyPair();
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  return cat(eph.publicKey, nonce, nacl.box(msg, nonce, recipientPub, eph.secretKey));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const reporterId = await authUser(req);
  if (!reporterId) return fail(401, "unauthorized");

  const modPub = Deno.env.get("MODERATION_PUBKEY");
  if (!modPub) return fail(500, "chave de moderação não configurada");

  let b: { reportedId: string; category: string; plaintext: string; frank: { key: string; tag: string; senderSig: string; serverMac: string; sentAt: number } };
  try { b = await req.json(); } catch { return fail(400, "json"); }
  if (b.category !== "csam") return fail(400, "categoria");
  if (!/^[a-z2-7]{26}$/.test(b.reportedId) || typeof b.plaintext !== "string" || b.plaintext.length > 400_000) return fail(400, "campos");

  const key = b64d(b.frank.key), tag = b64d(b.frank.tag), sig = b64d(b.frank.senderSig), mac = b64d(b.frank.serverMac);

  // 1. o texto revelado bate com a tag? (prova que é exatamente o que foi enviado)
  const expectedTag = await hmac(key, cat(enc.encode("scs-frank-v1"), enc.encode(b.plaintext)));
  if (!eq(expectedTag, tag)) return fail(422, "tag não confere");

  // 2. o carimbo do servidor confere? (passou pelo relay entre esses dois IDs, nesse horário)
  const expectedMac = await hmac(SERVER_KEY(), cat(tag, enc.encode(b.reportedId), enc.encode(reporterId), enc.encode(String(b.frank.sentAt))));
  if (!eq(expectedMac, mac)) return fail(422, "carimbo não confere");

  // 3. a assinatura do remetente confere? (prova de autoria)
  const db = admin();
  const { data: sender } = await db.from("identities").select("identity_key,attestation_hash").eq("user_id", b.reportedId).maybeSingle();
  if (!sender || !nacl.sign.detached.verify(cat(enc.encode("scs-sig-v1"), tag, enc.encode(reporterId)), sig, fromPg(sender.identity_key))) return fail(422, "assinatura do remetente");

  // 4. grava a evidência cifrada para a moderação (nunca em texto claro)
  const evidence = seal(enc.encode(JSON.stringify({ plaintext: b.plaintext, frank: b.frank, reporterId, reportedId: b.reportedId })), b64d(modPub));
  const isCsam = b.category === "csam";
  const { data: report, error } = await db.from("reports").insert({
    reporter_id: reporterId,
    reported_id: b.reportedId,
    category: b.category,
    evidence: toPg(evidence),
    verified: true,
    legal_hold: isCsam, // preservação: fora da limpeza automática
  }).select("id").single();
  if (error || !report) return fail(500, error?.message ?? "erro");

  // A criptografia comprova autoria e integridade, não a natureza da mensagem.
  // Nenhum banimento é aplicado sem revisão humana da evidência.
  // 6. avisa a moderação no Discord (só metadados; falha aqui não derruba a denúncia)
  try {
    const mid = await discordNotify({ id: report.id, category: b.category, reportedId: b.reportedId, autoBanned: false });
    if (mid) await db.from("reports").update({ discord_message_id: mid }).eq("id", report.id);
  } catch { /* ignora */ }
  return json({ reportId: report.id, verified: true, sealed: b64e(evidence).length > 0 });
});
