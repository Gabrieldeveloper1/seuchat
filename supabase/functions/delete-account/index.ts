import { admin, authUser, cors, fail, json } from "../_shared/util.ts";

// Exclusão de conta (exigida pela App Store): apaga identidade, prekeys, tokens e fila de mensagens (cascade).
// Denúncias e bans permanecem (obrigação de segurança / legal_hold).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const uid = await authUser(req);
  if (!uid) return fail(401, "unauthorized");
  const db = admin();
  const { data: ban } = await db.from("bans").select("id").eq("user_id", uid).limit(1);
  if (ban?.length) return fail(403, "conta banida não pode ser excluída por este fluxo");
  const { error } = await db.from("identities").delete().eq("user_id", uid);
  if (error) return fail(500, error.message);
  return json({ ok: true });
});
