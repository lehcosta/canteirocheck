import { parentPort } from "node:worker_threads";
import type { CodigoErro, ResultadoExtracao } from "./contrato.ts";
import { ErroExtracao, mensagemDe } from "./erros.ts";
import { extrairDwg } from "./extrair.ts";

export type MensagemDoWorker =
  | { ok: true; resultado: ResultadoExtracao }
  | { ok: false; codigo: CodigoErro; erro: string };

async function processar(bytes: Uint8Array): Promise<MensagemDoWorker> {
  try {
    return { ok: true, resultado: await extrairDwg(bytes) };
  } catch (erro) {
    const codigo = erro instanceof ErroExtracao ? erro.codigo : "falha_interna";
    return { ok: false, codigo, erro: mensagemDe(erro) };
  }
}

const porta = parentPort;
if (porta) {
  porta.once("message", async (bytes: Uint8Array) => {
    porta.postMessage(await processar(bytes));
  });
}
