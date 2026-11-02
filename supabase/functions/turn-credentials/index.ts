import { admin, authUser, cors, fail, json } from "../_shared/util.ts";

const enc = new TextEncoder();

async function hmacSha1(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
  let binary = "";
  signature.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid) return fail(401, "unauthorized");
  const db = admin();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error } = await db.from("audit_log").select("id", { count: "exact", head: true })
    .eq("actor", uid).eq("action", "turn-credentials").gte("created_at", since);
  if (error) return fail(500, "falha ao validar limite");
  if ((count ?? 0) >= 60) return fail(429, "muitas chamadas em pouco tempo");
  const { error: auditError } = await db.from("audit_log").insert({ actor: uid, action: "turn-credentials" });
  if (auditError) return fail(500, "falha ao registrar solicitação");

  const sharedSecret = Deno.env.get("TURN_SHARED_SECRET");
  const urls = (Deno.env.get("TURN_URL") ?? "").split(",").map((x) => x.trim()).filter((x) => /^turns?:/i.test(x));
  if (!sharedSecret || sharedSecret.length < 32 || !urls.length) return fail(503, "Servidor TURN não configurado corretamente.");

  // Coturn REST credentials: username is expiry:opaque-user-id; credential is HMAC-SHA1(secret).
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const username = `${expiresAt}:${uid}`;
  const credential = await hmacSha1(sharedSecret, username);
  return json({ iceServers: [{ urls, username, credential }], expiresAt });
});