import { admin, authUser, cors, fail, json } from "../_shared/util.ts";
const ADMIN_ID = "mjii6xurvff2p33tl6vftzf2vu";
Deno.serve(async (req:Request) => {
 if(req.method === "OPTIONS") return new Response(null,{headers:cors});
 if(req.method !== "POST") return fail(405,"method");
 const uid=await authUser(req); if(!uid) return fail(401,"unauthorized");
 const db=admin();const {data:identity,error:identityError}=await db.from("identities").select("banned_at").eq("user_id",uid).maybeSingle();
 if(identityError)return fail(503,"indisponível");if(!identity||identity.banned_at)return fail(403,"forbidden");
 let input:any;try{const text=await req.text();if(text.length>4096)return fail(413,"large");input=JSON.parse(text)}catch{return fail(400,"invalid")}
 if(input?.op === "list"){
  const {data,error}=await db.from("global_announcements").select("id,title,body,created_at,expires_at").is("revoked_at",null).gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(20);
  if(error)return fail(503,"indisponível");return json({announcements:data??[]});
 }
 if(uid!==ADMIN_ID)return fail(403,"forbidden");
 if(input?.op === "publish"){
  const title=typeof input.title==="string"?input.title.trim():"",body=typeof input.body==="string"?input.body.trim():"";
  if(!title||title.length>80||!body||body.length>500||![1,24,168].includes(input.hours))return fail(400,"invalid");
  const {data:allowed,error:quotaError}=await db.rpc("take_announcement_quota",{p_user:uid});if(quotaError)return fail(503,"indisponível");if(!allowed)return fail(429,"limite");
  const {data,error}=await db.from("global_announcements").insert({title,body,author_id:uid,expires_at:new Date(Date.now()+input.hours*3600000).toISOString()}).select("id,title,body,created_at,expires_at").single();
  if(error)return fail(503,"indisponível");return json({announcement:data});
 }
 if(input?.op === "revoke"){
  if(typeof input.id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id))return fail(400,"invalid");
  const {error}=await db.from("global_announcements").update({revoked_at:new Date().toISOString()}).eq("id",input.id).is("revoked_at",null);if(error)return fail(503,"indisponível");return json({ok:true});
 }
 return fail(400,"invalid");
});
