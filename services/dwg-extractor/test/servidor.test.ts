import { randomBytes } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarExecutor } from "../src/executor.ts";
import { criarServidor, LIMITE_BYTES_PADRAO, type OpcoesServidor } from "../src/servidor.ts";
import { esquemaResultado } from "./esquema.ts";
import { lerFixture } from "./fixtures.ts";

interface ServidorDeTeste {
  url: string;
  fechar: () => Promise<void>;
}

interface RespostaBruta {
  status: number;
  corpo: unknown;
}

const servidores: ServidorDeTeste[] = [];

async function iniciar(opcoes: Partial<OpcoesServidor> = {}, timeoutMs = 20_000): Promise<ServidorDeTeste> {
  const servidor = criarServidor({
    extrair: criarExecutor({ timeoutMs, concorrencia: 2 }),
    registrar: () => {},
    ...opcoes,
  });
  servidor.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  const { port } = servidor.address() as AddressInfo;
  const iniciado = {
    url: `http://127.0.0.1:${port}`,
    fechar: () => new Promise<void>((resolve) => servidor.close(() => resolve())),
  };
  servidores.push(iniciado);
  return iniciado;
}

function postarDwg(url: string, corpo: Uint8Array, cabecalhos: Record<string, string> = {}) {
  return fetch(`${url}/extrair`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", ...cabecalhos },
    body: corpo,
  });
}

/** node:http em vez de fetch: permite ler a resposta antes de terminar (ou sem enviar) o corpo. */
function postarBruto(
  url: string,
  cabecalhos: Record<string, string | number>,
  corpo: Buffer,
): Promise<RespostaBruta> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${url}/extrair`, { method: "POST", headers: cabecalhos }, async (res) => {
      const partes: Buffer[] = [];
      for await (const parte of res) partes.push(parte as Buffer);
      req.destroy();
      resolve({ status: res.statusCode ?? 0, corpo: JSON.parse(Buffer.concat(partes).toString("utf8")) });
    });
    req.on("error", (erro: NodeJS.ErrnoException) => {
      // O servidor fecha a conexão depois do 413; o resto do upload pode falhar com EPIPE/ECONNRESET.
      if (erro.code !== "EPIPE" && erro.code !== "ECONNRESET") reject(erro);
    });
    req.write(corpo);
  });
}

afterAll(async () => {
  await Promise.all(servidores.map((s) => s.fechar()));
});

describe("servidor HTTP", () => {
  let servidor: ServidorDeTeste;

  beforeAll(async () => {
    servidor = await iniciar();
  });

  it("GET /health responde ok", async () => {
    const res = await fetch(`${servidor.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("POST /extrair com a fixture devolve 200 no formato do contrato e ecoa o X-Request-Id", async () => {
    const res = await postarDwg(servidor.url, lerFixture("amostra.dwg"), { "X-Request-Id": "req-123" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("req-123");
    const corpo = esquemaResultado.parse(await res.json());
    expect(corpo.dwg.versao).toBe("AC1015");
    expect(corpo.insercoes[0]?.atributos).toHaveLength(4);
  });

  it("POST /extrair com bytes aleatórios devolve 400 arquivo_invalido", async () => {
    const res = await postarDwg(servidor.url, new Uint8Array(randomBytes(2048)), {
      "X-Request-Id": "req-400",
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("x-request-id")).toBe("req-400");
    expect(await res.json()).toMatchObject({ codigo: "arquivo_invalido", erro: expect.any(String) });
  });

  it("POST /extrair com assinatura DWG e conteúdo inválido devolve 400 (falha dentro do worker)", async () => {
    const corpo = new Uint8Array(Buffer.concat([Buffer.from("AC1015"), randomBytes(4096)]));
    const res = await postarDwg(servidor.url, corpo);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ codigo: "arquivo_invalido" });
  });

  it("POST /extrair com corpo vazio devolve 400", async () => {
    const res = await postarDwg(servidor.url, new Uint8Array(0));
    expect(res.status).toBe(400);
  });

  it("recusa com 413 um Content-Length acima de 60 MiB sem ler o corpo", async () => {
    const res = await postarBruto(
      servidor.url,
      { "Content-Type": "application/octet-stream", "Content-Length": LIMITE_BYTES_PADRAO + 1 },
      Buffer.from("AC1015"),
    );
    expect(res).toEqual({ status: 413, corpo: { codigo: "arquivo_muito_grande", erro: expect.any(String) } });
  });

  it("rotas desconhecidas devolvem 404", async () => {
    const res = await fetch(`${servidor.url}/nada`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ codigo: "nao_encontrado" });
  });

  it("caminho malformado (GET //) devolve 404 em vez de derrubar o processo", async () => {
    const { hostname, port } = new URL(servidor.url);
    const socket = net.connect(Number(port), hostname);
    socket.end("GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    const partes: Buffer[] = [];
    for await (const parte of socket) partes.push(parte as Buffer);
    expect(Buffer.concat(partes).toString("utf8")).toMatch(/^HTTP\/1\.1 404 /);
  });

  it("continua de pé depois dos erros", async () => {
    const res = await fetch(`${servidor.url}/health`);
    expect(res.status).toBe(200);
  });
});

describe("limites e falhas", () => {
  it("devolve 413 quando um corpo chunked ultrapassa o limite durante a leitura", async () => {
    const { url } = await iniciar({ limiteBytes: 1024 });
    const res = await postarBruto(
      url,
      { "Content-Type": "application/octet-stream", "Transfer-Encoding": "chunked" },
      randomBytes(8192),
    );
    expect(res.status).toBe(413);
  });

  it("devolve 504 timeout quando a extração passa de EXTRAIR_TIMEOUT_MS", async () => {
    const { url } = await iniciar({}, 1);
    const res = await postarDwg(url, lerFixture("amostra.dwg"));
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ codigo: "timeout" });
  });

  it("devolve 500 falha_interna para erros inesperados", async () => {
    const { url } = await iniciar({
      extrair: () => Promise.reject(new Error("boom")),
    });
    const res = await postarDwg(url, lerFixture("amostra.dwg"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ codigo: "falha_interna", erro: "boom" });
  });
});
