import { exigirAssinaturaDwg } from "./assinatura.ts";
import type { ResultadoExtracao } from "./contrato.ts";
import { carregarLibreDwg, type Formato, lerDesenho } from "./leitura.ts";
import { mapearDesenho } from "./mapear.ts";
import { VERSAO_EXTRATOR, VERSAO_LIBREDWG_WEB } from "./versao.ts";

const VERSOES = { extrator: VERSAO_EXTRATOR, libredwgWeb: VERSAO_LIBREDWG_WEB };

/**
 * Extrai as entidades brutas de um DWG. Síncrono por baixo (WASM): no servidor roda
 * sempre dentro de um worker_thread para poder ser interrompido por timeout.
 */
export async function extrairDwg(bytes: Uint8Array): Promise<ResultadoExtracao> {
  exigirAssinaturaDwg(bytes);
  return extrairDesenho(bytes, "dwg");
}

/** Também aceita DXF — usado só nos testes, para verificar o que o dxf2dwg perde na fixture. */
export async function extrairDesenho(bytes: Uint8Array, formato: Formato): Promise<ResultadoExtracao> {
  const lib = await carregarLibreDwg();
  return mapearDesenho(lerDesenho(lib, bytes, formato), VERSOES);
}
