import { admin, authUser, b64d, cors, enc, fail, hmac, json, toPg } from "../_shared/util.ts";

// Vincula um telefone à conta. Com TWILIO_* configurado: envia SMS e confere o código (verificado).
// Sem Twilio: só funciona se ALLOW_UNVERIFIED_PHONES=true (apenas para testes; qualquer um poderia
// reivindicar o número de outra pessoa).
const E164 = /^\+[1-9]\d{7,14}$/;
const twilio = () => {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID"), tok = Deno.env.get("TWILIO_AUTH_TOKEN"), svc = Deno.env.get("TWILIO_VERIFY_SID");
  return sid && tok && svc ? { sid, tok, svc } : null;
};
const tw = (t: { sid: string; tok: string; svc: string }, path: string, form: Record<string, string>) =>
  fetch(`https://verify.twilio.com/v2/Services/${t.svc}/${path}`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${t.sid}:${t.tok}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid) return fail(401, "unauthorized");
  let b: { phone?: string; code?: string };
  try { b = await req.json(); } catch { return fail(400, "json"); }
  if (!b.phone || !E164.test(b.phone)) return fail(400, "telefone inválido");

  const pepper = Deno.env.get("PHONE_PEPPER");
  if (!pepper) return fail(500, "PHONE_PEPPER não configurado");
  const hash = await hmac(b64d(pepper), enc.encode(b.phone));
  const db = admin();

  const { data: owner } = await db.from("phone_directory").select("user_id,verified").eq("phone_hash", toPg(hash)).maybeSingle();
  if (owner && owner.user_id !== uid && owner.verified) return fail(409, "número já vinculado a outra conta");

  const t = twilio();
  let verified = false;
  if (t) {
    if (!b.code) {
      const r = await tw(t, "Verifications", { To: b.phone, Channel: "sms" });
      return r.ok ? json({ step: "code" }) : fail(502, "falha ao enviar SMS");
    }
    const r = await tw(t, "VerificationCheck", { To: b.phone, Code: b.code });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.status !== "approved") return fail(400, "código incorreto");
    verified = true;
  } else if (Deno.env.get("ALLOW_UNVERIFIED_PHONES") !== "true") {
    return fail(501, "verificação por SMS não configurada");
  }

  await db.from("phone_directory").delete().eq("user_id", uid);
  if (owner && owner.user_id !== uid) await db.from("phone_directory").delete().eq("phone_hash", toPg(hash));
  const { error } = await db.from("phone_directory").insert({ phone_hash: toPg(hash), user_id: uid, verified });
  if (error) return fail(500, error.message);
  return json({ step: "done", verified });
});
