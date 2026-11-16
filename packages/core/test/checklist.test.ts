import { describe, expect, it } from "vitest";
import {
  agruparEmLotes,
  ordenarPontos,
  type PontoOrdenavel,
  proximoPasso,
  type RegistroVerificacao,
  resumir,
  TransicaoInvalida,
  transicionar,
} from "../src";

const reg = (
  pontoId: string,
  tentativa: number,
  dentro: boolean,
  comDivergencia = false,
): RegistroVerificacao => ({
  pontoId,
  tentativa,
  dentro,
  comDivergencia,
});

describe("proximoPasso — cenário da §10", () => {
  const sessao = ["interface", "eixoA", "eixoB"]; // interface vem primeiro

  it("percorre medir → remedir → causa → próximos → resumo", () => {
    const r: RegistroVerificacao[] = [];
    expect(proximoPasso(sessao, r)).toEqual({
      tipo: "medir",
      indice: 0,
      pontoId: "interface",
      tentativa: 1,
      anteriorFora: false,
    });

    r.push(reg("interface", 1, false)); // 6,040 ❌
    expect(proximoPasso(sessao, r)).toEqual({
      tipo: "medir",
      indice: 0,
      pontoId: "interface",
      tentativa: 2,
      anteriorFora: true,
    });

    r.push(reg("interface", 2, false)); // refez: 6,040 ❌
    expect(proximoPasso(sessao, r)).toEqual({ tipo: "causa", indice: 0, pontoId: "interface", tentativa: 2 });

    r[1] = reg("interface", 2, false, true); // causa + foto gravadas
    expect(proximoPasso(sessao, r)).toMatchObject({ tipo: "medir", pontoId: "eixoA", tentativa: 1 });

    r.push(reg("eixoA", 1, true), reg("eixoB", 1, true));
    expect(proximoPasso(sessao, r)).toEqual({ tipo: "resumo" });
    expect(resumir(sessao, r)).toEqual({
      ok: ["eixoA", "eixoB"],
      divergentes: ["interface"],
      pendentes: [],
      completo: true,
    });
  });

  it("2ª medida dentro da tolerância salva o ponto", () => {
    const r = [reg("eixoA", 1, false), reg("eixoA", 2, true)];
    expect(proximoPasso(["eixoA"], r)).toEqual({ tipo: "resumo" });
    expect(resumir(["eixoA"], r).ok).toEqual(["eixoA"]);
  });

  it("reabrir no meio continua de onde parou", () => {
    const r = [reg("interface", 1, true)];
    expect(proximoPasso(sessao, r)).toMatchObject({ tipo: "medir", pontoId: "eixoA", indice: 1 });
    expect(resumir(sessao, r)).toMatchObject({ pendentes: ["eixoA", "eixoB"], completo: false });
  });
});

describe("ordem e lotes", () => {
  const p = (id: string, extra: Partial<PontoOrdenavel> = {}): PontoOrdenavel => ({
    id,
    descricao: id,
    ehInterface: false,
    falhasAnteriores: 0,
    regiao: null,
    localNome: "Laje L4",
    ...extra,
  });

  it("interfaces → já falharam → resto", () => {
    const ordem = ordenarPontos([
      p("c"),
      p("b", { falhasAnteriores: 2 }),
      p("a"),
      p("z", { ehInterface: true }),
    ]);
    expect(ordem.map((x) => x.id)).toEqual(["z", "b", "a", "c"]);
  });

  it("até 9 pontos: um lote só", () => {
    const lotes = agruparEmLotes(Array.from({ length: 9 }, (_, i) => p(`p${i}`)));
    expect(lotes).toHaveLength(1);
    expect(lotes[0]?.titulo).toBe("Laje L4");
  });

  it("mais de 9: agrupa por região, interfaces primeiro, e divide regiões grandes", () => {
    const pontos = [
      ...Array.from({ length: 12 }, (_, i) => p(`a${i}`, { regiao: "Eixos A a D" })),
      p("i1", { regiao: "Borda L3/L4", ehInterface: true }),
    ];
    const lotes = agruparEmLotes(pontos);
    expect(lotes.map((l) => [l.titulo, l.pontos.length])).toEqual([
      ["Borda L3/L4", 1],
      ["Eixos A a D (1/2)", 9],
      ["Eixos A a D (2/2)", 3],
    ]);
  });
});

describe("máquina de estados da execução", () => {
  it("caminho do cenário: anunciada → conferência → bloqueada → recusada → nova rodada", () => {
    let e = { status: "anunciada" as const, rodada: 1 } as Parameters<typeof transicionar>[0];
    e = transicionar(e, "iniciar_conferencia");
    expect(e).toEqual({ status: "em_conferencia", rodada: 1 });
    e = transicionar(e, "divergencia_confirmada");
    e = transicionar(e, "conferencia_concluida");
    expect(e).toEqual({ status: "bloqueada", rodada: 1 });
    e = transicionar(e, "recusar");
    expect(e).toEqual({ status: "recusada", rodada: 1 });
    e = transicionar(e, "iniciar_conferencia");
    expect(e).toEqual({ status: "em_conferencia", rodada: 2 });
    e = transicionar(e, "conferencia_concluida");
    expect(e).toEqual({ status: "aguardando_liberacao", rodada: 2 });
    expect(transicionar(e, "liberar")).toEqual({ status: "liberada", rodada: 2 });
  });

  it("não deixa liberar sem conferência nem conferir depois de liberada", () => {
    expect(() => transicionar({ status: "anunciada", rodada: 1 }, "liberar")).toThrow(TransicaoInvalida);
    expect(() => transicionar({ status: "em_conferencia", rodada: 1 }, "liberar")).toThrow(TransicaoInvalida);
    expect(() => transicionar({ status: "liberada", rodada: 1 }, "iniciar_conferencia")).toThrow(
      TransicaoInvalida,
    );
    expect(() => transicionar({ status: "bloqueada", rodada: 1 }, "iniciar_conferencia")).toThrow(
      TransicaoInvalida,
    );
    expect(() => transicionar({ status: "liberada", rodada: 1 }, "cancelar")).toThrow(TransicaoInvalida);
  });
});
