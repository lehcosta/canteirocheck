#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: script local da skill, não roda pelo turbo
// Espelha o design do app no Paper, à risca: tokens do CSS do app e uma prancheta por rota e tema,
// com valores medidos no app renderizado. Depois exporta cada prancheta e compara com o gabarito.
//
// uso (da raiz do repositório):
//   node .claude/skills/paper-sync/scripts/sync.mjs [--rotas /login,/obras] [--temas claro,escuro] [--previa]
//     [--estado '/obras/[obraId] · passo 2=/obras/<id>' ...]
// --previa: desenha a conversão no próprio Chrome e compara com o gabarito, sem nenhuma chamada ao Paper.
// --estado: um estado da rota, fotografado na URL dada; a prancheta "<rota> · <estado>" fica abaixo da
//   prancheta da rota. Só sem --rotas e sem --estado a sincronização é completa (e apaga rotas órfãs).
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CRITERIO, comparar } from "./comparar.mjs";
import { converterPagina } from "./conversor.mjs";
import {
  ARQUIVO,
  acharArquivo,
  alturaPar,
  desempilhar,
  ESPACO_ROTAS,
  exportar,
  garantirPaginas,
  Paper,
  relatoDesempilhar,
  sincronizarTokens,
} from "./paper.mjs";
import {
  APP,
  abrirEmRepouso,
  chromium,
  descobrirRotas,
  entrar,
  IDIOMA,
  lerFontes,
  lerTokens,
  resolverRota,
} from "./projeto.mjs";

const PAGINAS = { claro: "Claro", escuro: "Escuro" };
const LARGURA = 1440;
const ALTURA_JANELA = 900;

const { values: opcoes } = parseArgs({
  options: {
    rotas: { type: "string" },
    temas: { type: "string", default: "claro,escuro" },
    previa: { type: "boolean", default: false },
    estado: { type: "string", multiple: true },
  },
});
const TEMAS = opcoes.temas.split(",").map((t) => t.trim());
const SAIDA = join(tmpdir(), "paper-sync", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(join(SAIDA, "recortes"), { recursive: true });

// ── navegador ────────────────────────────────────────────────────────────────────────────
async function capturar(page, url, tema, nomeArquivo) {
  await abrirEmRepouso(page, url, tema);
  const gabarito = join(SAIDA, `${nomeArquivo}-gabarito.png`);
  await page.screenshot({ path: gabarito, fullPage: true, animations: "disabled", caret: "hide" });
  const fontes = await lerFontes(page);
  return { gabarito, fontes };
}

/** Recorta regiões do gabarito (imagens, controles nativos) para o Paper usar como imagem. */
async function recortar(ferramentas, gabarito, recortes, prefixo) {
  if (!recortes.length) return [];
  const src = `data:image/png;base64,${readFileSync(gabarito).toString("base64")}`;
  const urls = await ferramentas.evaluate(
    async ({ src, recortes }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      return recortes.map((r) => {
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(r.w));
        c.height = Math.max(1, Math.round(r.h));
        c.getContext("2d").drawImage(img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
        return c.toDataURL("image/png");
      });
    },
    { src, recortes },
  );
  return urls.map((u, i) => {
    const caminho = join(SAIDA, "recortes", `${prefixo}-${i}.png`);
    writeFileSync(caminho, Buffer.from(u.split(",")[1], "base64"));
    return caminho;
  });
}

const linhaDeLog = (l, sufixo = "") =>
  `${l.status.padEnd(10)} ${String(l.blocosDivergentes).padStart(4)} blocos ${String(l.divergencia).padStart(6)}%  ${l.tema.padEnd(6)} ${l.rota}${sufixo}`;

// ── Paper ────────────────────────────────────────────────────────────────────────────────
const atributo = (v) => String(v).replace(/"/g, "'");
const estiloTxt = (e) =>
  Object.entries(e)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}:${atributo(v)}`)
    .join(";");
const nomeAttr = (no) => (no.nome ? ` layer-name="${atributo(no.nome)}"` : "");

function abrir(no) {
  return `<div${nomeAttr(no)} style="${estiloTxt(no.estilo)}">`;
}
/** `imagem(n)` dá o src do recorte n: paper-asset:// no Paper, data: na prévia. */
function serializar(no, imagem) {
  if (no.tag === "svg")
    return no.bruto.replace(/^<svg/, `<svg${nomeAttr(no)} style="${estiloTxt(no.estilo)}"`);
  if (no.tag === "img") {
    const n = Number(/__RECORTE_(\d+)__/.exec(no.src)[1]);
    return `<img${nomeAttr(no)} src="${imagem(n)}" style="${estiloTxt(no.estilo)}">`;
  }
  if (no.html !== undefined) return `${abrir(no)}${no.html}</div>`;
  return `${abrir(no)}${(no.filhos ?? []).map((f) => serializar(f, imagem)).join("")}</div>`;
}

/** Frame "página" que embrulha a captura inteira: uma escrita por prancheta. */
const paginaDe = (captura) => ({
  tag: "div",
  nome: "página",
  estilo: {
    position: "absolute",
    left: "0px",
    top: "0px",
    width: `${captura.largura}px`,
    height: `${captura.altura}px`,
    "background-color": captura.fundo,
  },
  filhos: captura.secoes,
});

/**
 * Prévia sem gastar cota do Paper: troca o corpo da página do app pelo HTML convertido (as fontes
 * já estão carregadas) e fotografa. O Chrome segue o mesmo CSS que o Paper; o Paper só confirma.
 */
async function renderizarPrevia(page, captura, caminhos, tokens, destino) {
  const dados = caminhos.map((c) => `data:image/png;base64,${readFileSync(c).toString("base64")}`);
  const html = serializar(paginaDe(captura), (n) => dados[n]).replace(
    /color-mix\(var/g,
    "color-mix(in srgb, var",
  );
  const vars = tokens.paper
    .filter((t) => t.type === "color")
    .map((t) => `${t.name}:${t.value}`)
    .join(";");
  await page.evaluate(
    ({ html, vars, largura, altura }) => {
      document.documentElement.classList.remove("dark");
      document.body.innerHTML = `<div id="previa-paper" style="position:relative;width:${largura}px;height:${altura}px;overflow:hidden;${vars}">${html}</div>`;
    },
    { html, vars, largura: captura.largura, altura: captura.altura },
  );
  await page.locator("#previa-paper").screenshot({ path: destino, animations: "disabled", caret: "hide" });
}

/**
 * Escreve um nó numa chamada só: cada write_html conta na cota semanal do MCP do Paper, e uma página
 * inteira costuma caber. Se o HTML passar do tamanho máximo ou o Paper recusar, escreve a casca e depois
 * cada filho dentro dela. Em "replace", esse plano B apaga o alvo e insere a casca em `pai`.
 */
const TAMANHO_MAX = 200_000;
async function escrever(paper, fileId, alvo, modo, no, caminhos, pai) {
  const html = serializar(no, (n) => `paper-asset://${caminhos[n]}`);
  if (html.length <= TAMANHO_MAX || !no.filhos?.length) {
    try {
      await paper.chamar("write_html", { fileId, targetNodeId: alvo, mode: modo, html });
      return;
    } catch (erro) {
      if (!no.filhos?.length || /limit/i.test(erro.message)) throw erro;
      console.log(`o Paper recusou ${Math.round(html.length / 1024)} KB numa escrita; escrevendo em partes`);
    }
  }
  let destino = alvo;
  if (modo === "replace") {
    await paper.chamar("delete_nodes", { fileId, nodeIds: [alvo] });
    destino = pai;
  }
  const r = await paper.chamar("write_html", {
    fileId,
    targetNodeId: destino,
    mode: "insert-children",
    html: `${abrir(no)}</div>`,
  });
  const casca = r.createdNodes[0].id;
  for (const f of no.filhos) await escrever(paper, fileId, casca, "insert-children", f, caminhos, casca);
}

/**
 * Grava a captura numa prancheta. Todo o conteúdo fica num frame "página": na ressincronização ele é
 * trocado de uma vez (write_html replace) e a prancheta mantém nome, posição e comentários.
 */
async function gravarPrancheta(paper, fileId, pageId, existente, nome, captura, caminhos, onde) {
  const pagina = paginaDe(captura);
  // a página tem a altura da tela; a prancheta, a par mais próxima (ver alturaPar)
  const tamanho = { width: `${captura.largura}px`, height: `${alturaPar(captura.altura)}px` };
  if (existente) {
    if (existente.width !== captura.largura || existente.height !== alturaPar(captura.altura)) {
      await paper.chamar("update_styles", {
        fileId,
        updates: [{ nodeIds: [existente.id], styles: tamanho }],
      });
    }
    const filhos = (await paper.chamar("get_children", { fileId, nodeId: existente.id })).children ?? [];
    if (filhos.length === 1 && filhos[0].name === "página") {
      await escrever(paper, fileId, filhos[0].id, "replace", pagina, caminhos, existente.id);
    } else {
      if (filhos.length) await paper.chamar("delete_nodes", { fileId, nodeIds: filhos.map((f) => f.id) });
      await escrever(paper, fileId, existente.id, "insert-children", pagina, caminhos, existente.id);
    }
    return existente.id;
  }
  const criada = await paper.chamar("create_artboard", {
    fileId,
    pageId,
    name: nome,
    styles: { ...tamanho, backgroundColor: captura.fundo, position: "relative" },
  });
  const posicao = { left: `${onde.x}px`, top: `${onde.y}px` };
  await paper.chamar("update_styles", { fileId, updates: [{ nodeIds: [criada.id], styles: posicao }] });
  await escrever(paper, fileId, criada.id, "insert-children", pagina, caminhos, criada.id);
  return criada.id;
}

// ── execução ─────────────────────────────────────────────────────────────────────────────
const todas = descobrirRotas();
const filtro = opcoes.rotas?.split(",").map((r) => r.trim());
const estados = opcoes.estado ?? [];
const completa = !filtro && !estados.length;
const rotas = completa ? todas : todas.filter((r) => filtro?.includes(r));
if (filtro && rotas.length !== filtro.length) {
  console.error(
    `rotas desconhecidas: ${filtro.filter((r) => !todas.includes(r)).join(", ")}\nrotas do app: ${todas.join(", ")}`,
  );
  process.exit(1);
}
/** Prancheta de um estado: "<rota> · <estado>", na URL dada (um registro do banco desta worktree). */
const casaRota = (rota, url) =>
  new RegExp(`^${rota.replace(/\[[^\]]+\]/g, "[^/]+").replace(/[.]/g, "\\.")}/?$`).test(url.split(/[?#]/)[0]);
const alvos = [
  ...rotas.map((rota) => ({ nome: rota, rota })),
  ...estados.map((e) => {
    const i = e.indexOf("=");
    const nome = e.slice(0, i).trim();
    const url = e.slice(i + 1).trim();
    const rota = nome.split(" · ")[0];
    if (
      i < 0 ||
      !nome.includes(" · ") ||
      !todas.includes(rota) ||
      !url.startsWith("/") ||
      !casaRota(rota, url)
    ) {
      console.error(`--estado '${e}': use '<rota> · <estado>=<url da rota>', com uma rota do app`);
      process.exit(1);
    }
    return { nome, rota, url };
  }),
];

const navegador = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
const novoContexto = () =>
  navegador.newContext({
    viewport: { width: LARGURA, height: ALTURA_JANELA },
    deviceScaleFactor: 1,
    locale: IDIOMA,
    reducedMotion: "reduce",
  });
// cada rota é capturada como quem a vê: anônimo se abre sem login (landing, login), admin se pede login
const anonimo = await (await novoContexto()).newPage();
const page = await (await novoContexto()).newPage();
const ferramentas = await anonimo.context().newPage();
const relatorio = [];
let paper = null;

try {
  // 1. captura: tudo no navegador, nenhuma chamada ao Paper
  await entrar(page);
  const cache = new Map();
  const capturas = [];
  let tokens;
  for (const { nome: rota, rota: padrao, url: fixa } of alvos) {
    const url = fixa ?? (await resolverRota(page, padrao, todas, cache));
    if (!url) {
      for (const tema of TEMAS)
        relatorio.push({ rota, tema, status: "sem dados no banco para resolver os parâmetros" });
      continue;
    }
    for (const tema of TEMAS) {
      const nomeArquivo = `${rota.replace(/[/[\]\s·]+/g, "_").replace(/^_|_$/g, "") || "inicio"}-${tema}`;
      await anonimo.goto(APP + url, { waitUntil: "networkidle" });
      const quem = new URL(anonimo.url()).pathname === url ? anonimo : page;
      const { gabarito, fontes } = await capturar(quem, url, tema, nomeArquivo);
      tokens ??= lerTokens(fontes);
      const captura = await quem.evaluate(converterPagina, { cores: tokens.cores });
      writeFileSync(join(SAIDA, `${nomeArquivo}.json`), JSON.stringify(captura, null, 1));
      const caminhos = await recortar(ferramentas, gabarito, captura.recortes, nomeArquivo);
      // a tela no dialeto do Paper: ponto de partida das explorações (paper-explorer)
      writeFileSync(
        join(SAIDA, `${nomeArquivo}.html`),
        serializar(paginaDe(captura), (n) => `paper-asset://${caminhos[n]}`),
      );
      const linha = { rota, url, tema, gabarito, status: "capturada" };
      relatorio.push(linha);
      capturas.push({ linha, nomeArquivo, captura, caminhos });
      if (opcoes.previa) {
        linha.previa = join(SAIDA, `${nomeArquivo}-previa.png`);
        await renderizarPrevia(quem, captura, caminhos, tokens, linha.previa);
        linha.diff = join(SAIDA, `${nomeArquivo}-diff.png`);
        Object.assign(linha, await comparar(ferramentas, gabarito, linha.previa, linha.diff));
        console.log(linhaDeLog(linha, "  (prévia)"));
      }
    }
  }

  // 2. Paper: tokens, uma prancheta por rota em cada página de tema, exportação e comparação
  if (!opcoes.previa && capturas.length) {
    paper = await Paper.conectar();
    const fileId = await acharArquivo(paper);
    const paginas = await garantirPaginas(
      paper,
      fileId,
      TEMAS.map((t) => PAGINAS[t]),
    );
    const t = await sincronizarTokens(paper, fileId, tokens.paper);
    console.log(`tokens: ${t.criados} criados, ${t.alterados} alterados, ${t.apagados} apagados`);

    for (const tema of TEMAS) {
      const pageId = paginas[PAGINAS[tema]];
      const daPagina = capturas.filter((c) => c.linha.tema === tema);
      const pranchetas = (await paper.chamar("get_basic_info", { fileId, pageId })).artboards ?? [];
      const existentes = new Map(pranchetas.map((a) => [a.name, a]));
      // prancheta nova entra no fim da fileira, depois de tudo o que já há na página (o índice da rota
      // muda de um branch para outro e jogava pranchetas diferentes no mesmo lugar)
      let proximoX = pranchetas.length
        ? Math.max(...pranchetas.map((a) => (a.worldX ?? 0) + (a.width ?? 0))) + ESPACO_ROTAS
        : 0;
      // o estado novo entra abaixo da prancheta da rota e dos estados que ela já tem
      const abaixoDaRota = (nome) => {
        const rota = nome.split(" · ")[0];
        const coluna = pranchetas.filter((a) => a.name === rota || a.name.startsWith(`${rota} · `));
        const daRota = coluna.find((a) => a.name === rota);
        if (!daRota) return null;
        return { x: daRota.worldX, y: Math.max(...coluna.map((a) => a.worldY + a.height)) + ESPACO_ROTAS };
      };
      const ids = new Map();
      for (const c of daPagina) {
        const existente = existentes.get(c.linha.rota);
        const onde = (c.linha.rota.includes(" · ") && abaixoDaRota(c.linha.rota)) || { x: proximoX, y: 0 };
        const id = await gravarPrancheta(
          paper,
          fileId,
          pageId,
          existente,
          c.linha.rota,
          c.captura,
          c.caminhos,
          onde,
        );
        ids.set(c, id);
        if (existente) continue;
        pranchetas.push({
          id,
          name: c.linha.rota,
          worldX: onde.x,
          worldY: onde.y,
          width: c.captura.largura,
          height: alturaPar(c.captura.altura),
        });
        if (onde.y === 0) proximoX += c.captura.largura + ESPACO_ROTAS;
      }
      // pranchetas de rotas que sumiram do app saem do Paper (só numa sincronização completa); um estado
      // ("<rota> · …") sai junto com a rota dele, e fica enquanto ela existir
      const orfas = completa
        ? [...existentes.values()].filter(
            (a) => a.name.startsWith("/") && !rotas.includes(a.name.split(" · ")[0]),
          )
        : [];
      if (orfas.length) {
        await paper.chamar("delete_nodes", { fileId, nodeIds: orfas.map((a) => a.id) });
        console.log(`removidas de ${PAGINAS[tema]}: ${orfas.map((a) => a.name).join(", ")}`);
      }
      // cada prancheta no seu lugar: uma rota que cresceu não invade o que está embaixo dela
      console.log(relatoDesempilhar(PAGINAS[tema], await desempilhar(paper, fileId, pageId)));
      if (!ids.size) continue;
      await paper.chamar("finish_working_on_nodes", { fileId, nodeIds: [...ids.values()] });

      const { caminhos, repetidos } = await exportar(paper, fileId, pageId, [...ids.values()]);
      if (repetidos.length) {
        const nomes = [...ids].filter(([, id]) => repetidos.includes(id)).map(([c]) => c.linha.rota);
        console.log(`exportadas de novo, sozinhas (o lote deixou de fora): ${nomes.join(", ")}`);
      }
      for (const [c, id] of ids) {
        const { linha, nomeArquivo } = c;
        const origem = caminhos.get(id);
        if (!origem) {
          linha.status = "sem exportação";
          continue;
        }
        linha.paper = join(SAIDA, `${nomeArquivo}-paper.png`);
        copyFileSync(origem, linha.paper);
        rmSync(origem);
        linha.diff = join(SAIDA, `${nomeArquivo}-diff.png`);
        Object.assign(linha, await comparar(ferramentas, linha.gabarito, linha.paper, linha.diff));
        console.log(linhaDeLog(linha));
      }
    }
  }
} finally {
  const resumo = {
    arquivo: ARQUIVO,
    criterio: CRITERIO,
    chamadasPaper: paper?.chamadas ?? 0,
    rotas: relatorio,
  };
  writeFileSync(join(SAIDA, "relatorio.json"), JSON.stringify(resumo, null, 2));
  for (const l of relatorio.filter((l) => !["à risca", "divergente"].includes(l.status))) {
    console.log(`${l.status}: ${l.tema} ${l.rota}`);
  }
  console.log(
    `\nchamadas ao MCP do Paper: ${resumo.chamadasPaper}\nrelatório: ${join(SAIDA, "relatorio.json")}`,
  );
  paper?.fechar();
  await navegador.close();
}
