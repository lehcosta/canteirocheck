// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: script local da skill, não roda pelo turbo
// Cliente MCP do Paper Desktop por stdio (`paper mcp`), o mesmo servidor que o Claude Code usa.
// Não depende de o MCP estar configurado na sessão: o script sobe o próprio processo.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const BINARIO = process.env.PAPER_BIN ?? join(homedir(), ".paper/bin/paper");

export class Paper {
  #proc;
  #pendentes = new Map();
  #id = 0;
  /** Chamadas de ferramenta feitas: o plano do Paper limita quantas cabem por semana. */
  chamadas = 0;

  static async conectar() {
    const p = new Paper();
    p.#proc = spawn(BINARIO, ["mcp"], { stdio: ["pipe", "pipe", "inherit"] });
    p.#proc.on("error", (e) => {
      for (const { rejeitar } of p.#pendentes.values()) rejeitar(e);
    });
    createInterface({ input: p.#proc.stdout }).on("line", (linha) => {
      if (!linha.trim()) return;
      const msg = JSON.parse(linha);
      const pendente = p.#pendentes.get(msg.id);
      if (!pendente) return;
      p.#pendentes.delete(msg.id);
      if (msg.error) pendente.rejeitar(new Error(`Paper: ${msg.error.message}`));
      else pendente.resolver(msg.result);
    });
    await p.#pedir("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "sincronizar-paper", version: "1" },
    });
    p.#proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    return p;
  }

  #pedir(method, params) {
    const id = ++this.#id;
    return new Promise((resolver, rejeitar) => {
      this.#pendentes.set(id, { resolver, rejeitar });
      this.#proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  /** Chama uma ferramenta e devolve o último bloco de texto como JSON (o primeiro é o cabeçalho do arquivo). */
  async chamar(nome, args) {
    this.chamadas++;
    const r = await this.#pedir("tools/call", { name: nome, arguments: args });
    const textos = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text);
    if (r.isError) throw new Error(`Paper ${nome}: ${textos.join("\n")}`);
    const ultimo = textos.at(-1) ?? "null";
    try {
      return JSON.parse(ultimo);
    } catch {
      return ultimo;
    }
  }

  fechar() {
    this.#proc.stdin.end();
    this.#proc.kill();
  }
}

// ── prancheta e exportação ──────────────────────────────────────────────────────────────────
/**
 * Altura da prancheta no Paper: sempre par. Prancheta de altura ímpar sai exportada meio pixel abaixo,
 * e cada borda de 1px vira duas linhas com metade da cor. A linha a mais fica com o fundo da prancheta,
 * e a comparação (`comparar.mjs`) a recorta.
 */
export const alturaPar = (altura) => Math.ceil(altura / 2) * 2;

/**
 * Exporta pranchetas em PNG 1x numa chamada só. O lote às vezes deixa um nó fora da resposta, sem erro;
 * esse nó é exportado de novo, sozinho. Devolve nodeId → caminho do arquivo e os nós que precisaram
 * dessa segunda tentativa.
 */
export async function exportar(paper, fileId, pageId, ids) {
  const pedir = async (lista) =>
    (
      await paper.chamar("export", {
        fileId,
        pageId,
        nodes: Object.fromEntries(lista.map((id) => [id, [{ format: "png", scale: "1x" }]])),
      })
    ).exports ?? [];
  const caminhos = new Map();
  for (const e of await pedir(ids)) if (e.filePath) caminhos.set(e.nodeId, e.filePath);
  const repetidos = ids.filter((id) => !caminhos.has(id));
  for (const id of repetidos) {
    const e = (await pedir([id])).find((x) => x.nodeId === id);
    if (e?.filePath) caminhos.set(id, e.filePath);
  }
  return { caminhos, repetidos };
}

// ── o arquivo do espelho ────────────────────────────────────────────────────────────────────
/**
 * Um arquivo só para as duas skills: os tokens são do arquivo. Páginas "Claro" e "Escuro" são do
 * espelho (pranchetas com nome de rota, "/..."); "Explorações" é do paper-explorer, cujas pranchetas
 * nunca começam com "/" (a sincronização apaga as "/..." órfãs).
 */
export const ARQUIVO = process.env.PAPER_ARQUIVO ?? "Prumo — espelho do app";

/** Acha o arquivo no time ativo do Paper (abertos, raiz e pastas) ou cria. */
export async function acharArquivo(paper) {
  const fila = [undefined];
  while (fila.length) {
    const pasta = fila.shift();
    const r = await paper.chamar("list_resources", { limit: 200, ...(pasta ? { parentId: pasta } : {}) });
    const achado = r.resources.find((x) => x.type === "file" && x.name === ARQUIVO);
    if (achado) return achado.id;
    for (const x of r.resources) if (x.type === "folder" && !fila.includes(x.id)) fila.push(x.id);
  }
  return (await paper.chamar("create_file", { name: ARQUIVO })).fileId;
}

/**
 * Páginas do arquivo, criadas se faltarem; devolve { nome: pageId }. Num arquivo novo, a "Page 1"
 * vazia vira a primeira delas.
 */
export async function garantirPaginas(paper, fileId, nomes) {
  const info = await paper.chamar("open_file", { fileId });
  const ids = {};
  for (const nome of nomes) {
    let pagina = info.pages.find((p) => p.name === nome);
    if (!pagina) {
      const vazia = info.pages.find(
        (p) => /^Page \d+$/.test(p.name) && info.artboardCount === 0 && p.isActive,
      );
      if (vazia && !Object.values(ids).includes(vazia.id)) {
        await paper.chamar("update_pages", { fileId, updates: [{ pageId: vazia.id, name: nome }] });
        pagina = { id: vazia.id };
      } else {
        const r = await paper.chamar("create_page", { fileId, name: nome });
        pagina = { id: r.pageId ?? r.id }; // formato da resposta não verificado
      }
    }
    ids[nome] = pagina.id;
  }
  return ids;
}

const normalizar = (v) => String(v).toLowerCase().replace(/["']/g, "").trim();
export async function sincronizarTokens(paper, fileId, desejados) {
  const atuais = (await paper.chamar("get_tokens", { fileId })).tokens ?? [];
  const porNome = new Map(atuais.map((t) => [t.name, t]));
  const criar = desejados.filter((t) => !porNome.has(t.name));
  const mudar = desejados.filter(
    (t) => porNome.has(t.name) && normalizar(porNome.get(t.name).value) !== normalizar(t.value),
  );
  const sobras = atuais.filter((t) => !desejados.some((d) => d.name === t.name));
  if (criar.length) await paper.chamar("create_tokens", { fileId, tokens: criar });
  const ajustes = [
    ...mudar.map((t) => ({ name: t.name, value: t.value })),
    ...sobras.map((t) => ({ name: t.name, delete: true })),
  ];
  if (ajustes.length) await paper.chamar("set_tokens", { fileId, tokens: ajustes });
  return { criados: criar.length, alterados: mudar.length, apagados: sobras.length };
}
