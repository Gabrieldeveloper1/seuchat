import { describe, expect, it } from "vitest";
import { EMOJI_GROUPS } from "./emojiData";
import sprites from "./emojiSprites.json";

describe("ícones locais de emoji", () => {
  it("tem um ícone para os emojis mais usados e para todas as categorias", () => {
    const map = sprites as Record<string, (string | number)[]>;
    expect(map["😀"]).toBeDefined();
    for (const group of EMOJI_GROUPS) {
      const supported = group.e.split("\u0001").filter(ch => map[ch]);
      expect(supported.length).toBeGreaterThan(10);
      for (const ch of supported) {
        expect(map[ch]).toHaveLength(3);
        expect(typeof map[ch][0]).toBe("string");
      }
    }
  });
});
