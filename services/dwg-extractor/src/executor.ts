import { Worker } from "node:worker_threads";
import { exigirAssinaturaDwg } from "./assinatura.ts";
import type { ResultadoExtracao } from "./contrato.ts";
import { ErroExtracao } from "./erros.ts";
import type { MensagemDoWorker } from "./worker.ts";

export interface OpcoesExecutor {
  /** Prazo total por requisição, contando a espera na fila. */
  timeoutMs: number;
  /** Workers simultâneos — cada um pode ocupar centenas de MB com um DWG grande. */
  concorrencia: number;
}

export type Extrair = (bytes: Uint8Array) => Promise<ResultadoExtracao>;

type Liberar = () => void;

/** Em dev/testes o módulo roda como .ts (tsx/strip-types); no build, como .js em dist/. */
const URL_WORKER = new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url);

/**
 * Cada extração roda num worker_thread novo, encerrado ao fim: o WASM do libredwg é síncrono,
 * então só `terminate()` interrompe um arquivo que trava, e a memória do WASM volta ao SO.
 */
export function criarExecutor({ timeoutMs, concorrencia }: OpcoesExecutor): Extrair {
  const adquirir = criarLimitador(concorrencia);
  return async (bytes) => {
    exigirAssinaturaDwg(bytes); // recusa lixo sem subir worker
    const prazo = AbortSignal.timeout(timeoutMs);
    const liberar = await adquirir(prazo);
    try {
      return await rodarNoWorker(bytes, prazo);
    } finally {
      liberar();
    }
  };
}

function erroDeTimeout(): ErroExtracao {
  return new ErroExtracao("timeout", "Extração excedeu o tempo limite.");
}

function rodarNoWorker(bytes: Uint8Array, prazo: AbortSignal): Promise<ResultadoExtracao> {
  return new Promise((resolve, reject) => {
    if (prazo.aborted) {
      reject(erroDeTimeout());
      return;
    }
    const worker = new Worker(URL_WORKER);
    const encerrar = (concluir: () => void) => {
      prazo.removeEventListener("abort", aoExpirar);
      void worker.terminate();
      concluir();
    };
    const aoExpirar = () => encerrar(() => reject(erroDeTimeout()));
    prazo.addEventListener("abort", aoExpirar, { once: true });
    worker.once("message", (mensagem: MensagemDoWorker) =>
      encerrar(() =>
        mensagem.ok ? resolve(mensagem.resultado) : reject(new ErroExtracao(mensagem.codigo, mensagem.erro)),
      ),
    );
    worker.once("error", (erro) => encerrar(() => reject(new ErroExtracao("falha_interna", erro.message))));
    worker.once("exit", (codigo) =>
      encerrar(() =>
        reject(new ErroExtracao("falha_interna", `Worker encerrou sem resposta (código ${codigo}).`)),
      ),
    );
    // Transfere (não copia) o corpo: `bytes` precisa ser dono do ArrayBuffer inteiro.
    worker.postMessage(bytes, [bytes.buffer as ArrayBuffer]);
  });
}

/** Semáforo FIFO; quem expira na fila desiste com timeout sem ocupar vaga. */
function criarLimitador(maximo: number): (prazo: AbortSignal) => Promise<Liberar> {
  let ativos = 0;
  const fila: Array<() => void> = [];

  const liberarVaga = () => {
    const proximo = fila.shift();
    if (proximo) proximo();
    else ativos--;
  };
  const umaVez = (): Liberar => {
    let liberado = false;
    return () => {
      if (!liberado) {
        liberado = true;
        liberarVaga();
      }
    };
  };

  return (prazo) => {
    if (prazo.aborted) return Promise.reject(erroDeTimeout());
    if (ativos < maximo) {
      ativos++;
      return Promise.resolve(umaVez());
    }
    return new Promise((resolve, reject) => {
      const vez = () => {
        prazo.removeEventListener("abort", desistir);
        resolve(umaVez());
      };
      const desistir = () => {
        fila.splice(fila.indexOf(vez), 1);
        reject(erroDeTimeout());
      };
      fila.push(vez);
      prazo.addEventListener("abort", desistir, { once: true });
    });
  };
}
