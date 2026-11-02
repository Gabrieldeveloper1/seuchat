import { admin, authUser, cors, fail, json } from "../_shared/util.ts";

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

  let b: { op?: string; size?: number; id?: string };
  try { b = await req.json(); } catch { return fail(400, "json"); }
  const db = admin();

  const { data: me } = await db.from("identities").select("banned_at").eq("user_id", uid).maybeSingle();
  if (!me || me.banned_at) return fail(403, "forbidden");

  if (b.op === "upload") {
    const size = Number(b.size);
    if (!Number.isInteger(size) || size <= 0 || size > MAX_SIZE) return fail(413, "Arquivo grande demais (máximo 25 MB).");

    // limpeza oportunista dos anexos vencidos deste usuário
    const { data: old } = await db.from("attachments").select("id").eq("owner_id", uid).lt("expires_at", new Date().toISOString()).limit(50);
    if (old?.length) {
      await db.storage.from(BUCKET).remove(old.map((o) => o.id));
      await db.from("attachments").delete().in("id", old.map((o) => o.id));
    }

    const hour = new Date(Date.now() - 3600_000).toISOString();
    const day = new Date(Date.now() - 86400_000).toISOString();
    const { count } = await db.from("attachments").select("id", { count: "exact", head: true }).eq("owner_id", uid).gte("created_at", hour);
    if ((count ?? 0) >= MAX_PER_HOUR) return fail(429, "Muitos anexos em pouco tempo. Aguarde um pouco.");
    const { data: today } = await db.from("attachments").select("size").eq("owner_id", uid).gte("created_at", day);
    const used = (today ?? []).reduce((n, r) => n + Number(r.size), 0);
    if (used + size > MAX_BYTES_PER_DAY) return fail(429, "Limite diário de anexos atingido.");

    const { data: row, error } = await db.from("attachments").insert({ owner_id: uid, size }).select("id").single();
    if (error || !row) return fail(500, "falha ao reservar anexo");
    const { data: up, error: upErr } = await db.storage.from(BUCKET).createSignedUploadUrl(row.id);
    if (upErr || !up) { await db.from("attachments").delete().eq("id", row.id); return fail(500, "falha ao preparar envio"); }
    return json({ id: row.id, path: up.path, token: up.token, signedUrl: up.signedUrl });
  }

  if (b.op === "download") {
    if (!b.id || !UUID.test(b.id)) return fail(400, "id");
    const { data: row } = await db.from("attachments").select("id,expires_at").eq("id", b.id).maybeSingle();
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return fail(404, "Anexo expirado ou removido.");
    const { data: dl, error } = await db.storage.from(BUCKET).createSignedUrl(row.id, 300);
    if (error || !dl) return fail(500, "falha ao preparar download");
    return json({ url: dl.signedUrl });
  }

  return fail(400, "op");
});
