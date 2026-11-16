export interface Config {
  porta: number;
  timeoutMs: number;
  concorrencia: number;
}

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    porta: inteiro("PORT", env.PORT, 8090, 0),
    timeoutMs: inteiro("EXTRAIR_TIMEOUT_MS", env.EXTRAIR_TIMEOUT_MS, 60_000, 1),
    concorrencia: inteiro("EXTRAIR_CONCORRENCIA", env.EXTRAIR_CONCORRENCIA, 2, 1),
  };
}

function inteiro(nome: string, valor: string | undefined, padrao: number, minimo: number): number {
  if (valor === undefined || valor.trim() === "") return padrao;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo) {
    throw new Error(`${nome} inválido: "${valor}" (inteiro >= ${minimo}).`);
  }
  return numero;
}
