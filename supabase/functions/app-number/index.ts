import { admin, authUser, cors, fail, json } from "../_shared/util.ts";
import { getOrCreateAppNumber } from "../_shared/appNumber.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid) return fail(401, "unauthorized");
  try {
    const number = await getOrCreateAppNumber(admin(), uid);
    return json({ appNumber: number });
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "falha ao gerar identificador");
  }
});