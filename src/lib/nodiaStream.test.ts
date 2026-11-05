import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const enc=new TextEncoder();
describe('Nodia stream',()=>{
 beforeEach(()=>{vi.resetModules();vi.stubEnv('VITE_SUPABASE_URL','https://example.test');vi.stubEnv('VITE_SUPABASE_ANON_KEY','public-test');vi.stubGlobal('window',globalThis)});
 afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});
 it('mostra trechos antes do encerramento e conclui corretamente',async()=>{
  let finish!:()=>void;const body=new ReadableStream<Uint8Array>({start(c){const first=enc.encode('{"type":"delta","text":"Olá 🌟"}\n');c.enqueue(first.slice(0,first.length-4));c.enqueue(first.slice(first.length-4));finish=()=>{c.enqueue(enc.encode('{"type":"delta","text":" mundo"}\n{"type":"done"}\n'));c.close()}}});
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(body,{headers:{'Content-Type':'application/x-ndjson'}})));
  const {askNodia}=await import('./api');const parts:string[]=[];const result=askNodia('test',[{role:'user',content:'Oi'}],p=>parts.push(p));
  await vi.waitFor(()=>expect(parts).toEqual(['Olá 🌟']));finish();expect(await result).toBe('Olá 🌟 mundo');
 });
 it('indica interrupção depois do conteúdo parcial',async()=>{
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(enc.encode('{"type":"delta","text":"Parcial"}\n{"type":"error"}\n'));c.close()}});vi.stubGlobal('fetch',vi.fn(async()=>new Response(body,{headers:{'Content-Type':'application/x-ndjson'}})));
  const {askNodia}=await import('./api');const parts:string[]=[];await expect(askNodia('test',[{role:'user',content:'Oi'}],p=>parts.push(p))).rejects.toThrow();expect(parts).toEqual(['Parcial']);
 });
 it('aceita resposta completa da versão anterior do servidor',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({reply:'Resposta anterior'}),{headers:{'Content-Type':'application/json'}})));
  const {askNodia}=await import('./api');const parts:string[]=[];expect(await askNodia('test',[{role:'user',content:'Oi'}],p=>parts.push(p))).toBe('Resposta anterior');expect(parts).toEqual(['Resposta anterior']);
 });
});
