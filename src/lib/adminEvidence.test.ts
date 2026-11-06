import {describe,it,expect} from 'vitest';
import sodium from 'libsodium-wrappers-sumo';
import {decryptAdminEvidence} from './adminEvidence';

describe('evidências para a conta administradora',()=>{
  it('abre com a prekey privada da conta e rejeita outra conta ou conteúdo alterado',async()=>{
    await sodium.ready;
    const admin=sodium.crypto_box_keypair(), other=sodium.crypto_box_keypair(), ephemeral=sodium.crypto_box_keypair();
    const nonce=sodium.randombytes_buf(24), text=new TextEncoder().encode('prova fictícia');
    const cipher=sodium.crypto_box_easy(text,nonce,admin.publicKey,ephemeral.privateKey);
    const combined=new Uint8Array(56+cipher.length);combined.set(ephemeral.publicKey);combined.set(nonce,32);combined.set(cipher,56);
    const hex='\\x'+Array.from(combined,x=>x.toString(16).padStart(2,'0')).join('');
    expect(await decryptAdminEvidence(hex,admin.privateKey)).toBe('prova fictícia');
    await expect(decryptAdminEvidence(hex,other.privateKey)).rejects.toThrow();
    combined[combined.length-1]^=1;
    const corrupted='\\x'+Array.from(combined,x=>x.toString(16).padStart(2,'0')).join('');
    await expect(decryptAdminEvidence(corrupted,admin.privateKey)).rejects.toThrow();
  });
});
