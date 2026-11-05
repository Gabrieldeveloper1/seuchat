import { admin, authUser, cors, fail, json } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid) return fail(401, "unauthorized");
  const db = admin();
  const { data: me, error: meError } = await db.from("identities").select("banned_at").eq("user_id", uid).maybeSingle();
  if (meError) return fail(503, "Erro de servidor");
  if (!me || me.banned_at) return fail(403, "forbidden");
  let body: { op?: string; expected?: number; nonce?: string; ciphertext?: string };
  try { body = await req.json(); } catch { return fail(400, "json"); }
  if (body.op === "get") {
    const { data, error } = await db.from("profile_snapshots").select("revision,nonce,ciphertext").eq("user_id", uid).maybeSingle();
    if (error) return fail(503, "Falha ao consultar perfil");
    return json({ snapshot: data });
  }
  if (body.op === "put") {
    if (!Number.isSafeInteger(body.expected) || body.expected! < 0 || typeof body.nonce !== "string" || !/^[A-Za-z0-9+/]{32}$/.test(body.nonce) || typeof body.ciphertext !== "string" || body.ciphertext.length > 260000 || body.ciphertext.length < 24 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.ciphertext)) return fail(400, "Dados inválidos");
    const { data: revision, error } = await db.rpc("save_profile_snapshot", { p_user: uid, p_expected: body.expected, p_nonce: body.nonce, p_ciphertext: body.ciphertext });
    if (error) return fail(503, "Falha ao salvar perfil");
    if (!revision) return fail(409, "Perfil alterado em outro aparelho");
    return json({ revision });
  }
  return fail(400, "op");
});
