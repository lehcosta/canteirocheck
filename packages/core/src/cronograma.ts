/**
 * Situação de uma linha do cronograma contra o prazo dela, num dia. PURO: só datas e contas.
 *
 * "Previsto até hoje" é a parte do prazo que já passou, em linha reta do início ao término
 * (os dois dias contam). O arquivo do MS Project não traz linha de base nem datas reais, então
 * a comparação é entre esse previsto e o % concluído que veio do arquivo.
 */

/** Pontos percentuais atrás do previsto a partir dos quais a linha conta como atrasada. */
export const TOLERANCIA_ATRASO_PONTOS = 5;

export type EstadoPrazo = "atrasada" | "em_dia" | "concluida" | "nao_comecou";

export interface LinhaComPrazo {
  /** AAAA-MM-DD */
  inicio: string | null;
  termino: string | null;
  /** 0 a 100, como veio do arquivo. */
  percentual: number;
  marco: boolean;
}

export interface SituacaoPrazo {
  estado: EstadoPrazo;
  /** % do prazo que já passou até `hoje` (no marco: 0 antes da data, 100 depois). */
  previsto: number;
  executado: number;
  /** previsto − executado, nunca negativo. */
  pontosAtras: number;
  /** Dias desde o término, quando ele passou e a linha não está em 100%; senão 0. */
  diasVencida: number;
  /** Dias de `hoje` até o início (negativo se já começou). */
  diasParaComecar: number;
  /** Dias de `hoje` até o término (negativo se já passou). */
  diasParaTerminar: number;
}

const DIA = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const dias = (de: number, ate: number) => Math.round((ate - de) / DIA);

/** `null` quando a linha não tem término no arquivo: sem prazo, não há o que comparar. */
export function situacaoDoPrazo(linha: LinhaComPrazo, hoje: string): SituacaoPrazo | null {
  if (!linha.termino) return null;
  const agora = ms(hoje);
  const fim = ms(linha.termino);
  const inicio = linha.inicio ? ms(linha.inicio) : fim;
  const executado = Math.max(0, Math.min(100, linha.percentual));

  // o dia de hoje conta como decorrido; o dia do término faz parte do prazo
  const decorrido = (agora + DIA - inicio) / (fim + DIA - inicio);
  const previsto = linha.marco
    ? fim < agora
      ? 100
      : 0
    : Math.round(Math.max(0, Math.min(1, decorrido)) * 100);

  const vencida = fim < agora && executado < 100;
  const pontosAtras = Math.max(0, previsto - executado);
  const atrasada = vencida || pontosAtras >= TOLERANCIA_ATRASO_PONTOS;
  const estado: EstadoPrazo = atrasada
    ? "atrasada"
    : executado >= 100
      ? "concluida"
      : inicio > agora
        ? "nao_comecou"
        : "em_dia";
  return {
    estado,
    previsto,
    executado,
    pontosAtras,
    diasVencida: vencida ? dias(fim, agora) : 0,
    diasParaComecar: dias(agora, inicio),
    diasParaTerminar: dias(agora, fim),
  };
}
