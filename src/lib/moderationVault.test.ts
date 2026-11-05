import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {hasModerationVault,saveModerationVault,openModerationVault,removeModerationVault,rewrapModerationVault,restoreModerationVault} from './moderationVault';
describe('cofre de moderação',()=>{
 const values=new Map<string,string>();
 beforeEach(()=>{values.clear();vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)});});
 afterEach(()=>vi.unstubAllGlobals());
 it('cifra a chave localmente e exige a senha correta',async()=>{
   const key='fake-private-key-for-testing-only';const pass='uma-senha-de-teste-segura';
   await saveModerationVault(key,pass);expect(hasModerationVault()).toBe(true);expect([...values.values()].join('')).not.toContain(key);expect([...values.values()].join('')).not.toContain(pass);
   await expect(openModerationVault('senha-incorreta')).rejects.toThrow();expect(await openModerationVault(pass)).toBe(key);
   removeModerationVault();expect(hasModerationVault()).toBe(false);
 });
 it('reprotege o cofre ao trocar a senha e permite restaurar a cópia',async()=>{
   await saveModerationVault('test-key','senha-anterior');const previous=await rewrapModerationVault('senha-anterior','senha-nova');await expect(openModerationVault('senha-anterior')).rejects.toThrow();expect(await openModerationVault('senha-nova')).toBe('test-key');restoreModerationVault(previous);expect(await openModerationVault('senha-anterior')).toBe('test-key');
 });
 it('rejeita senha vazia',async()=>{await expect(saveModerationVault('test','')).rejects.toThrow()});
});
