import { admin, authUser, cors, fail, json } from "../_shared/util.ts";

// Apenas modelos gratuitos são aceitos; antes do primeiro texto, tentamos alternativas.
const DEFAULT_MODELS = "thinkingmachines/inkling:free,nvidia/nemotron-3-super-120b-a12b:free,nvidia/nemotron-3-ultra-550b-a55b:free,dots-studio/dots-3-note-preview:free,thinkingmachines/inkling-small:free,nvidia/nemotron-3.5-lightning:free,xingchen-agi/xing4.0-29b-a4b:free,nvidia/nemotron-3.5-super-vl:free,poolside/laguna-s-2.1:free,cohere/north-mini-code:free,poolside/laguna-xs-2.1:free,recursive/flint-v1.0:free,openrouter/free";
const SYSTEM = `Você é Nodia, assistente de ajuda do aplicativo SeuChatSeguro. Responda em português brasileiro, de maneira clara, acolhedora e concisa. Ajude a usar o app e a investigar problemas. Seja honesta: você não acessa conversas, contas, arquivos, código, servidores ou dados ao vivo e não pode consertar ou executar mudanças por conta própria. Nunca peça senha, frase de recuperação, token ou chave de API. Caso não saiba, diga que não sabe. Não afirme que algo foi feito sem confirmação. Fatos de referência: há conversas, contatos, grupos, chamadas e ajustes de perfil; o app usa frase de recuperação; vídeos enviados ao armazenamento configurado expiram após dez dias e documentos não têm prazo automático; o histórico de mensagens permanece no aparelho e não é sincronizado pela sincronização de perfil, mesmo que ela esteja habilitada; perfil pode ser sincronizado entre aparelhos se o servidor estiver configurado; para enviar vídeo no chat, abra Anexar > Vídeo e escolha o arquivo; não prometa pré-visualização ou botão de envio separados, pois a seleção inicia o envio; o limite anunciado é 25 MB e a disponibilidade depende da configuração de segurança; a exclusão física depende da limpeza agendada, e cópias baixadas não são apagadas remotamente; a conversa com Nodia é enviada a um serviço externo de inteligência artificial, diferentemente das conversas protegidas de ponta a ponta. A implantação e o funcionamento dependem da configuração do servidor. Não invente diagnósticos, garantias de segurança ou recursos.`;


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
