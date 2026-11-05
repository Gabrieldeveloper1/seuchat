// Simula o servidor ao executar a Edge Function real; não substitui teste no Supabase.
import assert from 'node:assert/strict'; import fs from 'node:fs'; import vm from 'node:vm'; import ts from 'typescript';
const src=fs.readFileSync(new URL('../supabase/functions/nodia/index.ts',import.meta.url),'utf8');
const code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let handler, banned=false, permit=true, upstreamStatus=200, posted, apiKey='dummy-server-secret', models='';
const db={from(){return {select(){return this},eq(){return this},async maybeSingle(){return {data:{banned_at:banned?'yes':null},error:null}}}}, async rpc(){return {data:permit,error:null}}};
const shared={admin:()=>db,authUser:async r=>r.headers.get('x-user'),cors:{},json:(v,status=200)=>new Response(JSON.stringify(v),{status}),fail:(status,msg)=>new Response(msg,{status})};
const context={require:()=>shared,exports:{},Deno:{serve(fn){handler=fn},env:{get(k){return k==='OPENROUTER_API_KEY'?apiKey:k==='OPENROUTER_MODELS'?models:undefined}}},Response,Date,Number,JSON,RegExp,Set,Array,AbortController,setTimeout,clearTimeout,console,fetch:async (url,opts)=>{posted=JSON.parse(opts.body);return new Response(JSON.stringify({choices:[{message:{content:'Ajuda de teste'}}]}),{status:upstreamStatus})}};
vm.runInNewContext(code,context);
async function request(user,messages){return handler(new Request('https://example.test',{method:'POST',headers:{'x-user':user},body:JSON.stringify({messages})}))}
const good=[{role:'user',content:'Oi'}];
assert.equal((await request('',good)).status,401); banned=true; assert.equal((await request('user',good)).status,403);banned=false;
assert.equal((await request('user',[{role:'system',content:'x'}])).status,400);
assert.equal((await request('user',[{role:'user',content:'x'.repeat(3001)}])).status,400);
permit=false;assert.equal((await request('user',good)).status,429);permit=true;
const ok=await request('user',good);assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{reply:'Ajuda de teste'}); assert.equal(posted.models.length,13); assert.equal(posted.models.at(-1),'openrouter/free'); assert.equal(posted.messages[0].role,'system'); assert.equal(JSON.stringify(posted).includes(apiKey),false);
models='paid/model,good/name:free,openrouter/free';await request('user',good);assert.deepEqual([...posted.models],['good/name:free','openrouter/free']);
upstreamStatus=503;let res=await request('user',good);assert.equal(res.status,503);assert.equal((await res.text()).includes(apiKey),false);apiKey='';assert.equal((await request('user',good)).status,503);
console.log('Nodia: autenticação, banimento, limites, conteúdo e resposta verificados em simulação.');
