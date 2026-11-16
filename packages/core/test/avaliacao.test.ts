import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  avaliar,
  dec,
  EntradaIncompativel,
  formatarDiferenca,
  formatarEsperado,
  formatarNumero,
  lerNumero,
  type PontoAvaliavel,
} from "../src";

const eixoA: PontoAvaliavel = {
  grandeza: "nivel",
  unidade: "m",
  valorEsperado: "6.0000",
  toleranciaMais: "0.0100",
  toleranciaMenos: "0.0100",
  ehInterface: false,
};
const interfaceL3L4: PontoAvaliavel = {
  ...eixoA,
  toleranciaMais: "0.005",
  toleranciaMenos: "0.005",
  ehInterface: true,
};

function valor(t: string) {
  const r = lerNumero(t);
  if (!r.ok) throw new Error(`não leu ${t}`);
  return r.valor;
}

describe("lerNumero", () => {
  it.each([
    ["6,005", "6.005"],
    ["6.005", "6.005"],
    [" +6,00 m", "6"],
    ["6,040m", "6.04"],
    ["-0,5", "-0.5"],
    ["1.234,5", "1234.5"],
    ["1,234.5", "1234.5"],
    ["1.234.567", "1234567"],
    [",5", "0.5"],
    ["12 cm", "12"],
  ])("%s → %s", (texto, esperado) => {
    expect(valor(texto).toFixed()).toBe(esperado);
  });

  it.each([
    ["", "vazio"],
    ["abc", "invalido"],
    ["6,0,0", "invalido"],
    ["6.", "invalido"],
    ["6,00001", "casas_demais"],
    ["999999999", "grande_demais"],
    ["1e3", "invalido"],
  ])("rejeita %j (%s)", (texto, erro) => {
    expect(lerNumero(texto)).toEqual({ ok: false, erro });
  });
});

describe("avaliar — cenário da §10", () => {
  it("ponto 1: 6,005 dentro de 6,00 ± 1 cm", () => {
    const r = avaliar(eixoA, { tipo: "valor", valor: valor("6,005") });
    expect(r).toMatchObject({ dentro: true, motivo: null, valorMedido: "6.005", diferenca: "0.005" });
  });

  it("ponto 2: 6,000 dentro", () => {
    expect(avaliar(eixoA, { tipo: "valor", valor: valor("6,000") }).dentro).toBe(true);
  });

  it("interface L3 = 6,000 / L4 = 6,040 com a mesma RN → desalinhado (+4 cm)", () => {
    const r = avaliar(interfaceL3L4, {
      tipo: "interface",
      referencia: valor("6,000"),
      novo: valor("6,040"),
      mesmaReferenciaNivel: true,
    });
    expect(r).toMatchObject({
      dentro: false,
      motivo: "desalinhado",
      valorMedido: "6.04",
      valorReferencia: "6",
      diferenca: "0.04",
      mesmaReferenciaNivel: true,
    });
    expect(formatarDiferenca(r.diferenca ?? "0", "m")).toBe("+4 cm");
  });
});

describe("avaliar — limites e regras", () => {
  it("limite é inclusivo e sem erro de float (6,01 − 6,00 = 0,01 exato)", () => {
    expect(avaliar(eixoA, { tipo: "valor", valor: valor("6,01") }).dentro).toBe(true);
    expect(avaliar(eixoA, { tipo: "valor", valor: valor("5,99") }).dentro).toBe(true);
    expect(avaliar(eixoA, { tipo: "valor", valor: valor("6,0101") }).dentro).toBe(false);
    expect(avaliar(eixoA, { tipo: "valor", valor: valor("5,9899") }).dentro).toBe(false);
  });

  it("tolerância assimétrica", () => {
    const p = { ...eixoA, toleranciaMais: "0.02", toleranciaMenos: "0" };
    expect(avaliar(p, { tipo: "valor", valor: valor("6,02") }).dentro).toBe(true);
    expect(avaliar(p, { tipo: "valor", valor: valor("5,9999") }).dentro).toBe(false);
  });

  it("interface com RN diferente nunca passa, mesmo com valores iguais", () => {
    const r = avaliar(interfaceL3L4, {
      tipo: "interface",
      referencia: valor("6"),
      novo: valor("6"),
      mesmaReferenciaNivel: false,
    });
    expect(r).toMatchObject({ dentro: false, motivo: "referencia_diferente" });
  });

  it("interface alinhada mas fora do projeto → engenheiro decide", () => {
    const r = avaliar(interfaceL3L4, {
      tipo: "interface",
      referencia: valor("6,03"),
      novo: valor("6,032"),
      mesmaReferenciaNivel: true,
    });
    expect(r).toMatchObject({ dentro: false, motivo: "fora_do_projeto" });
  });

  it("existência", () => {
    const p: PontoAvaliavel = { ...eixoA, grandeza: "existencia", unidade: "booleano", valorEsperado: null };
    expect(avaliar(p, { tipo: "existencia", existe: true }).dentro).toBe(true);
    expect(avaliar(p, { tipo: "existencia", existe: false })).toMatchObject({
      dentro: false,
      motivo: "nao_existe",
    });
  });

  it("entrada do tipo errado é erro de programação", () => {
    expect(() => avaliar(interfaceL3L4, { tipo: "valor", valor: valor("6") })).toThrow(EntradaIncompativel);
    expect(() => avaliar(eixoA, { tipo: "existencia", existe: true })).toThrow(EntradaIncompativel);
  });

  it("propriedade: dentro ⇔ esperado − menos ≤ medido ≤ esperado + mais (em décimos de mm)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200_000 }),
        fc.integer({ min: 0, max: 200_000 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        (esperado, medido, mais, menos) => {
          const p: PontoAvaliavel = {
            ...eixoA,
            valorEsperado: dec(esperado).div(10_000).toFixed(),
            toleranciaMais: dec(mais).div(10_000).toFixed(),
            toleranciaMenos: dec(menos).div(10_000).toFixed(),
          };
          const r = avaliar(p, { tipo: "valor", valor: dec(medido).div(10_000) });
          return r.dentro === (medido - esperado <= mais && esperado - medido <= menos);
        },
      ),
    );
  });
});

describe("formatação", () => {
  it("esperado e tolerância como o encarregado lê", () => {
    expect(formatarEsperado(eixoA)).toBe("6,000 m ± 1 cm");
    expect(formatarEsperado(interfaceL3L4)).toBe("6,000 m ± 0,5 cm");
    expect(formatarEsperado({ ...eixoA, toleranciaMais: "0.02", toleranciaMenos: "0" })).toBe(
      "6,000 m +2 cm / −0 cm",
    );
  });

  it("números em pt-BR", () => {
    expect(formatarNumero("1234.5", 2)).toBe("1.234,50");
    expect(formatarNumero("-0.005")).toBe("−0,005");
    expect(formatarNumero("0")).toBe("0");
  });
});

describe("converter", () => {
  it("m ↔ cm ↔ mm exato", async () => {
    const { converter } = await import("../src");
    expect(converter("0.01", "m", "cm").toFixed()).toBe("1");
    expect(converter("5", "mm", "m").toFixed()).toBe("0.005");
    expect(converter("0.5", "cm", "mm").toFixed()).toBe("5");
  });
});
