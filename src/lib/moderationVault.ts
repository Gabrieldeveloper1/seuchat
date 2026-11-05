import {toB64,fromB64,enc,dec} from './util';
const SLOT='scs:moderation-vault:v1';
const ITERATIONS=310000;
type Vault={v:1;salt:string;iv:string;cipher:string};
async function keyFor(password:string,salt:Uint8Array){
 const base=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt:new Uint8Array(salt),iterations:ITERATIONS,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export function hasModerationVault(){return localStorage.getItem(SLOT)!==null}
export function removeModerationVault(){localStorage.removeItem(SLOT)}
export async function saveModerationVault(secret:string,password:string){
 if(!password)throw Error('Senha obrigatória.');
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await keyFor(password,salt);const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(secret));
 const value:Vault={v:1,salt:toB64(salt),iv:toB64(iv),cipher:toB64(new Uint8Array(encrypted))};localStorage.setItem(SLOT,JSON.stringify(value));
}
export async function openModerationVault(password:string){
 const raw=localStorage.getItem(SLOT);if(!raw)throw Error('Cofre local não encontrado');
 const value=JSON.parse(raw) as Vault;if(value.v!==1)throw Error('Cofre inválido');
 const salt=fromB64(value.salt),iv=fromB64(value.iv),cipher=fromB64(value.cipher);if(salt.length!==16||iv.length!==12||cipher.length>1024)throw Error('Cofre inválido');
 const key=await keyFor(password,salt);return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(iv)},key,new Uint8Array(cipher)));
}

/** Retorna cópia anterior para restauração se a troca da senha da conta falhar. */
export async function rewrapModerationVault(oldPassword:string,newPassword:string):Promise<string|null>{
 const previous=localStorage.getItem(SLOT);if(previous===null)return null;
 const secret=await openModerationVault(oldPassword);await saveModerationVault(secret,newPassword);return previous;
}
export function restoreModerationVault(previous:string|null){if(previous!==null)localStorage.setItem(SLOT,previous)}
