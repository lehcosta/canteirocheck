/**
 * Os quatro passos de uma obra até a primeira conferência: dados (feito ao criar), equipe no WhatsApp
 * (algum encarregado), locais (algum local) e pontos de controle (algum ponto aprovado). Cada passo vale
 * por si — tirar o único encarregado devolve o passo 2 para "agora" sem desfazer os outros. O passo de agora
 * é o primeiro que falta.
 *
 * A faixa que mostra os passos aparece enquanto falta passo. Com os quatro feitos, ela vira o aviso de
 * "pronta" até a primeira etapa ser anunciada; depois disso some.
 */

export interface FatosDaObra {
  temEncarregado: boolean;
  locais: number;
  pontosAprovados: number;
  /** Alguma execução já foi anunciada pelo encarregado. */
  etapaAnunciada: boolean;
}

export type SituacaoPasso = "feito" | "agora" | "depois";

export interface PassosDaObra {
  /** Um por passo, na ordem: dados, equipe, locais, pontos. */
  situacoes: [SituacaoPasso, SituacaoPasso, SituacaoPasso, SituacaoPasso];
  /** Número do passo de agora (2 a 4), ou `null` com os quatro feitos. */
  atual: 2 | 3 | 4 | null;
  feitos: number;
  /** Os quatro feitos e nenhuma etapa anunciada ainda. */
  pronta: boolean;
  /** A faixa (ou o aviso de pronta) aparece. */
  visivel: boolean;
}

export function passosDaObra(f: FatosDaObra): PassosDaObra {
  const feito = [true, f.temEncarregado, f.locais > 0, f.pontosAprovados > 0];
  const primeiroQueFalta = feito.indexOf(false);
  const situacoes = feito.map((ok, i) =>
    ok ? "feito" : i === primeiroQueFalta ? "agora" : "depois",
  ) as PassosDaObra["situacoes"];
  const feitos = feito.filter(Boolean).length;
  const completa = feitos === 4;
  return {
    situacoes,
    atual: completa ? null : ((primeiroQueFalta + 1) as 2 | 3 | 4),
    feitos,
    pronta: completa && !f.etapaAnunciada,
    visivel: !(completa && f.etapaAnunciada),
  };
}
