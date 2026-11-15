import { describe, expect, it } from "vitest";
import { normalizarWhatsapp } from "../src/validacao";

describe("normalizarWhatsapp", () => {
  it.each([
    ["(11) 99999-8888", "+5511999998888"],
    ["11 3333-4444", "+551133334444"],
    ["+55 11 99999-8888", "+5511999998888"],
    ["5511999998888", "+5511999998888"],
    ["+1 415 555 0100", "+14155550100"],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarWhatsapp(entrada)).toBe(esperado);
  });

  it.each(["", "123", "abc", "+0 11 9999"])("rejeita %s", (entrada) => {
    expect(normalizarWhatsapp(entrada)).toBeNull();
  });
});
