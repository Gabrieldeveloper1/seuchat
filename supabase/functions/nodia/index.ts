import { admin, authUser, cors, fail, json } from "../_shared/util.ts";

// A ordem configurada é entregue ao roteador; somente modelos gratuitos são aceitos.
const DEFAULT_MODELS = "thinkingmachines/inkling:free,nvidia/nemotron-3-super-120b-a12b:free,nvidia/nemotron-3-ultra-550b-a55b:free,dots-studio/dots-3-note-preview:free,thinkingmachines/inkling-small:free,nvidia/nemotron-3.5-lightning:free,xingchen-agi/xing4.0-29b-a4b:free,nvidia/nemotron-3.5-super-vl:free,poolside/laguna-s-2.1:free,cohere/north-mini-code:free,poolside/laguna-xs-2.1:free,recursive/flint-v1.0:free,openrouter/free";
const SYSTEM = `Você é Nodia, assistente de ajuda do aplicativo SeuChatSeguro. Responda em português brasileiro, de maneira clara, acolhedora e concisa. Ajude a usar o app e a investigar problemas. Seja honesta: você não acessa conversas, contas, arquivos, código, servidores ou dados ao vivo e não pode consertar ou executar mudanças por conta própria. Nunca peça senha, frase de recuperação, token ou chave de API. Caso não saiba, diga que não sabe. Não afirme que algo foi feito sem confirmação. Fatos de referência: há conversas, contatos, grupos, chamadas e ajustes de perfil; o app usa frase de recuperação; vídeos enviados ao armazenamento configurado expiram após dez dias e documentos não têm prazo automático; o histórico local não é sincronizado pelo recurso de perfil; perfil pode ser sincronizado entre aparelhos se o servidor estiver configurado; a conversa com Nodia é enviada ao OpenRouter e ao provedor do modelo, diferentemente das conversas protegidas de ponta a ponta. A implantação e o funcionamento dependem da configuração do servidor. Não invente diagnósticos, garantias de segurança ou recursos.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid) return fail(401, "unauthorized");
  const db = admin();
  const { data: me, error: meError } = await db.from("identities").select("banned_at").eq("user_id", uid).maybeSingle();
  if (meError) return fail(503, "indisponível");
  if (!me || me.banned_at) return fail(403, "forbidden");
  let raw: string;
  try { raw = await req.text(); } catch { return fail(400, "invalid"); }
  if (raw.length > 24000) return fail(413, "too large");
  let body: { messages?: unknown };
  try { body = JSON.parse(raw); } catch { return fail(400, "invalid"); }
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 13 || messages.some((m) => !m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || !m.content.trim() || m.content.length > 3000) || messages.at(-1).role !== "user" || messages.reduce((n, m) => n + m.content.length, 0) > 16000) return fail(400, "invalid");
  const key = Deno.env.get("OPENROUTER_API_KEY");
  const models = (Deno.env.get("OPENROUTER_MODELS") || DEFAULT_MODELS).split(",").map((m) => m.trim()).filter((m) => /^[a-zA-Z0-9._/-]+(?::free)?$/.test(m) && (m.endsWith(":free") || m === "openrouter/free")).slice(0, 20);
  if (!key || !models.length) return fail(503, "indisponível");
  const { data: permitted, error: quotaError } = await db.rpc("take_nodia_quota", { p_user: uid });
  if (quotaError) return fail(503, "indisponível");
  if (!permitted) return fail(429, "limite");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "SeuChatSeguro" },
      body: JSON.stringify({ models, messages: [{ role: "system", content: SYSTEM }, ...messages.map((m) => ({ role: m.role, content: m.content }))], max_tokens: 800 }), signal: controller.signal,
    });
    if (!response.ok) return fail(503, "indisponível");
    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((p: { type?: string; text?: unknown }) => p.type === "text" && typeof p.text === "string").map((p: { text: string }) => p.text).join("\n") : "";
    if (!text.trim()) return fail(503, "indisponível");
    return json({ reply: text.slice(0, 6000) });
  } catch { return fail(503, "indisponível"); }
  finally { clearTimeout(timer); }
});
