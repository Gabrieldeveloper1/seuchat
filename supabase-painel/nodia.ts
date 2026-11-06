// GERADO. Edite supabase/functions/nodia/index.ts e execute node scripts/generate-dashboard.mjs
// Utilidades compartilhadas das Edge Functions (Deno).
import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT, jwtVerify } from "npm:jose@5";

export const enc = new TextEncoder();

export const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
export const fail = (status: number, msg: string) =>
  new Response(msg, { status, headers: cors });

export function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64e = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
/** bytea vindo do PostgREST: "\\x0a1b..." */
export const fromPg = (h: string) => {
  const s = h.startsWith("\\x") ? h.slice(2) : h;
  const u = new Uint8Array(s.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return u;
};
/** bytea para inserir via PostgREST */
export const toPg = (u: Uint8Array) => "\\x" + Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");

export const cat = (...p: Uint8Array[]) => {
  const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of p) {
    o.set(x, i);
    i += x.length;
  }
  return o;
};

export const eq = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
};

export async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export const sha256 = async (d: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));

const A = "abcdefghijklmnopqrstuvwxyz234567";
export function base32(u: Uint8Array): string {
  let bits = 0, val = 0, out = "";
  for (const b of u) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += A[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
    val &= (1 << bits) - 1;
  }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}

/** ID público: base32 dos 16 primeiros bytes de SHA-256(chave pública de identidade). */
export async function userIdFromIdKey(idKey: Uint8Array) {
  return base32((await sha256(idKey)).slice(0, 16));
}

// ---- JWT (assinado com o JWT secret do projeto para que a RLS do Postgres o aceite) ----
const jwtKey = () => enc.encode(Deno.env.get("JWT_SECRET")!);

export async function issueJwt(userId: string) {
  return await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(jwtKey());
}

export async function authUser(req: Request): Promise<string | null> {
  const t = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, jwtKey(), { audience: "authenticated" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

// ---- Moderação via Discord (webhook com botões-link assinados) ----
const b64url = (u: Uint8Array) => b64e(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function signDecision(id: string, action: string, exp: number) {
  return b64url(await hmac(b64d(Deno.env.get("DISCORD_LINK_KEY")!), enc.encode(`${id}.${action}.${exp}`)));
}

export interface ReportCard { id: string; category: string; reportedId: string; autoBanned: boolean; status?: string; by?: string }
const CAT: Record<string, string> = { csam: "Abuso infantil (CSAM)", harassment: "Assédio/ameaça", spam: "Spam/golpe", other: "Outro" };

function embed(r: ReportCard) {
  const color = r.status === "actioned" ? 0xdc2626 : r.status === "dismissed" ? 0x64748b : r.category === "csam" ? 0xdc2626 : 0xf59e0b;
  const state = r.status === "reviewing" ? "🔎 Em análise" : r.status === "actioned" ? `✅ Aprovada por ${r.by}` : r.status === "dismissed" ? `❌ Rejeitada por ${r.by}` : "⏳ Aguardando decisão";
  return {
    title: "Nova denúncia", color, timestamp: new Date().toISOString(),
    fields: [
      { name: "Categoria", value: CAT[r.category] ?? r.category, inline: true },
      { name: "Estado", value: state, inline: true },
      { name: "ID denunciado", value: `\`${r.reportedId}\`` },
      { name: "Denúncia", value: `\`${r.id}\`` },
      ...(r.autoBanned ? [{ name: "Ação automática", value: "ID banido preventivamente. Rejeitar desfaz o banimento." }] : []),
    ],
    footer: { text: "O conteúdo não é enviado ao Discord. Abra a central do administrador." },
  };
}

/** Envia a denúncia ao Discord (somente metadados). Devolve o id da mensagem para editar depois. */
export async function discordNotify(r: ReportCard): Promise<string | null> {
  const hook = Deno.env.get("DISCORD_WEBHOOK_URL"), site = Deno.env.get("SITE_URL");
  if (!hook || !site) return null;
  const res = await fetch(`${hook}?wait=true&with_components=true`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "SeuChatSeguro Moderação", embeds: [embed(r)],
      components: [{ type: 1, components: [{ type: 2, style: 5, label: "Abrir central", url: `${site.replace(/\/$/, "")}/#/admin-cases` }] }],
    }),
  });
  return res.ok ? String((await res.json()).id) : null;
}

/** Atualiza a mensagem após a decisão (remove os botões). */
export async function discordResolve(messageId: string, r: ReportCard) {
  const hook = Deno.env.get("DISCORD_WEBHOOK_URL");
  if (!hook) return;
  await fetch(`${hook}/messages/${messageId}?with_components=true`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed(r)], components: [] }),
  }).catch(() => {});
}

/** Apenas metadados da apelação; nunca envia mensagem denunciada ou conteúdo ao Discord. */
export async function discordAppeal(id: string, reportId: string, role: string): Promise<void> {
  const hook=Deno.env.get("DISCORD_WEBHOOK_URL"), site=Deno.env.get("SITE_URL");
  if (!hook || !site) return;
  await fetch(`${hook}?wait=true&with_components=true`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"SeuChatSeguro Moderação",embeds:[{title:"Apelação recebida",description:`Denúncia: ${reportId}\nPapel: ${role === "reported" ? "conta denunciada" : "denunciante"}\nA revisão é feita pelo administrador da conta autorizada.`,color:0x356be5}],components:[{type:1,components:[{type:2,style:5,label:"Abrir central",url:`${site.replace(/\/$/, "")}/#/admin-cases`}]}]})});
}



// Apenas modelos gratuitos são aceitos; antes do primeiro texto, tentamos alternativas.
const DEFAULT_MODELS = "thinkingmachines/inkling:free,nvidia/nemotron-3-super-120b-a12b:free,nvidia/nemotron-3-ultra-550b-a55b:free,dots-studio/dots-3-note-preview:free,thinkingmachines/inkling-small:free,nvidia/nemotron-3.5-lightning:free,xingchen-agi/xing4.0-29b-a4b:free,nvidia/nemotron-3.5-super-vl:free,poolside/laguna-s-2.1:free,cohere/north-mini-code:free,poolside/laguna-xs-2.1:free,recursive/flint-v1.0:free,openrouter/free";
const SYSTEM = `Você é Nodia, assistente de ajuda oficial do SeuChatSeguro. Fale em português brasileiro, com clareza, acolhimento e concisão. Sua prioridade é orientar corretamente sobre o aplicativo real, não parecer saber tudo.

REGRA PRINCIPAL DE CONFIABILIDADE
- Use como fatos somente os recursos e limites explicitamente descritos neste prompt. O histórico da conversa não é documentação e pode conter suposições incorretas.
- Nunca invente telas, botões, menus, configurações, planos, limites, integrações, status de serviço, diagnósticos, prazos ou garantias. Não deduza que uma função existe só porque seria comum em outros aplicativos.
- Se algo não estiver confirmado aqui, diga claramente: “Não consigo confirmar se esse recurso está disponível nesta versão do SeuChatSeguro.” Não dê instruções passo a passo para recurso desconhecido. Se ajudar, pergunte qual tela a pessoa está vendo ou peça que descreva a mensagem de erro, sem solicitar dados secretos.
- Quando o usuário relatar problema, diferencie hipótese de fato; ofereça apenas verificações seguras e genéricas. Você não enxerga a tela, conta, conversas, arquivos, logs ou estado do servidor e não consegue executar correções.
- Não afirme que uma ação foi concluída sem confirmação do usuário. Se a implantação ou configuração do servidor for necessária, diga que isso precisa ser verificado pela equipe responsável.

RECURSOS CONFIRMADOS
- O aplicativo possui conversas individuais e grupos, contatos, chamadas de voz/vídeo e configurações de perfil. Recursos de chamada podem depender de permissões, rede e configuração.
- Em uma mensagem, o menu de ações inclui responder, reagir, encaminhar e apagar. Para encaminhar: abra as ações da mensagem, escolha “Encaminhar”, selecione um ou mais contatos/grupos e confirme em “Encaminhar”. Mensagens temporárias não podem ser encaminhadas. O envio pode falhar parcialmente; confira a conversa de destino antes de repetir.
- No chat, “Anexar” oferece Foto, Vídeo e Arquivo. O limite de envio anunciado para mídia/arquivos é 25 MB, mas a disponibilidade pode depender da configuração de segurança. Escolher um vídeo inicia o envio; não prometa uma etapa separada de pré-visualização/confirmação.
- Vídeos enviados ao armazenamento configurado expiram após dez dias; documentos não têm esse prazo automático. A remoção do armazenamento depende da rotina do servidor, e cópias já baixadas não são apagadas remotamente. Não prometa exclusão garantida em todos os destinos.
- O histórico das conversas fica no aparelho e não é sincronizado pela sincronização de perfil. O perfil pode ser sincronizado entre aparelhos se o servidor estiver configurado; isso não sincroniza mensagens.
- Na conversa com você, a pessoa pode usar “Ouvir” para sintetizar uma resposta em voz ou iniciar “Conversa por voz”. A fala é sintetizada pelo navegador e depende das vozes instaladas; o reconhecimento do microfone depende da compatibilidade/permissão do navegador e pode ser processado pelo provedor dele. Isso não é uma chamada telefônica. A pergunta reconhecida vira texto e é enviada ao serviço de IA. Se o navegador não oferecer reconhecimento, a pessoa ainda pode digitar e, quando compatível, ouvir respostas.
- Você não recebe áudio, imagens ou arquivos como entrada, não transcreve mensagens de voz do chat, não gera mídia e não analisa automaticamente conversas, denúncias ou evidências. O recurso “Perguntar à Nodia” não envia automaticamente a conversa aberta.

PRIVACIDADE E LIMITES
- O texto enviado a você e até 12 mensagens anteriores desta conversa com Nodia são enviados à função do aplicativo, ao OpenRouter e ao provedor de IA selecionado. Essa conversa não usa criptografia ponta a ponta. Outras conversas não são compartilhadas automaticamente.
- Nunca peça senha, frase de recuperação, token, chave de API ou códigos de autenticação. Oriente a pessoa a não compartilhar esses dados.
- O app usa frase de recuperação. Não alegue que consegue recuperar uma conta, acessar dados, ver mensagens ou alterar configurações.
- A operação depende de implantação, rede e configuração do servidor. Não invente uma causa para indisponibilidade; informe que não consegue verificar o serviço ao vivo.

Se não tiver base suficiente, reconheça a incerteza e indique apenas o próximo passo seguro.`;


// Retira deltas de texto de eventos SSE do provedor, sem registrar conteúdo.
async function* upstreamTokens(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new Error("missing stream");
  const reader=response.body.getReader(), decoder=new TextDecoder(); let pending="";let finished=false;
  try {
    while(true){
      const {value,done}=await reader.read();
      pending+=decoder.decode(value ?? new Uint8Array(),{stream:!done});
      if(pending.length>1_000_000) throw new Error("large stream event");
      const lines=pending.split("\n");pending=lines.pop() ?? ""; if(done && pending){lines.push(pending);pending="";}
      for(const raw of lines){
        const line=raw.trim();if(!line.startsWith("data:"))continue;
        const data=line.slice(5).trim();if(data==="[DONE]")return;if(!data)continue;
        let event: any;try {event=JSON.parse(data)} catch {throw new Error("invalid stream event");}
        if(event.error)throw new Error("upstream stream error");
        if(event.choices?.[0]?.finish_reason)finished=true;
        const content=event.choices?.[0]?.delta?.content;
        const part=typeof content==="string"?content:Array.isArray(content)?content.filter((p:any)=>p?.type==="text"&&typeof p.text==="string").map((p:any)=>p.text).join(""):"";
        if(part)yield part;
      }
      if(done){if(finished)return;throw new Error("stream ended early");}
    }
  } finally {try{await reader.cancel()}catch{}reader.releaseLock()}
}
async function streamReply(req:Request, models:string[], key:string, messages:any[]):Promise<Response>{
  const deadline=Date.now()+55_000;
  for(const model of models){
    const remaining=deadline-Date.now();if(remaining<=0)break;
    const ctrl=new AbortController();let timer=setTimeout(()=>ctrl.abort(),Math.min(12_000,remaining));
    const disconnect=()=>ctrl.abort();req.signal?.addEventListener("abort",disconnect,{once:true});
    let iterator:AsyncGenerator<string>|undefined;let handedOff=false;
    try{
      const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{
        method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json","X-Title":"SeuChatSeguro"},
        body:JSON.stringify({model,messages:[{role:"system",content:SYSTEM},...messages.map(m=>({role:m.role,content:m.content}))],max_tokens:800,stream:true}),signal:ctrl.signal,
      });
      if(!response.ok){console.error(`[NODIA] upstream_http_${response.status}`);if(response.status===401||response.status===402)break;continue;}
      iterator=upstreamTokens(response);const first=await iterator.next();
      if(first.done || !first.value){console.error("[NODIA] upstream_empty_reply");continue;}
      clearTimeout(timer);timer=setTimeout(()=>ctrl.abort(),90_000);
      const active=iterator;const encoder=new TextEncoder();let clientGone=false;
      const stream=new ReadableStream({
        async start(output){
          const emit=(e:unknown)=>output.enqueue(encoder.encode(JSON.stringify(e)+"\n"));let count=0;
          try{
            for await(const value of (async function*(){yield first.value;yield* active})()){
              const piece=value.slice(0,6000-count);if(piece){emit({type:"delta",text:piece});count+=piece.length}
              if(count>=6000){emit({type:"delta",text:"\n\n[Resposta truncada.]"});ctrl.abort();break;}
            }
            if(!clientGone){emit({type:"done"});output.close();}
          }catch{console.error("[NODIA] stream_interrupted");if(!clientGone){try{emit({type:"error"});output.close()}catch{}}}
          finally{clearTimeout(timer);req.signal?.removeEventListener("abort",disconnect);try{await active.return(undefined)}catch{}}
        },
        cancel(){clientGone=true;ctrl.abort();clearTimeout(timer);req.signal?.removeEventListener("abort",disconnect);}
      });
      handedOff=true;return new Response(stream,{headers:{...cors,"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-store, no-transform","X-Content-Type-Options":"nosniff"}});
    }catch{console.error("[NODIA] upstream_timeout_or_network");}
    finally{if(!handedOff){clearTimeout(timer);req.signal?.removeEventListener("abort",disconnect);ctrl.abort();try{await iterator?.return(undefined)}catch{}}}
  }
  console.error("[NODIA] all_models_unavailable");return fail(503,"indisponível");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail(405, "method");
  const uid = await authUser(req);
  if (!uid) return fail(401, "unauthorized");
  const db = admin();
  const { data: me, error: meError } = await db.from("identities").select("banned_at").eq("user_id", uid).maybeSingle();
  if (meError) { console.error("[NODIA] identity_lookup_failed"); return fail(503, "indisponível"); }
  if (!me || me.banned_at) return fail(403, "forbidden");
  let raw: string;
  try { raw = await req.text(); } catch { return fail(400, "invalid"); }
  if (raw.length > 24000) return fail(413, "too large");
  let body: { messages?: unknown; stream?: boolean };
  try { body = JSON.parse(raw); } catch { return fail(400, "invalid"); }
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 13 || messages.some((m) => !m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || !m.content.trim() || m.content.length > 3000) || messages.at(-1).role !== "user" || messages.reduce((n, m) => n + m.content.length, 0) > 16000) return fail(400, "invalid");
  const key = Deno.env.get("OPENROUTER_API_KEY");
  const models = (Deno.env.get("OPENROUTER_MODELS") || DEFAULT_MODELS).split(",").map((m) => m.trim()).filter((m) => /^[a-zA-Z0-9._/-]+(?::free)?$/.test(m) && (m.endsWith(":free") || m === "openrouter/free")).slice(0, 20);
  if (!key || !models.length) { console.error("[NODIA] key_missing_or_no_free_models"); return fail(503, "indisponível"); }
  const { data: permitted, error: quotaError } = await db.rpc("take_nodia_quota", { p_user: uid });
  if (quotaError) { console.error("[NODIA] quota_rpc_failed; check migration 009"); return fail(503, "indisponível"); }
  if (!permitted) return fail(429, "limite");
  if (body.stream === true) return await streamReply(req, models, key, messages);
  // Cada modelo é tentado individualmente. Um ID inválido não impede os demais.
  // Apenas códigos e eventos operacionais são registrados; nunca mensagens, chaves ou respostas.
  const deadline = Date.now() + 55000;
  for (const model of models) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(6000, remaining));
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "SeuChatSeguro" },
        body: JSON.stringify({ model, messages: [{ role: "system", content: SYSTEM }, ...messages.map((m) => ({ role: m.role, content: m.content }))], max_tokens: 800 }), signal: controller.signal,
      });
      if (!response.ok) {
        console.error(`[NODIA] upstream_http_${response.status}`);
        // Erros de credencial/crédito exigem intervenção; não adianta tentar outros modelos.
        if (response.status === 401 || response.status === 402) break;
        continue;
      }
      const result = await response.json();
      const content = result?.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((p: { type?: string; text?: unknown }) => p.type === "text" && typeof p.text === "string").map((p: { text: string }) => p.text).join("\n") : "";
      if (text.trim()) return json({ reply: text.slice(0, 6000) });
      console.error("[NODIA] upstream_empty_reply");
    } catch { console.error("[NODIA] upstream_timeout_or_network"); }
    finally { clearTimeout(timer); }
  }
  console.error("[NODIA] all_models_unavailable");
  return fail(503, "indisponível");
});
