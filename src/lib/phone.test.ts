import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "./phone";

describe("telefone", () => {
  it("normaliza números brasileiros e internacionais", () => {
    expect(normalizePhone("(21) 99999-0000")).toBe("+5521999990000");
    expect(normalizePhone("021 99999-0000")).toBe("+5521999990000");
    expect(normalizePhone("+1 415 555 2671")).toBe("+14155552671");
    expect(normalizePhone("5521999990000")).toBe("+5521999990000");
  });
  it("rejeita inválidos", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
  });
  it("formata", () => expect(formatPhone("+5521999990000")).toBe("+55 (21) 99999-0000"));
});
