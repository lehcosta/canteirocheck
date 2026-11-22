import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { esquemaResultado, interpretar, lerArea, lerNivel, limparMtext, pareceDependencia } from "../src";

/** Saída real do dwg-extractor para services/dwg-extractor/test/fixtures/amostra.dwg. */
const bruto = esquemaResultado.parse(
  JSON.parse(readFileSync(new URL("./fixtures/amostra.extracao.json", import.meta.url), "utf8")),
);

describe("limparMtext", () => {
  it.each([
    [
      "{\\fArial|b1;NOTA:} PISO A DEFINIR\\PAGUARDANDO PROJETO DE AR CONDICIONADO",
      "NOTA: PISO A DEFINIR\nAGUARDANDO PROJETO DE AR CONDICIONADO",
    ],
    ["\\A1;{\\H0.7x;\\C1;COTA} +6,00", "COTA +6,00"],
    ["PILAR %%c30", "PILAR Ø30"],
    ["90%%d e %%p1 cm", "90° e ±1 cm"],
    ["\\S1/2; pol", "1/2 pol"],
    ["\\pxi-3,l3;• item\\P\\Lsublinhado\\l", "• item\nsublinhado"],
    ["chaves \\{literais\\} e barra \\\\", "chaves {literais} e barra \\"],
  ])("%j", (entrada, esperado) => {
    expect(limparMtext(entrada)).toBe(esperado);
  });
});

describe("padrões", () => {
  it("áreas", () => {
    expect(lerArea("ÁREA: 18,50 m²")).toBe(18.5);
    expect(lerArea("A=12,3m2")).toBe(12.3);
    expect(lerArea("7,85 m²")).toBe(7.85);
    expect(lerArea("SALA")).toBeNull();
  });
  it("níveis", () => {
    expect(lerNivel("+6,00")).toEqual({ valor: "6.00", referencia: null });
    expect(lerNivel("N.A. +3,05")).toEqual({ valor: "3.05", referencia: "N.A." });
    expect(lerNivel("EL. -0,150")).toEqual({ valor: "-0.150", referencia: "EL." });
    expect(lerNivel("NÍVEL +12,40 m")).toEqual({ valor: "12.40", referencia: "NÍVEL" });
    expect(lerNivel("±0,00")).toEqual({ valor: "0.00", referencia: null });
    expect(lerNivel("6,00")).toBeNull(); // sem sinal não é marca de nível
    // área de ambiente com dois dígitos antes da vírgula também não (o "4" não é sinal)
    expect(lerNivel("47,65")).toBeNull();
    expect(lerNivel("145,80")).toBeNull();
    expect(lerNivel("A12,50")).toBeNull();
    expect(lerNivel("−1,20")).toEqual({ valor: "-1.20", referencia: null }); // menos tipográfico
  });
  it("pré-filtro de pendência", () => {
    expect(pareceDependencia("PISO A DEFINIR")).toBe(true);
    expect(pareceDependencia("AGUARDANDO PROJETO DE AR CONDICIONADO")).toBe(true);
    expect(pareceDependencia("Conferir no local antes de executar")).toBe(true);
    expect(pareceDependencia("PORCELANATO 60x60 RETIFICADO")).toBe(false);
  });
});

describe("interpretar — aceite da etapa 2 com a amostra", () => {
  const r = interpretar(bruto);

  it("textos limpos (sem códigos de MTEXT)", () => {
    expect(r.textos.map((t) => t.texto)).toContain(
      "NOTA: PISO A DEFINIR\nAGUARDANDO PROJETO DE AR CONDICIONADO",
    );
    expect(r.textos.some((t) => /\\P|\{\\f|%%c/.test(t.texto))).toBe(false);
    expect(r.textos.map((t) => t.texto)).toContain("PILAR Ø30");
  });

  it("camadas", () => {
    expect(r.camadas.map((c) => c.nome)).toEqual([
      "0",
      "A-TEXTO",
      "A-AMBIENTE",
      "A-NIVEL",
      "CARIMBO",
      "A-COTA",
      "A-OCULTA",
    ]);
    expect(r.camadas.find((c) => c.nome === "A-OCULTA")?.desligada).toBe(true);
  });

  it("ambiente com área (texto do projeto tem prioridade sobre a geometria)", () => {
    expect(r.ambientes).toEqual([
      { nome: "SALA", areaM2: "18.50", fonteArea: "texto", camada: "A-AMBIENTE", x: 2, y: 1.8 },
    ]);
    expect(r.unidades).toEqual({ codigo: "6", metrosPorUnidade: 1, assumida: false });
  });

  it("cotas de nível", () => {
    expect(r.cotasNivel.map((c) => [c.texto, c.valor, c.referencia])).toEqual([
      ["+6,00", "6.00", null],
      ["N.A. +3,05", "3.05", "N.A."],
    ]);
  });

  it("carimbo", () => {
    expect(r.carimbo).toMatchObject({
      cliente: "CONSTRUTORA EXEMPLO LTDA",
      fase: "EXECUTIVO",
      revisao: "R02",
      data: "15/11/2026",
      titulo: "PROJETO EXECUTIVO DE ARQUITETURA",
      folha: "01/01",
    });
  });

  it("notas, com o pré-filtro de pendência", () => {
    expect(r.notas).toEqual([
      {
        texto: "NOTA: PISO A DEFINIR\nAGUARDANDO PROJETO DE AR CONDICIONADO",
        camada: "A-TEXTO",
        pareceDependencia: true,
      },
    ]);
  });

  it("blocos", () => {
    expect(r.blocos).toEqual([
      { nome: "CARIMBO", insercoes: 1, atributos: ["CLIENTE", "FASE", "REVISAO", "DATA"] },
    ]);
  });

  it("sem polilinha: rótulo + área logo abaixo viram ambiente; mm convertido", () => {
    const sem = interpretar({
      ...bruto,
      dwg: { versao: "AC1032", unidades: "4" },
      polilinhas: [],
      textos: [
        {
          tipo: "TEXT",
          conteudo: "COZINHA",
          camada: "A-TEXTO",
          x: 1000,
          y: 2000,
          altura: 200,
          bloco: null,
          tag: null,
        },
        {
          tipo: "TEXT",
          conteudo: "A=7,85m²",
          camada: "A-TEXTO",
          x: 1000,
          y: 1700,
          altura: 150,
          bloco: null,
          tag: null,
        },
      ],
    });
    expect(sem.ambientes).toEqual([
      { nome: "COZINHA", areaM2: "7.85", fonteArea: "texto", camada: "A-TEXTO", x: 1000, y: 2000 },
    ]);
  });
});
