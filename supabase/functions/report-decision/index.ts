import { admin, cors, discordResolve, eq, fail, enc, json, signDecision } from "../_shared/util.ts";

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
