// Gera cópias autocontidas para o editor de Edge Functions do Supabase.
import {readFile,writeFile,readdir,copyFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),shared=await readFile(new URL('supabase/functions/_shared/util.ts',root),'utf8');
for(const name of await readdir(new URL('supabase/functions/',root))){if(name==='_shared')continue;let src=await readFile(new URL(`supabase/functions/${name}/index.ts`,root),'utf8');let parts=[shared];for(const helper of ['appNumber','rss'])if(src.includes(`../_shared/${helper}.ts`))parts.push(await readFile(new URL(`supabase/functions/_shared/${helper}.ts`,root),'utf8'));src=src.replace(/^import .* from "\.\.\/_shared\/.*";\s*$/gm,'');await writeFile(new URL(`supabase-painel/${name}.ts`,root),`// GERADO. Edite supabase/functions/${name}/index.ts e execute node scripts/generate-dashboard.mjs\n`+parts.join('\n\n')+'\n\n'+src);}
for(const name of await readdir(new URL('supabase/migrations/',root)))if(/^(006|007|008|009|010|011|012)_/.test(name))await copyFile(new URL(`supabase/migrations/${name}`,root),new URL(`supabase-painel/SQL-${name}`,root));
console.log('Funções e migrações do painel geradas.');
