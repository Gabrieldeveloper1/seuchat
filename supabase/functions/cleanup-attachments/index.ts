import { admin, fail, json } from "../_shared/util.ts";

// Chamada SOMENTE pelo agendador com segredo próprio. Nunca inclua o segredo no frontend.
Deno.serve(async (req) => {
  if (req.method !== "POST") return fail(405, "method");
  const secret = Deno.env.get("ATTACHMENTS_CLEANUP_SECRET");
  if (!secret || req.headers.get("Authorization") !== `Bearer ${secret}`) return fail(401, "unauthorized");
  const db = admin();
  const { data: rows, error } = await db.from("attachments").select("id").eq("kind", "video").lte("expires_at", new Date().toISOString()).limit(500);
  if (error) return fail(500, "Erro ao consultar vídeos vencidos");
  if (!rows?.length) return json({ removed: 0 });
  const ids = rows.map((r) => r.id);
  const { error: storageError } = await db.storage.from("attachments").remove(ids);
  if (storageError) return fail(500, "Erro ao excluir vídeos do armazenamento");
  const { error: deleteError } = await db.from("attachments").delete().in("id", ids).eq("kind", "video").lte("expires_at", new Date().toISOString());
  if (deleteError) return fail(500, "Erro ao excluir registros; execute novamente");
  return json({ removed: ids.length, moreMayRemain: ids.length === 500 });
});
