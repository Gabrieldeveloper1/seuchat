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
  const db = admin();
  const current = await db.from("app_number_directory").select("app_number").eq("user_id", uid).maybeSingle();
  if (current.error) return fail(500, "migration 005 não aplicada");
  if (current.data?.app_number) return json({ appNumber: current.data.app_number });
  for (let i = 0; i < 32; i++) {
    const random = new Uint32Array(2); crypto.getRandomValues(random);
    const appNumber = `${10000 + random[0] % 90000}-${String(random[1] % 10000).padStart(4, "0")}`;
    const inserted = await db.from("app_number_directory").insert({ app_number: appNumber, user_id: uid });
    if (!inserted.error) return json({ appNumber });
    const raced = await db.from("app_number_directory").select("app_number").eq("user_id", uid).maybeSingle();
    if (raced.data?.app_number) return json({ appNumber: raced.data.app_number });
    if (inserted.error.code !== "23505") return fail(500, "falha ao gerar número");
  }
  return fail(503, "não foi possível gerar um número exclusivo");
});