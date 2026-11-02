import { admin, authUser, cors, fail, json } from "../_shared/util.ts";

const APP_NUMBER = /^[1-9]\d{4}-\d{4}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid) return fail(401, "unauthorized");
  let body: { appNumber?: string };
  try { body = await req.json(); } catch { return fail(400, "json"); }
  const number = String(body.appNumber ?? "").trim();
  if (!APP_NUMBER.test(number)) return fail(400, "número SeuChatSeguro inválido");

  const db = admin();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error: countError } = await db.from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("actor", uid).eq("action", "app-number-lookup").gte("created_at", since);
  if (countError) return fail(500, "falha ao consultar limite");
  if ((count ?? 0) >= 30) return fail(429, "muitas buscas, tente mais tarde");
  const { error: auditError } = await db.from("audit_log").insert({ actor: uid, action: "app-number-lookup" });
  if (auditError) return fail(500, "falha ao registrar busca");

  const { data: row, error } = await db.from("app_number_directory")
    .select("user_id").eq("app_number", number).maybeSingle();
  if (error) return fail(500, "falha na busca");
  if (!row || row.user_id === uid) return fail(404, "não encontrado");
  const { data: identity } = await db.from("identities").select("banned_at").eq("user_id", row.user_id).maybeSingle();
  if (!identity || identity.banned_at) return fail(404, "não encontrado");
  return json({ userId: row.user_id });
});