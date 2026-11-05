import nacl from "npm:tweetnacl@1";
import { admin, b64d, b64e, cat, cors, discordAppeal, enc, eq, fail, fromPg, hmac, json, toPg } from "../_shared/util.ts";
// A prova usa apenas a chave de identidade do aparelho, nunca libera JWT de conversa.
const proofKey = () => enc.encode("scs-case-challenge:" + Deno.env.get("JWT_SECRET"));
const ADMIN_ID = "mjii6xurvff2p33tl6vftzf2vu"; // Identidade pública; autenticação exige assinatura da chave privada.
const uidOk = (s: unknown) => typeof s === "string" && /^[a-z2-7]{26}$/.test(s);
const uuidOk = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/.test(s);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null,{headers:cors});
  if (req.method !== "POST") return fail(405,"method");
  let b: {userId?:string; op?:string; challenge?:string; signature?:string; reportId?:string; reason?:string; note?:string};
  try { const text=await req.text(); if (text.length>4096) return fail(413,"large"); b=JSON.parse(text); } catch {return fail(400,"invalid");}
  if (!uidOk(b.userId)) return fail(400,"invalid");
  const uid=b.userId!, db=admin();
  const {data:me,error:identityError}=await db.from("identities").select("identity_key,banned_at").eq("user_id",uid).maybeSingle();
  if (identityError) return fail(503,"indisponível");
  if (!me) return fail(404,"não encontrado");
  if (b.op === "challenge") {
    const ts=String(Date.now()), nonce=b64e(crypto.getRandomValues(new Uint8Array(16)));
    const mac=b64e(await hmac(proofKey(),enc.encode(`${uid}.${ts}.${nonce}`)));
    return json({challenge:`${ts}.${nonce}.${mac}`});
  }
  if (!["list", "appeal", "admin-list", "admin-evidence", "admin-decision", "admin-appeal", "messages", "send", "admin-presence"].includes(b.op ?? "") || !b.challenge || !b.signature) return fail(400,"invalid");
  if (b.op === "appeal" && (!uuidOk(b.reportId) || !["mistake","context","other"].includes(b.reason ?? "") || typeof b.note !== "string" || b.note.trim().length < 10 || b.note.length > 1500)) return fail(400,"invalid");
  try {
    const [ts,nonce,mac,...rest]=b.challenge.split(".");
    if (!ts || !nonce || !mac || rest.length || !Number.isFinite(Number(ts)) || Math.abs(Date.now()-Number(ts))>120000) return fail(401,"expirado");
    const expected=await hmac(proofKey(),enc.encode(`${uid}.${ts}.${nonce}`));
    const signed=JSON.stringify({op:b.op,reportId:b.reportId ?? null,reason:b.reason ?? null,note:b.note ?? null});
    if (!eq(expected,b64d(mac)) || !nacl.sign.detached.verify(cat(enc.encode("scs-case-v1:"),enc.encode(b.challenge),enc.encode(signed)),b64d(b.signature),fromPg(me.identity_key))) return fail(401,"assinatura inválida");
  } catch {return fail(401,"assinatura inválida");}
  const {data:ok,error:quotaErr}=await db.rpc("take_case_quota",{p_user:uid});
  if (quotaErr) return fail(503,"indisponível"); if (!ok) return fail(429,"limite");
  // Atendimento é visível apenas ao denunciante e ao administrador autenticado.
  // Cifra em repouso: o servidor consegue ler; nunca anunciar como E2EE.
  if (["messages","send","admin-presence"].includes(b.op ?? "")) {
    if (!uuidOk(b.reportId)) return fail(400,"inválido");
    const {data:r,error}=await db.from("reports").select("id,reporter_id,reported_id").eq("id",b.reportId).maybeSingle();
    if(error) return fail(503,"indisponível"); if(!r) return fail(404,"não encontrado");
    const isAdmin=uid===ADMIN_ID && !me.banned_at && uid!==r.reporter_id && uid!==r.reported_id;
    const isReporter=uid===r.reporter_id;
    if(!isAdmin && !isReporter) return fail(403,"não autorizado");
    if(b.op==="admin-presence") {
      if(!isAdmin) return fail(403,"não autorizado");
      const {error:e}=await db.from("case_attendance").upsert({report_id:r.id,active_until:new Date(Date.now()+45000).toISOString()});
      if(e) return fail(503,"indisponível"); return json({ok:true});
    }
    try {
      const secret=Deno.env.get("JWT_SECRET"); if(!secret || secret.length<16) return fail(503,"atendimento não configurado");
      const digest=await crypto.subtle.digest("SHA-256",enc.encode("scs-case-chat-v1:"+secret));
      const key=await crypto.subtle.importKey("raw",digest,"AES-GCM",false,["encrypt","decrypt"]);
      if(b.op==="send") {
        if(typeof b.note!=="string" || !b.note.trim() || b.note.length>1000) return fail(400,"mensagem inválida");
        const nonce=crypto.getRandomValues(new Uint8Array(12));
        const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,additionalData:enc.encode(r.id+":"+uid)},key,enc.encode(b.note.trim())));
        const proof=b64e(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(b.challenge!))));
        const {error:e}=await db.from("case_messages").insert({report_id:r.id,sender_id:uid,sender_role:isAdmin?"admin":"reporter",body_ciphertext:toPg(cat(nonce,cipher)),proof_id:proof});
        if(e) return fail(409,"mensagem duplicada ou indisponível"); return json({ok:true});
      }
      const [m,p]=await Promise.all([db.from("case_messages").select("id,sender_id,sender_role,body_ciphertext,created_at").eq("report_id",r.id).order("created_at",{ascending:false}).limit(100),db.from("case_attendance").select("active_until").eq("report_id",r.id).maybeSingle()]);
      if(m.error || p.error) return fail(503,"indisponível");
      const out=[];
      for(const row of (m.data ?? []).reverse()) { const raw=fromPg(row.body_ciphertext);const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:raw.slice(0,12),additionalData:enc.encode(r.id+":"+row.sender_id)},key,raw.slice(12));out.push({id:row.id,role:row.sender_role,body:new TextDecoder().decode(plain),createdAt:row.created_at}); }
      return json({messages:out,adminActive:!!p.data && Date.parse(p.data.active_until)>Date.now()});
    } catch {return fail(503,"atendimento indisponível");}
  }
  // O ID é público: só possui acesso quem comprovar posse da chave de identidade acima.
  if (b.op?.startsWith("admin-")) {
    if (uid !== ADMIN_ID || me.banned_at) return fail(403,"não autorizado");
    if (b.op === "admin-list") {
      const [reports, appeals]=await Promise.all([
        db.from("reports").select("id,reporter_id,reported_id,category,status,verified,created_at").order("created_at",{ascending:false}).limit(100),
        db.from("report_appeals").select("id,report_id,appellant_role,reason,status,created_at").order("created_at",{ascending:false}).limit(100)
      ]);
      if (reports.error || appeals.error) return fail(503,"indisponível");
      return json({reports:reports.data ?? [],appeals:appeals.data ?? []});
    }
    if (!uuidOk(b.reportId)) return fail(400,"inválido");
    if (b.op === "admin-evidence") {
      const {data:r,error}=await db.from("reports").select("id,evidence,reporter_id,reported_id,verified,status").eq("id",b.reportId).maybeSingle();
      if(error) return fail(503,"indisponível"); if(!r) return fail(404,"não encontrado");
      if(r.reporter_id===uid || r.reported_id===uid) return fail(403,"conflito de interesse");
      const {data:appeals,error:err}=await db.from("report_appeals").select("id,reason,status,note_ciphertext").eq("report_id",r.id);
      if(err) return fail(503,"indisponível");
      return json({evidence:r.evidence,verified:r.verified,appeals:appeals ?? []});
    }
    if (b.op === "admin-decision") {
      if (!["review","approve","reject"].includes(b.reason ?? "")) return fail(400,"inválido");
      const {data:r,error}=await db.from("reports").select("id,reporter_id,reported_id").eq("id",b.reportId).maybeSingle();
      if(error) return fail(503,"indisponível"); if(!r) return fail(404,"não encontrado");
      if(r.reporter_id===uid || r.reported_id===uid) return fail(403,"conflito de interesse");
      const {data:status,error:err}=await db.rpc("review_report",{p_id:r.id,p_action:b.reason,p_actor:uid});
      if(err) return fail(503,"indisponível"); if(!["reviewing","actioned","dismissed"].includes(status)) return fail(409,"decisão indisponível");
      return json({status});
    }
    if (b.op === "admin-appeal") {
      if (!["accept","reject"].includes(b.reason ?? "")) return fail(400,"inválido");
      const {data:a,error}=await db.from("report_appeals").select("id,report_id").eq("id",b.reportId).maybeSingle();
      if(error) return fail(503,"indisponível"); if(!a) return fail(404,"não encontrado");
      const {data:r,error:err}=await db.from("reports").select("reporter_id,reported_id").eq("id",a.report_id).maybeSingle();
      if(err) return fail(503,"indisponível"); if(!r || r.reporter_id===uid || r.reported_id===uid) return fail(403,"conflito de interesse");
      const {data:status,error:e}=await db.rpc("review_appeal",{p_id:a.id,p_action:b.reason,p_actor:uid});
      if(e) return fail(503,"indisponível"); if(!["accepted","rejected"].includes(status)) return fail(409,"apelação indisponível");
      return json({status});
    }
    return fail(400,"inválido");
  }
  if (b.op === "list") {
    const fields="id,reporter_id,reported_id,category,status,created_at";
    const [r1,r2,ap]=await Promise.all([
      db.from("reports").select(fields).eq("reporter_id",uid).order("created_at",{ascending:false}).limit(100),
      db.from("reports").select(fields).eq("reported_id",uid).order("created_at",{ascending:false}).limit(100),
      db.from("report_appeals").select("id,report_id,status,created_at").eq("appellant_id",uid).order("created_at",{ascending:false}).limit(100),
    ]);
    if (r1.error || r2.error || ap.error) return fail(503,"indisponível");
    const appeals=ap.data ?? [];
    const reports=[...(r1.data ?? []).map((r:Record<string,unknown>)=>({...r,role:"reporter"})),...(r2.data ?? []).filter((r:Record<string,unknown>)=>r.status === "actioned" || appeals.some((a:{report_id:string})=>a.report_id===r.id)).map((r:Record<string,unknown>)=>({...r,role:"reported"}))];
    return json({cases:reports.map((r:Record<string,unknown>)=>({id:r.id,role:r.role,category:r.category,status:r.status,createdAt:r.created_at,appeal:appeals.find((a:{report_id:string})=>a.report_id===r.id) ?? null}))});
  }
  const {data:report,error}=await db.from("reports").select("id,reporter_id,reported_id,status").eq("id",b.reportId).maybeSingle();
  if (error) return fail(503,"indisponível");
  if (!report) return fail(404,"não encontrado");
  const role=report.reporter_id===uid && report.status === "dismissed" ? "reporter" : report.reported_id===uid && report.status === "actioned" ? "reported" : null;
  if (!role) return fail(403,"indisponível");
  if (role === "reported") { const {data:ban,error:banError}=await db.from("bans").select("id").eq("report_id",report.id).eq("user_id",uid).limit(1); if (banError) return fail(503,"indisponível"); if (!ban?.length) return fail(403,"indisponível"); }
  const modPub=Deno.env.get("MODERATION_PUBKEY");
  if (!modPub) return fail(503,"Moderação não configurada");
  let noteCiphertext: string;
  try { const pub=b64d(modPub); if (pub.length !== 32) return fail(503,"Moderação não configurada"); const eph=nacl.box.keyPair(), nonce=crypto.getRandomValues(new Uint8Array(24)); noteCiphertext=toPg(cat(eph.publicKey,nonce,nacl.box(enc.encode(b.note!.trim()),nonce,pub,eph.secretKey))); } catch { return fail(503,"Falha ao proteger apelação"); }
  const {data:appeal,error:appealError}=await db.from("report_appeals").insert({report_id:report.id,appellant_id:uid,appellant_role:role,reason:b.reason,note_ciphertext:noteCiphertext}).select("id,status,created_at").single();
  if (appealError || !appeal) return fail(409,"Apelação já registrada ou indisponível");
  try { await discordAppeal(appeal.id,report.id,role); } catch { /* a apelação continua na fila do banco */ }
  return json({appeal});
});
