import { describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers-sumo";
import { keysFromMnemonic, newMnemonic, isValidMnemonic } from "./crypto";
import { computeTag, frankMessage, verifyIncoming } from "./franking";
import { hamming, pdqFromGray } from "./imageFilter";
import { ID_RE, base32 } from "./util";

describe("identidade", () => {
  it("deriva as mesmas chaves da mesma frase e gera ID válido", async () => {
    const m = newMnemonic();
    expect(isValidMnemonic(m)).toBe(true);
    const a = await keysFromMnemonic(m);
    const b = await keysFromMnemonic(m);
    expect(a.userId).toBe(b.userId);
    expect(a.userId).toMatch(ID_RE);
  });
  it("base32 de 16 bytes tem 26 caracteres", () => {
    expect(base32(new Uint8Array(16).fill(255))).toHaveLength(26);
  });
});

describe("franking", () => {
  it("verifica tag e assinatura; rejeita texto adulterado", async () => {
    await sodium.ready;
    const alice = await keysFromMnemonic(newMnemonic());
    const bob = await keysFromMnemonic(newMnemonic());
    const payload = JSON.stringify({ t: "msg", id: "1", kind: "text", text: "oi" });
    const f = await frankMessage(payload, bob.userId, alice.idSec);
    expect(await verifyIncoming(payload, f.frankKey, f.tag, f.senderSig, bob.userId, alice.idPub)).toBe(true);
    expect(await verifyIncoming(payload + " ", f.frankKey, f.tag, f.senderSig, bob.userId, alice.idPub)).toBe(false);
    expect(await verifyIncoming(payload, f.frankKey, f.tag, f.senderSig, alice.userId, alice.idPub)).toBe(false);
    expect((await computeTag(f.frankKey, payload)).length).toBe(32);
  });
  it("caixa selada: só o destinatário abre", async () => {
    await sodium.ready;
    const bob = await keysFromMnemonic(newMnemonic());
    const eve = await keysFromMnemonic(newMnemonic());
    const ct = sodium.crypto_box_seal(new TextEncoder().encode("segredo"), bob.spkPub);
    expect(new TextDecoder().decode(sodium.crypto_box_seal_open(ct, bob.spkPub, bob.spkSec))).toBe("segredo");
    expect(() => sodium.crypto_box_seal_open(ct, eve.spkPub, eve.spkSec)).toThrow();
  });
});

describe("hash perceptual", () => {
  const img = (f: (x: number, y: number) => number) => {
    const g = new Float32Array(64 * 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) g[x * 64 + y] = f(x, y);
    return g;
  };
  it("imagem igual => distância 0; pequeno ruído => perto; imagem diferente => longe", () => {
    const base = img((x, y) => 128 + 100 * Math.sin(x / 7) * Math.cos(y / 5));
    const noisy = img((x, y) => 128 + 100 * Math.sin(x / 7) * Math.cos(y / 5) + ((x * 31 + y * 17) % 4));
    const other = img((x, y) => (x > 32 ? 220 : 30) + ((y * 3) % 9));
    const h = pdqFromGray(base);
    expect(hamming(h, pdqFromGray(base))).toBe(0);
    expect(hamming(h, pdqFromGray(noisy))).toBeLessThan(31);
    expect(hamming(h, pdqFromGray(other))).toBeGreaterThan(31);
  });
});
