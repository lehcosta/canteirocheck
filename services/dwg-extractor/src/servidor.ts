import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { CodigoErro, RespostaErro } from "./contrato.ts";
import { ErroExtracao, mensagemDe } from "./erros.ts";
import type { Extrair } from "./executor.ts";

/** 60 MiB. */
export const LIMITE_BYTES_PADRAO = 60 * 1024 * 1024;

export type Registrar = (registro: Record<string, unknown>) => void;

export interface OpcoesServidor {
  extrair: Extrair;
  limiteBytes?: number;
  registrar?: Registrar;
}

const STATUS_POR_CODIGO: Record<CodigoErro, number> = {
  arquivo_invalido: 400,
  nao_encontrado: 404,
  arquivo_muito_grande: 413,
  falha_interna: 500,
  timeout: 504,
};

const registrarNoConsole: Registrar = (registro) => console.log(JSON.stringify(registro));

export function criarServidor({
  extrair,
  limiteBytes = LIMITE_BYTES_PADRAO,
  registrar = registrarNoConsole,
}: OpcoesServidor) {
  const atender = (req: IncomingMessage, res: ServerResponse) => {
    const inicio = performance.now();
    const requestId = idDaRequisicao(req);
    if (requestId) res.setHeader("X-Request-Id", requestId);
    void rotear(req, res)
      .catch((erro: unknown) => falhaInesperada(res, erro))
      .then((detalhe) => {
        const ms = Math.round(performance.now() - inicio);
        registrar({ metodo: req.method, rota: req.url, status: res.statusCode, ms, requestId, ...detalhe });
      });
  };

  async function rotear(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown>> {
    // Sem `new URL()`: ele lança para caminhos como "//", e uma requisição nunca pode derrubar o processo.
    const caminho = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && caminho === "/health") {
      responderJson(res, 200, { ok: true });
      return {};
    }
    if (req.method === "POST" && caminho === "/extrair") return tratarExtracao(req, res);
    return responderErro(res, new ErroExtracao("nao_encontrado", "Rota não encontrada."));
  }

  async function tratarExtracao(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown>> {
    try {
      const corpo = await lerCorpo(req, limiteBytes);
      const bytes = corpo.byteLength; // o ArrayBuffer é transferido ao worker e fica vazio aqui
      responderJson(res, 200, await extrair(corpo));
      return { bytes };
    } catch (erro) {
      return responderErro(
        res,
        erro instanceof ErroExtracao ? erro : new ErroExtracao("falha_interna", mensagemDe(erro)),
      );
    }
  }

  const servidor = http.createServer(atender);
  // Com "Expect: 100-continue" (curl em uploads grandes), recusa antes de o cliente enviar o corpo.
  servidor.on("checkContinue", (req: IncomingMessage, res: ServerResponse) => {
    if (!excedeLimiteDeclarado(req, limiteBytes)) res.writeContinue();
    atender(req, res);
  });
  return servidor;
}

/** Última barreira: responde 500 se ainda der, senão derruba só esta conexão. */
function falhaInesperada(res: ServerResponse, erro: unknown): Record<string, unknown> {
  if (res.headersSent) {
    res.destroy();
    return { codigo: "falha_interna", erro: mensagemDe(erro) };
  }
  return responderErro(res, new ErroExtracao("falha_interna", mensagemDe(erro)));
}

function idDaRequisicao(req: IncomingMessage): string | undefined {
  const valor = req.headers["x-request-id"];
  const id = (Array.isArray(valor) ? valor[0] : valor)?.trim();
  return id ? id.slice(0, 200) : undefined;
}

function excedeLimiteDeclarado(req: IncomingMessage, limite: number): boolean {
  return Number(req.headers["content-length"] ?? 0) > limite;
}

function erroDeTamanho(limite: number): ErroExtracao {
  return new ErroExtracao("arquivo_muito_grande", `Arquivo maior que o limite de ${limite} bytes.`);
}

function lerCorpo(req: IncomingMessage, limite: number): Promise<Uint8Array> {
  if (excedeLimiteDeclarado(req, limite)) return Promise.reject(erroDeTamanho(limite));
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    const aoReceber = (parte: Buffer) => {
      total += parte.length;
      if (total > limite) {
        req.off("data", aoReceber);
        reject(erroDeTamanho(limite));
        return;
      }
      partes.push(parte);
    };
    req.on("data", aoReceber);
    req.once("end", () => resolve(juntar(partes, total)));
    req.once("error", reject);
  });
}

/** Copia para um ArrayBuffer próprio: o Buffer do Node pode vir do pool e o corpo é transferido ao worker. */
function juntar(partes: Buffer[], total: number): Uint8Array {
  const corpo = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) {
    corpo.set(parte, posicao);
    posicao += parte.length;
  }
  return corpo;
}

function responderJson(res: ServerResponse, status: number, corpo: unknown): void {
  const json = JSON.stringify(corpo);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function responderErro(res: ServerResponse, erro: ErroExtracao): Record<string, unknown> {
  const corpo: RespostaErro = { erro: erro.message, codigo: erro.codigo };
  // O corpo não lido é descartado; fechar a conexão evita reaproveitá-la no meio de um upload.
  if (erro.codigo === "arquivo_muito_grande") res.setHeader("Connection", "close");
  responderJson(res, STATUS_POR_CODIGO[erro.codigo], corpo);
  return { codigo: erro.codigo, erro: erro.message };
}
