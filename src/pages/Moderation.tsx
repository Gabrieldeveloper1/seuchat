import { useState } from "react";
import { SUPABASE_ANON, SUPABASE_URL } from "../lib/api";
import PasswordInput from "../components/PasswordInput";
import { IconShield } from "../icons";

/** Links assinados do canal privado de moderação; nunca substituem a revisão da evidência. */
export default function Moderation() {
  const q=new URLSearchParams(location.hash.split("?")[1]??"");
  const appeal=location.hash.startsWith("#/appeal-mod"), action=q.get("a");
  const titles:Record<string,string>={approve:"Confirmar violação e banir",reject:appeal?"Rejeitar apelação":"Rejeitar denúncia",review:"Marcar em análise",accept:"Aceitar apelação"};
  const [key,setKey]=useState(""); const [busy,setBusy]=useState(false); const [res,setRes]=useState<{ok:boolean;text:string}|null>(null);
  async function go(){setBusy(true);try{const r=await fetch(`${SUPABASE_URL}/functions/v1/${appeal?'appeal-decision':'report-decision'}`,{method:"POST",headers:{"Content-Type":"application/json",apikey:SUPABASE_ANON,Authorization:`Bearer ${SUPABASE_ANON}`},body:JSON.stringify({r:q.get("r"),a:action,e:q.get("e"),s:q.get("s"),key})});const t=await r.text();setRes(r.ok?{ok:true,text:"Decisão registrada. Você pode fechar esta aba."}:{ok:false,text:t});}catch{setRes({ok:false,text:"Sem conexão com o servidor"})}finally{setBusy(false);setKey("")}}
  return <div className="center"><div className="card"><div className="brand"><IconShield /> Moderação</div><h2>{titles[action??""]??"Ação inválida"}</h2><p className="muted small" style={{margin:0}}>{appeal?"Leia a apelação e a evidência em ambiente autorizado antes de decidir. O administrador deverá revisar a decisão.":action==='review'?"O caso será marcado como em análise. Nenhum banimento será aplicado.":action==='approve'?"Confirme somente após revisar a evidência e verificar abuso ou exploração sexual de crianças ou adolescentes. A prova criptográfica não classifica o conteúdo.":"A denúncia será concluída sem banimento por este caso."}</p><p className="mono muted" style={{margin:0}}>{q.get("r")}</p>{!res?.ok&&<PasswordInput value={key} onChange={setKey} autoComplete="off" placeholder="Chave de administrador" autoFocus />}{res&&<div className={res.ok?"ok":"error"} role="status">{res.text}</div>}{!res?.ok&&<button className="btn primary block" disabled={busy||!key||!titles[action??""]} onClick={()=>void go()}>{busy?"Enviando…":"Confirmar decisão"}</button>}</div></div>;
}
