import { createClient } from "npm:@supabase/supabase-js@2";
import { jwtVerify } from "npm:jose@5";

const enc = new TextEncoder();
const cors = { "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, message: string) => new Response(message, { status, headers: cors });
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
async function authUser(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try { return (await jwtVerify(token, enc.encode(Deno.env.get("JWT_SECRET")!), { audience: "authenticated" })).payload.sub ?? null; }
  catch { return null; }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid || typeof uid !== "string") return fail(401, "unauthorized");
  let body: { appNumber?: string }; try { body = await req.json(); } catch { return fail(400, "json"); }
  const appNumber = String(body.appNumber ?? "").trim();
  if (!/^[1-9]\d{4}-\d{4}$/.test(appNumber)) return fail(400, "número SeuChatSeguro inválido");
  const db = admin();
  const since = new Date(Date.now() - 3600000).toISOString();
  const { count, error: countError } = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("actor", uid).eq("action", "app-number-lookup").gte("created_at", since);
  if (countError) return fail(500, "falha ao consultar limite");
  if ((count ?? 0) >= 30) return fail(429, "muitas buscas, tente mais tarde");
  const { error: auditError } = await db.from("audit_log").insert({ actor: uid, action: "app-number-lookup" });
  if (auditError) return fail(500, "falha ao registrar busca");
  const { data, error } = await db.from("app_number_directory").select("user_id").eq("app_number", appNumber).maybeSingle();
  if (error) return fail(500, "falha na busca");
  if (!data || data.user_id === uid) return fail(404, "não encontrado");
  const { data: identity } = await db.from("identities").select("banned_at").eq("user_id", data.user_id).maybeSingle();
  if (!identity || identity.banned_at) return fail(404, "não encontrado");
  return json({ userId: data.user_id });
});