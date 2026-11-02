import { admin, authUser, b64d, cors, enc, fail, hmac, json, toPg } from "../_shared/util.ts";

// Procura quem usa um número. Exige login. Devolve só o ID público (nunca o número de volta).
const E164 = /^\+[1-9]\d{7,14}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid) return fail(401, "unauthorized");
  let b: { phone?: string };
  try { b = await req.json(); } catch { return fail(400, "json"); }
  if (!b.phone || !E164.test(b.phone)) return fail(400, "telefone inválido");
  const pepper = Deno.env.get("PHONE_PEPPER");
  if (!pepper) return fail(500, "PHONE_PEPPER não configurado");

  const db = admin();
  // anti-enumeração simples: máx. 30 buscas/hora por usuário (tabela audit_log)
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("actor", uid).eq("action", "phone-lookup").gte("created_at", since);
  if ((count ?? 0) >= 30) return fail(429, "muitas buscas, tente mais tarde");
  await db.from("audit_log").insert({ actor: uid, action: "phone-lookup" });

  const hash = await hmac(b64d(pepper), enc.encode(b.phone));
  const { data: row } = await db.from("phone_directory").select("user_id,verified").eq("phone_hash", toPg(hash)).maybeSingle();
  if (!row || (!row.verified && Deno.env.get("ALLOW_UNVERIFIED_PHONES") !== "true")) return fail(404, "não encontrado");
  const { data: id } = await db.from("identities").select("banned_at").eq("user_id", row.user_id).maybeSingle();
  if (!id || id.banned_at) return fail(404, "não encontrado");
  return json({ userId: row.user_id, verified: row.verified });
});
