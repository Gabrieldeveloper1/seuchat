// Exclusivo para revisão autorizada: leia o bytea hexadecimal da coluna note_ciphertext por stdin.
// Carregue MODERATION_PRIVATE_KEY de forma segura; não cole chave ou textos em chat ou IA.
import nacl from 'tweetnacl';
let raw='';for await (const c of process.stdin) raw+=c;const hex=raw.trim().replace(/^\\x/,'');const secret=process.env.MODERATION_PRIVATE_KEY;
if(!secret || !/^[0-9a-f]+$/i.test(hex) || hex.length<114 || hex.length%2){console.error('Forneça note_ciphertext hexadecimal por stdin e configure a chave privada de moderação.');process.exit(1)}
const data=Uint8Array.from(Buffer.from(hex,'hex'));const msg=nacl.box.open(data.slice(56),data.slice(32,56),data.slice(0,32),Uint8Array.from(Buffer.from(secret,'base64')));
if(!msg){console.error('Não foi possível decifrar a apelação.');process.exit(1)}
process.stdout.write(Buffer.from(msg).toString('utf8')+'\n');
