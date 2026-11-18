import { describe, expect, it } from "vitest";
import {
  avaliarResposta,
  datasDoCheck,
  esperadaValida,
  estadoDoCheck,
  proximaSaida,
  resumoDaEtapa,
  simOuNao,
  unidadeDaMedida,
} from "../src";

// Pavimentos tipo 1 a 4: de seg 23/11/2026 a sex 29/01/2027
const FASE = { inicio: "2026-11-23", termino: "2027-01-29" };
const SEM_DATA = { inicio: null, termino: null };

describe("datasDoCheck", () => {
  it("antes: dias corridos antes do início", () => {
    expect(datasDoCheck({ momento: "antes", dias: 3 }, FASE)).toEqual(["2026-11-20"]);
    expect(datasDoCheck({ momento: "antes", dias: 0 }, FASE)).toEqual(["2026-11-23"]);
    // atravessa o fim de semana sem pular: 3 dias corridos antes de uma segunda caem na sexta
    expect(datasDoCheck({ momento: "antes", dias: 10 }, FASE)).toEqual(["2026-11-13"]);
  });

  it("depois: dias úteis após o término, pulando sábado e domingo", () => {
    // término numa sexta: o 1º dia útil é a segunda
    expect(datasDoCheck({ momento: "depois", dias: 1 }, FASE)).toEqual(["2027-02-01"]);
    expect(datasDoCheck({ momento: "depois", dias: 3 }, FASE)).toEqual(["2027-02-03"]);
    expect(datasDoCheck({ momento: "depois", dias: 6 }, FASE)).toEqual(["2027-02-08"]);
    // término numa quarta
    expect(datasDoCheck({ momento: "depois", dias: 2 }, { inicio: null, termino: "2026-11-18" })).toEqual([
      "2026-11-20",
    ]);
    // término num sábado: o 1º dia útil é a segunda
    expect(datasDoCheck({ momento: "depois", dias: 1 }, { inicio: null, termino: "2026-11-21" })).toEqual([
      "2026-11-23",
    ]);
  });

  it("durante: todo dia da semana escolhido depois do início e até o término", () => {
    expect(datasDoCheck({ momento: "durante", dias: 1 }, FASE)).toEqual([
      "2026-11-30",
      "2026-12-07",
      "2026-12-14",
      "2026-12-21",
      "2026-12-28",
      "2027-01-04",
      "2027-01-11",
      "2027-01-18",
      "2027-01-25",
    ]);
    // sexta: o término (sex 29/01) entra
    const sextas = datasDoCheck({ momento: "durante", dias: 5 }, FASE);
    expect(sextas[0]).toBe("2026-11-27");
    expect(sextas.at(-1)).toBe("2027-01-29");
    // domingo = 7
    expect(
      datasDoCheck({ momento: "durante", dias: 7 }, { inicio: "2026-11-23", termino: "2026-12-06" }),
    ).toEqual(["2026-11-29", "2026-12-06"]);
    // fase mais curta que uma semana, sem o dia escolhido depois do início
    expect(
      datasDoCheck({ momento: "durante", dias: 1 }, { inicio: "2026-11-23", termino: "2026-11-26" }),
    ).toEqual([]);
  });

  it("fase sem a data de que a regra precisa: nenhuma data", () => {
    expect(datasDoCheck({ momento: "antes", dias: 3 }, SEM_DATA)).toEqual([]);
    expect(datasDoCheck({ momento: "durante", dias: 1 }, SEM_DATA)).toEqual([]);
    expect(datasDoCheck({ momento: "depois", dias: 1 }, SEM_DATA)).toEqual([]);
    // só o término: antes e durante não têm como sair; depois tem
    const soTermino = { inicio: null, termino: "2027-01-29" };
    expect(datasDoCheck({ momento: "antes", dias: 3 }, soTermino)).toEqual([]);
    expect(datasDoCheck({ momento: "durante", dias: 1 }, soTermino)).toEqual([]);
    expect(datasDoCheck({ momento: "depois", dias: 1 }, soTermino)).toEqual(["2027-02-01"]);
  });
});

describe("proximaSaida", () => {
  const datas = ["2026-11-30", "2026-12-07", "2026-12-14"];
  it("a primeira de hoje em diante; se todas passaram, a última; sem datas, null", () => {
    expect(proximaSaida(datas, "2026-11-18")).toBe("2026-11-30");
    expect(proximaSaida(datas, "2026-12-07")).toBe("2026-12-07");
    expect(proximaSaida(datas, "2026-12-08")).toBe("2026-12-14");
    expect(proximaSaida(datas, "2027-01-01")).toBe("2026-12-14");
    expect(proximaSaida([], "2026-11-18")).toBeNull();
  });
});

describe("estadoDoCheck", () => {
  const HOJE = "2026-11-18";
  const envio = (
    previstoPara: string,
    o: { respondido?: boolean; fora?: number | null; enviado?: boolean } = {},
  ) => ({
    previstoPara,
    enviado: o.enviado ?? true,
    respondido: o.respondido ?? false,
    foraDoEsperado: o.fora ?? null,
  });

  it("sem envio: sugerido, para aprovar (até 7 dias ou já passou) e agendado", () => {
    expect(estadoDoCheck({ aprovado: false, datas: ["2026-11-20"], envios: [] }, HOJE)).toBe("aprovar");
    expect(estadoDoCheck({ aprovado: false, datas: ["2026-11-25"], envios: [] }, HOJE)).toBe("aprovar"); // 7 dias
    expect(estadoDoCheck({ aprovado: false, datas: ["2026-11-26"], envios: [] }, HOJE)).toBe("sugerido"); // 8 dias
    // já passou: pede aprovação até 7 dias depois; vencida há mais tempo, volta a sugerida
    expect(estadoDoCheck({ aprovado: false, datas: ["2026-11-11"], envios: [] }, HOJE)).toBe("aprovar");
    expect(estadoDoCheck({ aprovado: false, datas: ["2026-11-10"], envios: [] }, HOJE)).toBe("sugerido");
    expect(estadoDoCheck({ aprovado: false, datas: ["2026-11-02"], envios: [] }, HOJE)).toBe("sugerido");
    expect(estadoDoCheck({ aprovado: true, datas: ["2026-11-20"], envios: [] }, HOJE)).toBe("agendado");
    expect(estadoDoCheck({ aprovado: false, datas: [], envios: [] }, HOJE)).toBe("sugerido");
  });

  it("pelo envio enviado mais recente: na obra, respondido e com alerta", () => {
    const datas = ["2026-11-02", "2026-11-09", "2026-11-16"];
    expect(
      estadoDoCheck(
        { aprovado: true, datas, envios: [envio("2026-11-02", { respondido: true, fora: 0 })] },
        HOJE,
      ),
    ).toBe("ok");
    expect(
      estadoDoCheck(
        { aprovado: true, datas, envios: [envio("2026-11-02", { respondido: true, fora: 1 })] },
        HOJE,
      ),
    ).toBe("alerta");
    expect(
      estadoDoCheck(
        {
          aprovado: true,
          datas,
          envios: [
            envio("2026-11-02", { respondido: true, fora: 1 }),
            envio("2026-11-16"),
            envio("2026-11-09"),
          ],
        },
        HOJE,
      ),
    ).toBe("naobra");
    // o alerta de uma semana antiga não conta quando a mais nova veio sem alerta
    expect(
      estadoDoCheck(
        {
          aprovado: true,
          datas,
          envios: [
            envio("2026-11-09", { respondido: true, fora: 2 }),
            envio("2026-11-16", { respondido: true, fora: 0 }),
          ],
        },
        HOJE,
      ),
    ).toBe("ok");
    // envio registrado mas ainda não enviado não muda o estado
    expect(
      estadoDoCheck(
        { aprovado: true, datas: ["2026-11-20"], envios: [envio("2026-11-20", { enviado: false })] },
        HOJE,
      ),
    ).toBe("agendado");
  });
});

describe("avaliarResposta", () => {
  it("sim ou não, sem diferenciar caixa nem acento", () => {
    const p = { tipo: "sim_nao" as const, esperada: "Sim" };
    expect(avaliarResposta(p, "sim")).toBe(true);
    expect(avaliarResposta(p, " SIM ")).toBe(true);
    expect(avaliarResposta(p, "Não")).toBe(false);
    expect(avaliarResposta({ tipo: "sim_nao", esperada: "Não" }, "nao")).toBe(true);
    expect(avaliarResposta({ tipo: "sim_nao", esperada: null }, "Sim")).toBeNull();
  });

  it("opção, sem diferenciar caixa nem acento", () => {
    const p = { tipo: "opcao" as const, esperada: "R01" };
    expect(avaliarResposta(p, "r01")).toBe(true);
    expect(avaliarResposta(p, "R00")).toBe(false);
    expect(avaliarResposta({ tipo: "opcao", esperada: "Não sei" }, "NAO SEI")).toBe(true);
  });

  it("data: até ou a partir de um dia, em ISO ou no formato brasileiro", () => {
    const ate = { tipo: "data" as const, esperada: "<=2026-11-02" };
    expect(avaliarResposta(ate, "2026-11-02")).toBe(true);
    expect(avaliarResposta(ate, "02/11/2026")).toBe(true);
    expect(avaliarResposta(ate, "2026-11-03")).toBe(false);
    expect(avaliarResposta(ate, "ontem")).toBe(false);
    const aPartir = { tipo: "data" as const, esperada: ">=2026-11-02" };
    expect(avaliarResposta(aPartir, "2026-11-10")).toBe(true);
    expect(avaliarResposta(aPartir, "2026-11-01")).toBe(false);
    expect(avaliarResposta({ tipo: "data", esperada: "2026-11-02" }, "2026-11-02")).toBeNull(); // sem <= nem >=
  });

  it("medida: dentro do intervalo min..max, com vírgula ou ponto na resposta", () => {
    const p = { tipo: "medida" as const, esperada: "5.995..6.005" };
    expect(avaliarResposta(p, "6.002")).toBe(true);
    expect(avaliarResposta(p, "6,002 m")).toBe(true);
    expect(avaliarResposta(p, "6,005")).toBe(true); // a borda conta
    expect(avaliarResposta(p, "6,006")).toBe(false);
    expect(avaliarResposta(p, "seis")).toBe(false);
    expect(avaliarResposta({ tipo: "medida", esperada: "-5..5" }, "-3")).toBe(true);
    expect(avaliarResposta({ tipo: "medida", esperada: "até 6" }, "6")).toBeNull();
  });

  it("texto e esperada nula: não dá para comparar", () => {
    expect(avaliarResposta({ tipo: "texto", esperada: null }, "Nada mudou")).toBeNull();
    expect(avaliarResposta({ tipo: "texto", esperada: "Nada" }, "Nada")).toBeNull();
    expect(avaliarResposta({ tipo: "medida", esperada: null }, "6")).toBeNull();
  });

  it("formato da esperada por tipo", () => {
    expect(esperadaValida("sim_nao", "Não")).toBe(true);
    expect(esperadaValida("sim_nao", "Talvez")).toBe(false);
    expect(esperadaValida("data", ">=2027-02-30")).toBe(false);
    expect(esperadaValida("medida", "6..5")).toBe(false);
    expect(esperadaValida("medida", "5.995..6.005")).toBe(true);
  });
});

describe("unidade da medida e sim ou não", () => {
  it("a unidade vem em opcoes[0]; a resposta de sim ou não é gravada como sim/nao", () => {
    expect(unidadeDaMedida(["m"])).toBe("m");
    expect(unidadeDaMedida([" MM "])).toBe("mm");
    expect(unidadeDaMedida(["km"])).toBeNull();
    expect(unidadeDaMedida([])).toBeNull();
    expect(simOuNao("Não")).toBe("nao");
    expect(simOuNao(" SIM ")).toBe("sim");
    expect(simOuNao("talvez")).toBeNull();
  });
});

describe("resumoDaEtapa", () => {
  it("maior nível, soma dos riscos e contas que pedem atenção", () => {
    // Estrutura do estudo: Térreo e garagem, Pavimentos tipo 1 a 4, Cobertura e reservatório
    expect(
      resumoDaEtapa([
        { nivel: "alto", riscos: 2, checks: ["ok", "naobra", "aprovar"] },
        { nivel: "alto", riscos: 3, checks: ["aprovar", "sugerido", "sugerido"] },
        { nivel: "medio", riscos: 2, checks: ["sugerido", "sugerido", "sugerido"] },
      ]),
    ).toEqual({ nivel: "alto", riscos: 7, aprovar: 2, alerta: 0 });
    expect(
      resumoDaEtapa([
        { nivel: null, riscos: 0, checks: ["ok", "ok", "ok"] },
        { nivel: "baixo", riscos: 1, checks: ["ok", "alerta", "sugerido"] },
        { nivel: "medio", riscos: 1, checks: [] },
      ]),
    ).toEqual({ nivel: "medio", riscos: 2, aprovar: 0, alerta: 1 });
    expect(resumoDaEtapa([])).toEqual({ nivel: null, riscos: 0, aprovar: 0, alerta: 0 });
  });
});
