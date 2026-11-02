import { describe, expect, it } from "vitest";
import { formatAppNumber, formatPhone, normalizeAppNumber, normalizePhone } from "./phone";

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

describe("número interno do app", () => {
  it("normaliza e formata o identificador no padrão próprio", () => {
    expect(normalizeAppNumber("10259-5251")).toBe("10259-5251");
    expect(normalizeAppNumber("102595251")).toBe("10259-5251");
    expect(formatAppNumber("102595251")).toBe("10259-5251");
  });
  it("rejeita tamanhos inválidos", () => {
    expect(normalizeAppNumber("1234-5678")).toBeNull();
    expect(normalizeAppNumber("01234-5678")).toBeNull();
    expect(normalizeAppNumber("1234567890")).toBeNull();
  });
});
