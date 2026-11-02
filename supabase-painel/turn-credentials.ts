import { jwtVerify } from "npm:jose@5";
import { createClient } from "npm:@supabase/supabase-js@2";

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
async function hmacSha1(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid || typeof uid !== "string") return fail(401, "unauthorized");
  const db = admin();
  const since = new Date(Date.now() - 3600000).toISOString();
  const { count, error } = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("actor", uid).eq("action", "turn-credentials").gte("created_at", since);
  if (error) return fail(500, "falha ao validar limite");
  if ((count ?? 0) >= 60) return fail(429, "muitas chamadas em pouco tempo");
  const { error: auditError } = await db.from("audit_log").insert({ actor: uid, action: "turn-credentials" });
  if (auditError) return fail(500, "falha ao registrar solicitação");
  const secret = Deno.env.get("TURN_SHARED_SECRET");
  const urls = (Deno.env.get("TURN_URL") ?? "").split(",").map((s) => s.trim()).filter((s) => /^turns?:/i.test(s));
  if (!secret || secret.length < 32 || !urls.length) return fail(503, "Servidor TURN não configurado corretamente.");
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const username = `${expiresAt}:${uid}`;
  return json({ iceServers: [{ urls, username, credential: await hmacSha1(secret, username) }], expiresAt });
});