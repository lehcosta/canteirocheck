import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { ResultadoExtracao, Texto } from "../src/contrato.ts";
import { extrairDesenho, extrairDwg } from "../src/extrair.ts";
import { esquemaResultado } from "./esquema.ts";
import { lerFixture } from "./fixtures.ts";

const MTEXT_BRUTO = "{\\fArial|b1;NOTA:} PISO A DEFINIR\\PAGUARDANDO PROJETO DE AR CONDICIONADO";

function texto(parcial: Partial<Texto> & Pick<Texto, "tipo" | "conteudo" | "camada">): Texto {
  return { x: null, y: null, altura: null, bloco: null, tag: null, ...parcial };
}

function porConteudo(resultado: ResultadoExtracao, conteudo: string): Texto[] {
  return resultado.textos.filter((t) => t.conteudo === conteudo);
}

describe("extrairDwg com a fixture amostra.dwg", () => {
  let resultado: ResultadoExtracao;

  beforeAll(async () => {
    resultado = await extrairDwg(lerFixture("amostra.dwg"));
  });

  it("respeita o formato do contrato", () => {
    expect(esquemaResultado.parse(resultado)).toEqual(resultado);
  });

  it("informa versões e cabeçalho do DWG", () => {
    expect(resultado.versao).toEqual({ extrator: "0.1.0", libredwgWeb: "0.9.0" });
    expect(resultado.dwg).toEqual({ versao: "AC1015", unidades: "6" });
  });

  it("extrai TEXTs do modelo com conteúdo cru", () => {
    const base = { tipo: "TEXT", camada: "A-TEXTO" } as const;
    expect(resultado.textos).toContainEqual(texto({ ...base, conteudo: "SALA", x: 2, y: 1.8, altura: 0.25 }));
    expect(resultado.textos).toContainEqual(
      texto({ ...base, conteudo: "ÁREA: 18,50 m²", x: 2, y: 1.4, altura: 0.15 }),
    );
    expect(resultado.textos).toContainEqual(
      texto({ ...base, conteudo: "PILAR %%c30", x: 1, y: 3, altura: 0.15 }),
    );
  });

  it("extrai marcas de nível como texto cru", () => {
    const niveis = resultado.textos.filter((t) => t.camada === "A-NIVEL").map((t) => t.conteudo);
    expect(niveis).toEqual(["+6,00", "N.A. +3,05"]);
  });

  it("preserva os códigos de formatação do MTEXT", () => {
    const [mtext] = resultado.textos.filter((t) => t.tipo === "MTEXT");
    expect(mtext).toMatchObject({ conteudo: MTEXT_BRUTO, camada: "A-TEXTO", x: 6, y: 3, bloco: null });
  });

  it("extrai os ATTRIBs do carimbo uma única vez, com tag e bloco", () => {
    const atributos = resultado.textos.filter((t) => t.tipo === "ATTRIB");
    const base = { tipo: "ATTRIB", camada: "CARIMBO", bloco: "CARIMBO", x: 10, altura: 0.2 } as const;
    expect(atributos).toEqual([
      texto({ ...base, conteudo: "CONSTRUTORA EXEMPLO LTDA", tag: "CLIENTE", y: 1.5 }),
      texto({ ...base, conteudo: "EXECUTIVO", tag: "FASE", y: 1 }),
      texto({ ...base, conteudo: "R02", tag: "REVISAO", y: 0.5 }),
      texto({ ...base, conteudo: "15/11/2026", tag: "DATA", y: 0 }),
    ]);
  });

  it("inclui o TEXT da definição do bloco inserido, na posição transformada", () => {
    expect(porConteudo(resultado, "PROJETO EXECUTIVO DE ARQUITETURA")).toEqual([
      texto({
        tipo: "TEXT",
        conteudo: "PROJETO EXECUTIVO DE ARQUITETURA",
        camada: "CARIMBO",
        bloco: "CARIMBO",
        x: 10,
        y: 2,
        altura: 0.25,
      }),
    ]);
  });

  it("não reporta ATTDEFs não constantes nem o texto do bloco anônimo da cota", () => {
    expect(resultado.textos.filter((t) => t.tipo === "ATTDEF")).toEqual([]);
    expect(porConteudo(resultado, "5.00")).toEqual([]);
  });

  it("inclui textos do espaço do papel", () => {
    expect(resultado.textos).toContainEqual(
      texto({ tipo: "TEXT", conteudo: "FOLHA 01/01", camada: "CARIMBO", x: 1, y: 1, altura: 0.3 }),
    );
  });

  it("lista as camadas com a contagem de entidades do espaço do modelo", () => {
    const camada = (nome: string, entidades: number, desligada = false) => ({
      nome,
      desligada,
      congelada: false,
      entidades,
    });
    expect(resultado.camadas).toEqual([
      camada("0", 1),
      camada("A-TEXTO", 4),
      camada("A-AMBIENTE", 2),
      camada("A-NIVEL", 2),
      camada("CARIMBO", 1),
      camada("A-COTA", 1),
      // congelada no DXF, mas o dxf2dwg 0.13.3 perde o flag (ver teste do DXF abaixo)
      camada("A-OCULTA", 0, true),
    ]);
  });

  it("extrai a inserção do carimbo com os 4 atributos", () => {
    expect(resultado.insercoes).toEqual([
      {
        bloco: "CARIMBO",
        camada: "CARIMBO",
        x: 10,
        y: 0,
        atributos: [
          { tag: "CLIENTE", valor: "CONSTRUTORA EXEMPLO LTDA" },
          { tag: "FASE", valor: "EXECUTIVO" },
          { tag: "REVISAO", valor: "R02" },
          { tag: "DATA", valor: "15/11/2026" },
        ],
      },
    ]);
  });

  it("extrai LWPOLYLINE e POLYLINE 2D com vértices, fechamento e arcos", () => {
    expect(resultado.polilinhas).toEqual([
      {
        camada: "A-AMBIENTE",
        fechada: true,
        vertices: [
          [0, 0],
          [5, 0],
          [5, 3.7],
          [0, 3.7],
        ],
        arcos: 0,
      },
      {
        camada: "0",
        fechada: false,
        vertices: [
          [5, 1],
          [5, 2],
          [6, 2],
        ],
        arcos: 1,
      },
      {
        camada: "A-AMBIENTE",
        fechada: true,
        vertices: [
          [0, 4],
          [3, 4],
          [3, 6],
          [0, 6],
        ],
        arcos: 0,
      },
    ]);
  });

  it("extrai a cota com medida e sem texto de substituição", () => {
    expect(resultado.cotas).toEqual([{ camada: "A-COTA", texto: null, medida: 5, x: 2.5, y: -0.65 }]);
  });
});

describe("mesma amostra lida do DXF de origem", () => {
  // O dxf2dwg 0.13.3 grava a altura do MTEXT no campo rect_width e descarta o flag de camada congelada.
  // Lendo o DXF (mesmo libredwg, sem o encoder DWG), o mapeamento desses campos fica coberto.
  let resultado: ResultadoExtracao;

  beforeAll(async () => {
    resultado = await extrairDesenho(lerFixture("amostra.dxf"), "dxf");
  });

  it("lê a altura do MTEXT", () => {
    const [mtext] = resultado.textos.filter((t) => t.tipo === "MTEXT");
    expect(mtext).toMatchObject({ conteudo: MTEXT_BRUTO, altura: 0.2 });
  });

  it("marca a camada congelada e desligada", () => {
    expect(resultado.camadas.find((c) => c.nome === "A-OCULTA")).toMatchObject({
      congelada: true,
      desligada: true,
    });
  });
});

describe("arquivos inválidos", () => {
  const dwg = lerFixture("amostra.dwg");
  const casos: [string, Uint8Array][] = [
    ["bytes aleatórios", new Uint8Array(randomBytes(4096))],
    ["vazio", new Uint8Array(0)],
    [
      "assinatura DWG seguida de lixo",
      new Uint8Array(Buffer.concat([Buffer.from("AC1015"), randomBytes(4096)])),
    ],
    ["DWG truncado", dwg.slice(0, Math.floor(dwg.length / 2))],
  ];

  it.each(casos)("rejeita %s como arquivo_invalido", async (_, bytes) => {
    await expect(extrairDwg(bytes)).rejects.toMatchObject({ codigo: "arquivo_invalido" });
  });
});
