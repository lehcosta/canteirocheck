import { describe, expect, it } from "vitest";
import { type FatosDaObra, passosDaObra } from "../src";

const nova: FatosDaObra = { temEncarregado: false, locais: 0, pontosAprovados: 0, etapaAnunciada: false };

describe("passosDaObra", () => {
  it("obra recém-criada: dados feitos, equipe agora, o resto depois", () => {
    const p = passosDaObra(nova);
    expect(p.situacoes).toEqual(["feito", "agora", "depois", "depois"]);
    expect(p.atual).toBe(2);
    expect(p.feitos).toBe(1);
    expect(p).toMatchObject({ visivel: true, pronta: false });
  });

  it("cada passo vale por si: o primeiro que falta é o de agora", () => {
    expect(passosDaObra({ ...nova, temEncarregado: true }).situacoes).toEqual([
      "feito",
      "feito",
      "agora",
      "depois",
    ]);
    expect(passosDaObra({ ...nova, temEncarregado: true, locais: 3 }).situacoes).toEqual([
      "feito",
      "feito",
      "feito",
      "agora",
    ]);
    // locais cadastrados antes da equipe: o passo 3 já conta como feito
    expect(passosDaObra({ ...nova, locais: 1 }).situacoes).toEqual(["feito", "agora", "feito", "depois"]);
  });

  it("o encarregado saiu depois do passo 3: a equipe volta a ser agora, o resto segue feito", () => {
    const p = passosDaObra({ temEncarregado: false, locais: 2, pontosAprovados: 4, etapaAnunciada: false });
    expect(p.situacoes).toEqual(["feito", "agora", "feito", "feito"]);
    expect(p).toMatchObject({ atual: 2, feitos: 3, pronta: false, visivel: true });
  });

  it("pronta: os quatro feitos e nenhuma etapa anunciada ainda", () => {
    const p = passosDaObra({ temEncarregado: true, locais: 1, pontosAprovados: 1, etapaAnunciada: false });
    expect(p).toMatchObject({ atual: null, feitos: 4, pronta: true, visivel: true });
  });

  it("obra em andamento (a primeira etapa já foi anunciada): a faixa não aparece", () => {
    const p = passosDaObra({ temEncarregado: true, locais: 5, pontosAprovados: 30, etapaAnunciada: true });
    expect(p).toMatchObject({ pronta: false, visivel: false });
  });

  it("obra antiga sem algum passo, mas já anunciada: a faixa volta, porque falta passo", () => {
    const p = passosDaObra({ temEncarregado: false, locais: 5, pontosAprovados: 30, etapaAnunciada: true });
    expect(p).toMatchObject({ atual: 2, visivel: true, pronta: false });
  });
});
