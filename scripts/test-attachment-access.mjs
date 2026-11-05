// Exercita a Edge Function real com banco/Storage simulados; não substitui teste no Supabase.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const src=fs.readFileSync(new URL('../supabase/functions/attachments/index.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let handler, aclError=false, expired=false, signed=0;
const id='11111111-1111-4111-8111-111111111111', owner='owner', recipient='recipient';
const db={from(table){const terms={}; return {select(){return this},eq(k,v){terms[k]=v;return this},async maybeSingle(){
  if(table==='identities') return {data:{banned_at:null},error:null};
  if(table==='attachments') return {data:{id,owner_id:owner,expires_at:expired?'2020-01-01T00:00:00Z':null},error:null};
  if(table==='attachment_recipients') return {data:terms.user_id===recipient?{user_id:recipient}:null,error:aclError?{}:null};
  throw Error('unexpected table');
}}}, storage:{from(){return {async createSignedUrl(){signed++; return {data:{signedUrl:'https://storage.example/signed'},error:null}}}}}};
const shared={admin:()=>db,authUser:async r=>r.headers.get('x-user'),cors:{},json:(v,status=200)=>new Response(JSON.stringify(v),{status}),fail:(status,msg)=>new Response(msg,{status})};
const context={require:()=>shared,exports:{},Deno:{serve(fn){handler=fn}},Response,Date,Number,JSON,RegExp,Set,console};
vm.runInNewContext(compiled,context);
async function access(user){return handler(new Request('https://example.test',{method:'POST',headers:{'x-user':user,'content-type':'application/json'},body:JSON.stringify({op:'download',id})}))}
assert.equal((await access('')).status,401);
assert.equal((await access(owner)).status,200);
assert.equal((await access(recipient)).status,200);
assert.equal((await access('outsider')).status,404);
aclError=true;assert.equal((await access('outsider')).status,503);aclError=false;
expired=true;assert.equal((await access(recipient)).status,404);
assert.equal(signed,2,'nenhuma URL assinada deve ser emitida para quem não tem permissão');
console.log('Permissões de download: 6 cenários simulados passaram.');
