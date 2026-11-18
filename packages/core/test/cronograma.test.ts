import { describe, expect, it } from "vitest";
import { situacaoDoPrazo, TOLERANCIA_ATRASO_PONTOS } from "../src";

const HOJE = "2026-11-17";
const tarefa = (inicio: string | null, termino: string | null, percentual: number, marco = false) => ({
  inicio,
  termino,
  percentual,
  marco,
});

describe("situacaoDoPrazo", () => {
  it("atraso em andamento: previsto em linha reta, contando hoje e o dia do término", () => {
    // 19/10 a 20/11 = 33 dias; até 17/11 passaram 30 → 91%
    const s = situacaoDoPrazo(tarefa("2026-10-19", "2026-11-20", 80), HOJE);
    expect(s).toMatchObject({
      estado: "atrasada",
      previsto: 91,
      pontosAtras: 11,
      diasVencida: 0,
      diasParaTerminar: 3,
    });
  });

  it("atraso vencido: conta os dias desde o término", () => {
    const s = situacaoDoPrazo(tarefa("2026-08-31", "2026-10-30", 85), HOJE);
    expect(s).toMatchObject({ estado: "atrasada", previsto: 100, pontosAtras: 15, diasVencida: 18 });
  });

  it("devia ter começado: 0% com o início já passado", () => {
    const s = situacaoDoPrazo(tarefa("2026-11-09", "2026-12-11", 0), HOJE);
    expect(s).toMatchObject({ estado: "atrasada", previsto: 27, executado: 0, pontosAtras: 27 });
  });

  it(`tolerância: menos de ${TOLERANCIA_ATRASO_PONTOS} pontos atrás ainda é em dia; a partir daí, atrasada`, () => {
    expect(situacaoDoPrazo(tarefa("2026-10-19", "2026-11-20", 87), HOJE)?.estado).toBe("em_dia"); // 4 atrás
    expect(situacaoDoPrazo(tarefa("2026-10-19", "2026-11-20", 86), HOJE)?.estado).toBe("atrasada"); // 5 atrás
  });

  it("vencida conta como atrasada mesmo dentro da tolerância", () => {
    expect(situacaoDoPrazo(tarefa("2026-08-03", "2026-10-30", 98), HOJE)).toMatchObject({
      estado: "atrasada",
      pontosAtras: 2,
      diasVencida: 18,
    });
  });

  it("em dia, adiantada, concluída e não começou", () => {
    expect(situacaoDoPrazo(tarefa("2026-11-02", "2026-12-04", 60), HOJE)).toMatchObject({
      estado: "em_dia",
      previsto: 48,
      pontosAtras: 0,
    });
    expect(situacaoDoPrazo(tarefa("2026-08-03", "2026-08-28", 100), HOJE)).toMatchObject({
      estado: "concluida",
      diasVencida: 0,
    });
    expect(situacaoDoPrazo(tarefa("2026-11-23", "2027-01-29", 0), HOJE)).toMatchObject({
      estado: "nao_comecou",
      previsto: 0,
      diasParaComecar: 6,
    });
  });

  it("termina hoje: ainda não venceu", () => {
    expect(situacaoDoPrazo(tarefa("2026-11-10", HOJE, 97), HOJE)).toMatchObject({
      estado: "em_dia",
      previsto: 100,
      diasVencida: 0,
    });
  });

  it("marco: atrasado só depois da data, e sem previsto parcial", () => {
    expect(situacaoDoPrazo(tarefa("2026-11-12", "2026-11-12", 0, true), HOJE)).toMatchObject({
      estado: "atrasada",
      diasVencida: 5,
    });
    expect(situacaoDoPrazo(tarefa("2027-06-30", "2027-06-30", 0, true), HOJE)).toMatchObject({
      estado: "nao_comecou",
      previsto: 0,
    });
    expect(situacaoDoPrazo(tarefa("2026-11-12", "2026-11-12", 100, true), HOJE)?.estado).toBe("concluida");
  });

  it("hoje fora do cronograma: antes do início nada atrasa; depois do fim, o que não fechou venceu", () => {
    expect(situacaoDoPrazo(tarefa("2026-10-19", "2026-11-20", 0), "2026-07-01")?.estado).toBe("nao_comecou");
    expect(situacaoDoPrazo(tarefa("2026-10-19", "2026-11-20", 99), "2027-08-01")).toMatchObject({
      estado: "atrasada",
      diasVencida: 254,
    });
  });

  it("sem término no arquivo não há prazo para comparar; sem início, vale o término", () => {
    expect(situacaoDoPrazo(tarefa(null, null, 40), HOJE)).toBeNull();
    expect(situacaoDoPrazo(tarefa("2026-11-01", null, 40), HOJE)).toBeNull();
    expect(situacaoDoPrazo(tarefa(null, "2026-11-10", 40), HOJE)).toMatchObject({
      estado: "atrasada",
      diasVencida: 7,
    });
  });
});
