import { describe, expect, it } from "vitest";
import { keysFromMnemonic, newMnemonic } from "./crypto";
import { decryptProfile, encryptProfile, profileFingerprint } from "./profileSync";

describe("sincronização cifrada do perfil", () => {
  it("restaura nome, foto e banner com a mesma frase, sem mandar metadados locais", async () => {
    const phrase = newMnemonic(), a = await keysFromMnemonic(phrase), b = await keysFromMnemonic(phrase);
    const input = { name: "Ana", avatar: "data:image/jpeg;base64,YWJj", banner: "data:image/jpeg;base64,ZGVm", appNumber: "12345-6789" };
    const sealed = await encryptProfile(a, input);
    expect(sealed.ciphertext).not.toContain("Ana");
    expect(await decryptProfile(b, sealed)).toEqual({ name: input.name, avatar: input.avatar, banner: input.banner });
    expect(profileFingerprint(input)).not.toContain("12345");
    expect((await encryptProfile(a, input)).nonce).not.toBe(sealed.nonce);
  });
  it("não abre com outra identidade e rejeita conteúdo adulterado", async () => {
    const a = await keysFromMnemonic(newMnemonic()), b = await keysFromMnemonic(newMnemonic());
    const sealed = await encryptProfile(a, { name: "Ana" });
    await expect(decryptProfile(b, sealed)).rejects.toThrow();
    const pos = Math.floor(sealed.ciphertext.length / 2);
    const altered = sealed.ciphertext.slice(0, pos) + (sealed.ciphertext[pos] === "A" ? "B" : "A") + sealed.ciphertext.slice(pos + 1);
    await expect(decryptProfile(a, { ...sealed, ciphertext: altered })).rejects.toThrow();
  });
});
