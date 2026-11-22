#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: script local da skill, não roda pelo turbo
// Estudos de uma tela, fluxo ou elemento: desenha no Chrome para criticar (sem cota do Paper), grava no
// Paper para o usuário aprovar, e confere o executivo. Se a rota já está no espelho, a exploração — tela cheia
// ou elemento — desenha na página "Claro", abaixo da prancheta da rota (modo projeto), como o sincronizar-paper;
// só uma tela que o espelho ainda não tem vai para "Explorações".
//
// uso (da raiz do repositório), com <pasta> = .claude/skills/paper-explorer/exploracoes/<nome>:
//   explorar.mjs previa <pasta>                  desenha, confere o dialeto e a marca, monta o comparativo
//   explorar.mjs enviar <pasta>                  grava os estudos no Paper e imprime o link da página
//   explorar.mjs comentarios <pasta>             comentários abertos da página "Explorações"
//   explorar.mjs resolver <pasta> <threadId>...  marca comentários atendidos como resolvidos
//   explorar.mjs aprovar <pasta> <id>|todos      no modo projeto a exploração sai do Claro (tela cheia: a
//                                                variação toma o lugar da rota antes); senão marca ✓. Estados: todos
//   explorar.mjs conferir <pasta> [id]           compara o app (a rota, em repouso) com o estudo aprovado,
//                                                ou com o estado id
// <pasta> tem o exploracao.json e um .html por tela (formato em FORMATO.md).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CRITERIO, comparar } from "../../sincronizar-paper/scripts/comparar.mjs";
import {
  ARQUIVO,
  acharArquivo,
  alturaPar,
  desempilhar,
  exportar,
  garantirPaginas,
  Paper,
  relatoDesempilhar,
  sincronizarTokens,
} from "../../sincronizar-paper/scripts/paper.mjs";
import {
  APP,
  abrirEmRepouso,
  chromium,
  descobrirRotas,
  entrar,
  lerFontesNext,
  lerTokens,
  resolverRota,
} from "../../sincronizar-paper/scripts/prumo.mjs";

const ESPACO = 80;
const ESPACO_LINHAS = 200;
/** Sufixo das pranchetas do estudo aprovado no Paper. */
const APROVADO = " ✓";

const COMANDOS = ["previa", "enviar", "comentarios", "resolver", "aprovar", "conferir"];
const [comando, pastaArg, ...resto] = process.argv.slice(2);
if (!COMANDOS.includes(comando) || !pastaArg) {
  console.error(`uso: explorar.mjs ${COMANDOS.join("|")} <pasta> [...]`);
  process.exit(1);
}
const PASTA = resolve(pastaArg);

// ── manifesto ────────────────────────────────────────────────────────────────────────────
function lerManifesto() {
  const m = JSON.parse(readFileSync(join(PASTA, "exploracao.json"), "utf8"));
  const erros = [];
  // o Paper corta nome de camada em 50 caracteres; "<nome> · legenda" precisa caber inteiro
  if (!m.nome || m.nome.startsWith("/") || m.nome.length > 30) {
    erros.push('"nome" é obrigatório, tem até 30 caracteres e não começa com "/" (prefixo das pranchetas)');
  }
  if (!m.pergunta) erros.push('"pergunta" é obrigatória');
  // um conjunto de estados (skill paper-states) usa a chave "estados"; por dentro, os itens ficam em variacoes
  const estados = m.tipo === "estados";
  if (estados) m.variacoes = m.estados;
  const ids = new Set();
  for (const v of m.variacoes ?? []) {
    if (ids.has(v.id)) erros.push(`id repetido: ${v.id}`);
    ids.add(v.id);
    if (estados) {
      if (!v.estado) erros.push(`${v.id}: falta o estado (o que a tela mostra)`);
      if (!v.quando) erros.push(`${v.id}: falta o quando (o que leva a tela a esse estado)`);
    } else {
      if (!v.partido) erros.push(`${v.id}: falta o partido`);
      if (v.id !== "atual" && !v.eixo) erros.push(`${v.id}: falta o eixo`);
    }
    if (!v.telas?.length) erros.push(`${v.id}: nenhuma tela`);
    for (const t of v.telas ?? [])
      if (!existsSync(join(PASTA, t))) erros.push(`${v.id}: arquivo ${t} não existe`);
  }
  if (estados && !m.variacoes?.length) erros.push('"estados" está vazio');
  if (!estados && (m.variacoes ?? []).filter((v) => v.id !== "atual").length < 3) {
    erros.push("menos de 3 variações além do atual");
  }
  if (erros.length) throw new Error(`exploracao.json:\n  ${erros.join("\n  ")}`);
  return m;
}

function gravarManifesto(m) {
  const { variacoes, ...resto } = m;
  const conteudo = m.tipo === "estados" ? { ...resto, estados: variacoes } : { ...resto, variacoes };
  writeFileSync(join(PASTA, "exploracao.json"), `${JSON.stringify(conteudo, null, 1)}\n`);
}

/** Página clara do espelho, onde cada rota do app tem a sua prancheta (como no sincronizar-paper). */
const ESPELHO_CLARO = "Claro";

/** Página do Paper: estudos em "Explorações", conjuntos de estados em "Estados". */
const paginaDe = (m) => (m.tipo === "estados" ? "Estados" : "Explorações");

/**
 * Onde a exploração mora no espelho e como a aprovação se comporta:
 * - "estados": página "Estados" (paper-states).
 * - "projeto": a `rota` já tem prancheta no espelho. As variações são desenhadas na página "Claro", abaixo
 *   dela, como o sincronizar-paper desenha cada rota — seja a tela cheia ou um elemento dela. `substitui` é
 *   true só na tela cheia (sem `ancora`, uma tela por variação): ao aprovar, a aprovada toma o lugar da rota.
 *   Num elemento ou fluxo (substitui false), a aprovação apenas limpa a exploração do projeto.
 * - "explor": uma tela que o espelho ainda não tem (rota nova) — página "Explorações".
 */
async function destino(paper, fileId, manifesto) {
  if (manifesto.tipo === "estados") {
    return {
      modo: "estados",
      PAGINA: "Estados",
      pageId: (await garantirPaginas(paper, fileId, ["Estados"])).Estados,
    };
  }
  if (manifesto.rota) {
    const pageId = (await garantirPaginas(paper, fileId, [ESPELHO_CLARO]))[ESPELHO_CLARO];
    const info = await paper.chamar("get_basic_info", { fileId, pageId });
    const rota = (info.artboards ?? []).find((a) => a.name === manifesto.rota);
    if (rota) {
      const substitui =
        !manifesto.ancora &&
        manifesto.variacoes.every((v) => v.id === "atual" || (v.telas?.length === 1 && !v.ancora));
      return { modo: "projeto", PAGINA: ESPELHO_CLARO, pageId, rota, substitui, url: info.url };
    }
  }
  return {
    modo: "explor",
    PAGINA: "Explorações",
    pageId: (await garantirPaginas(paper, fileId, ["Explorações"])).Explorações,
  };
}

/** Nome da página do espelho onde a exploração está, para as mensagens. */
const nomePagina = (m) => (m.paper?.modo === "projeto" ? ESPELHO_CLARO : paginaDe(m));
/** Título e linha de apoio de cada item na legenda e no comparativo. */
const tituloDe = (v) => v.partido ?? v.estado;
const apoioDe = (v) => (v.eixo ? `eixo: ${v.eixo}` : v.quando ? `quando: ${v.quando}` : "ponto de partida");

/**
 * Traz para a pasta as imagens que as telas usam (os recortes da captura ficam no $TMPDIR, que o sistema
 * limpa): a aprovação pode chegar dias depois do envio.
 */
function trazerAssets(manifesto) {
  const destino = join(PASTA, "assets");
  for (const t of manifesto.variacoes.flatMap((v) => v.telas)) {
    const arquivo = join(PASTA, t);
    const html = readFileSync(arquivo, "utf8");
    const novo = html.replace(/paper-asset:\/\/([^"')\s]+)/g, (inteiro, caminho) => {
      if (caminho.startsWith(`${PASTA}/`) || !existsSync(caminho)) return inteiro;
      mkdirSync(destino, { recursive: true });
      // a pasta da captura entra no nome: duas capturas têm recortes com o mesmo nome
      const copia = join(destino, `${basename(dirname(dirname(caminho)))}-${basename(caminho)}`);
      copyFileSync(caminho, copia);
      return `paper-asset://${copia}`;
    });
    if (novo !== html) writeFileSync(arquivo, novo);
  }
}

/** Tamanho da tela, lido do estilo do elemento raiz. */
function tamanho(html) {
  const raiz = /^\s*<div[^>]*style="([^"]*)"/.exec(html)?.[1] ?? "";
  const w = /(?:^|;)\s*width:\s*([\d.]+)px/.exec(raiz)?.[1];
  const h = /(?:^|;)\s*height:\s*([\d.]+)px/.exec(raiz)?.[1];
  return w && h ? { largura: Math.round(Number(w)), altura: Math.round(Number(h)) } : null;
}

// ── dialeto do Paper e marca: checagem no texto do HTML ─────────────────────────────────────
const PROIBIDO = [
  [/(^|[;"\s])margin(-[a-z]+)?\s*:/i, "margin (use padding e gap)"],
  [/display\s*:\s*grid/i, "display: grid (use flex)"],
  [/display\s*:\s*inline\s*[;"]/i, "display: inline"],
  [/<(table|tr|td|th|tbody|thead)\b/i, "tabela HTML (use flex)"],
  [/<(script|style|link)\b/i, "script/style/link (só estilo inline)"],
];
const PROPS_COR =
  /^(color|background(-color)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|fill|stroke)$/;
const COR_LITERAL = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\(/i;

function checarTexto(arquivo, html) {
  const erros = [];
  const avisos = [];
  for (const [re, msg] of PROIBIDO) if (re.test(html)) erros.push(msg);
  if (!tamanho(html)) erros.push('o elemento raiz precisa de "width" e "height" em px no style');
  const literais = new Set();
  for (const [, estilo] of html.matchAll(/style="([^"]*)"/g)) {
    for (const decl of estilo.split(";")) {
      const [prop, ...resto] = decl.split(":");
      const valor = resto.join(":").replace(/var\([^)]*\)/g, "");
      if (PROPS_COR.test(prop?.trim().toLowerCase() ?? "") && COR_LITERAL.test(valor))
        literais.add(decl.trim());
    }
  }
  for (const [, , valor] of html.matchAll(/\s(fill|stroke)="([^"]*)"/g)) {
    if (COR_LITERAL.test(valor.replace(/var\([^)]*\)/g, ""))) literais.add(valor);
  }
  if (literais.size) {
    avisos.push(`cor fora dos tokens (${literais.size}): ${[...literais].slice(0, 4).join(" | ")}`);
  }
  return { arquivo, erros, avisos };
}

// ── navegador ────────────────────────────────────────────────────────────────────────────
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const comAssets = (html) =>
  html.replace(/paper-asset:\/\/([^"')\s]+)/g, (_, caminho) =>
    existsSync(caminho) ? `data:image/png;base64,${readFileSync(caminho).toString("base64")}` : caminho,
  );

/**
 * Desenha a tela numa página do app (as fontes da marca já estão carregadas), fotografa e confere
 * o que só o desenho mostra: texto vazando da caixa, fonte ou peso que a marca não carrega e
 * elemento fora da prancheta.
 */
async function desenhar(page, html, vars, destino) {
  const { largura, altura } = tamanho(html);
  const corpo = comAssets(html).replace(/color-mix\(var/g, "color-mix(in srgb, var");
  const problemas = await page.evaluate(
    async ({ corpo, vars, largura, altura }) => {
      document.documentElement.classList.remove("dark");
      document.body.innerHTML = `<div id="tela" style="position:relative;width:${largura}px;height:${altura}px;overflow:hidden;${vars}">${corpo}</div>`;
      await document.fonts.ready;
      const faces = new Set(
        [...document.fonts]
          .filter((f) => f.status === "loaded")
          .map((f) => `${f.family.replace(/["']/g, "")}|${f.weight}`),
      );
      const tela = document.getElementById("tela").getBoundingClientRect();
      const achados = new Set();
      for (const el of document.querySelectorAll("#tela *")) {
        if (el.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
        const cs = getComputedStyle(el);
        const texto = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
        const r = el.getBoundingClientRect();
        const trecho = el.textContent.trim().slice(0, 40);
        if (texto) {
          const familia = cs.fontFamily.split(",")[0].trim().replace(/["']/g, "");
          if (!faces.has(`${familia}|${cs.fontWeight}`))
            achados.add(`fonte fora da marca: ${familia} ${cs.fontWeight} ("${trecho}")`);
          // na vertical, só uma linha a mais conta: entrelinha justa (título 48/48) estoura o glifo sem vazar
          const linha = Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.2;
          const vazaX = el.scrollWidth > el.clientWidth + 1;
          const vazaY = el.scrollHeight - el.clientHeight > linha / 2;
          if (cs.display !== "inline" && (vazaX || vazaY)) {
            achados.add(`texto vaza da caixa: "${trecho}"`);
          }
        }
        if (
          r.width &&
          (r.right > tela.right + 1 ||
            r.bottom > tela.bottom + 1 ||
            r.left < tela.left - 1 ||
            r.top < tela.top - 1)
        ) {
          achados.add(`fora da prancheta: <${el.tagName.toLowerCase()}> "${trecho}"`);
        }
      }
      return [...achados];
    },
    { corpo, vars, largura, altura },
  );
  await page.locator("#tela").screenshot({ path: destino, animations: "disabled", caret: "hide" });
  return problemas;
}

/** Uma imagem com todas as variações: uma linha por variação, telas lado a lado, com o partido. */
async function comparativo(page, manifesto, destino) {
  const ALTURA_LINHA = 360;
  const img = (t) =>
    `data:image/png;base64,${readFileSync(join(PASTA, t.replace(/\.html$/, ".png"))).toString("base64")}`;
  const linhas = manifesto.variacoes
    .map(
      (
        v,
      ) => `<div style="display:flex;gap:24px;align-items:flex-start;padding:24px 0;border-top:1px solid #dad6cd">
        <div style="width:280px;flex-shrink:0;font-family:'IBM Plex Sans';color:#191816">
          <div style="font-family:Archivo;font-weight:800;font-size:28px">${esc(v.id)}</div>
          <div style="font-size:16px;line-height:22px;margin-top:6px">${esc(tituloDe(v))}</div>
          <div style="font-size:13px;color:#57544d;margin-top:8px">${esc(apoioDe(v))}</div>
        </div>
        ${v.telas.map((t) => `<img src="${img(t)}" style="height:${ALTURA_LINHA}px;border:1px solid #dad6cd">`).join("")}
      </div>`,
    )
    .join("");
  // na página do app, onde as fontes da marca já estão carregadas
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.evaluate(
    (conteudo) => {
      document.body.innerHTML = `<div id="comparativo" style="padding:32px;background:#f4f3ef;width:max-content">${conteudo}</div>`;
      return document.fonts.ready;
    },
    `<div style="font-family:Archivo;font-weight:800;font-size:36px;color:#191816">${esc(manifesto.nome)}</div>
      <div style="font-family:'IBM Plex Sans';font-size:18px;color:#57544d;margin:8px 0 16px;max-width:1200px">${esc(manifesto.pergunta)}</div>
      ${linhas}`,
  );
  await page.locator("#comparativo").screenshot({ path: destino });
}

// ── Paper ────────────────────────────────────────────────────────────────────────────────

function legenda(manifesto) {
  const itens = manifesto.variacoes
    .map(
      (v) => `<div style="display:flex;gap:16px;width:1040px">
        <div style="width:96px;flex-shrink:0;font-family:Archivo;font-weight:800;font-size:24px;line-height:32px;color:var(--color-ink)">${esc(v.id)}</div>
        <div style="width:928px;flex-shrink:0;display:flex;flex-direction:column;gap:4px">
          <div style="font-family:'IBM Plex Sans';font-weight:400;font-size:18px;line-height:28px;color:var(--color-ink)">${esc(tituloDe(v))}</div>
          <div style="font-family:'IBM Plex Sans';font-weight:400;font-size:14px;line-height:20px;color:var(--color-ink-muted)">${esc(apoioDe(v))}</div>
        </div>
      </div>`,
    )
    .join("");
  return `<div layer-name="legenda" style="position:absolute;left:0px;top:0px;width:1120px;display:flex;flex-direction:column;gap:24px;padding:40px;background-color:var(--color-surface-raised)">
    <div style="font-family:Archivo;font-weight:800;font-size:40px;line-height:44px;color:var(--color-ink)">${esc(manifesto.nome)}</div>
    <div style="width:1040px;font-family:'IBM Plex Sans';font-weight:400;font-size:18px;line-height:28px;color:var(--color-ink-muted)">${esc(manifesto.pergunta)}</div>
    ${itens}
  </div>`;
}

/** Altura real da legenda, medida no Chrome: o texto dos partidos quebra em quantas linhas precisar. */
async function medirLegenda(page, html, vars) {
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  return page.evaluate(
    async ({ html, vars }) => {
      document.body.innerHTML = `<div style="position:relative;${vars}">${html}</div>`;
      await document.fonts.ready;
      return Math.ceil(document.body.firstElementChild.firstElementChild.getBoundingClientRect().height);
    },
    { html, vars },
  );
}

async function enviar(page, manifesto, tokens, vars, ferramentas) {
  const htmlLegenda = legenda(manifesto);
  const alturaLegenda = await medirLegenda(page, htmlLegenda, vars);
  const paper = await Paper.conectar();
  try {
    const fileId = await acharArquivo(paper);
    await sincronizarTokens(paper, fileId, tokens.paper);
    const alvo = await destino(paper, fileId, manifesto);
    const { modo, PAGINA, pageId } = alvo;

    // reenvio: as pranchetas desta exploração saem e voltam no mesmo lugar
    const prefixo = `${manifesto.nome} · `;
    const info = await paper.chamar("get_basic_info", { fileId, pageId });
    const pranchetas = info.artboards ?? [];
    const antigas = pranchetas.filter((a) => a.name.startsWith(prefixo));
    // modo projeto: as variações ancoram abaixo da prancheta da rota e dos estados dela ("<rota> · …", do
    // sincronizar --estado). Senão: abaixo do que já há na página.
    let baseX = 0;
    let baseY;
    if (modo === "projeto") {
      baseX = alvo.rota.worldX ?? 0;
      const coluna = [alvo.rota, ...pranchetas.filter((a) => a.name.startsWith(`${alvo.rota.name} · `))];
      baseY = Math.max(...coluna.map((a) => (a.worldY ?? 0) + (a.height ?? 0))) + ESPACO_LINHAS;
    } else {
      const outras = pranchetas.filter((a) => !a.name.startsWith(prefixo));
      baseY = antigas.length
        ? Math.min(...antigas.map((a) => a.worldY ?? 0))
        : outras.length
          ? Math.max(...outras.map((a) => (a.worldY ?? 0) + (a.height ?? 0))) + 400
          : 0;
    }
    if (antigas.length) await paper.chamar("delete_nodes", { fileId, nodeIds: antigas.map((a) => a.id) });
    // se a exploração trocou de página (ex.: a rota passou a existir no espelho), limpa a página anterior
    const paginaAnterior = manifesto.paper?.pageId;
    if (paginaAnterior && paginaAnterior !== pageId) {
      const lá = (await paper.chamar("get_basic_info", { fileId, pageId: paginaAnterior })).artboards ?? [];
      const orfas = lá.filter((a) => a.name.startsWith(prefixo));
      if (orfas.length) await paper.chamar("delete_nodes", { fileId, nodeIds: orfas.map((a) => a.id) });
    }

    const criar = async (nome, largura, altura, left, top, html) => {
      const { id } = await paper.chamar("create_artboard", {
        fileId,
        pageId,
        name: nome,
        styles: { width: `${largura}px`, height: `${alturaPar(altura)}px`, position: "relative" },
      });
      await paper.chamar("update_styles", {
        fileId,
        updates: [{ nodeIds: [id], styles: { left: `${left}px`, top: `${top}px` } }],
      });
      await paper.chamar("write_html", { fileId, targetNodeId: id, mode: "insert-children", html });
      return id;
    };

    const ids = [];
    ids.push(await criar(`${prefixo}legenda`, 1120, alturaLegenda, baseX, baseY, htmlLegenda));
    let y = baseY + alturaLegenda + ESPACO_LINHAS;
    const telas = [];
    // na tela cheia o "atual" já é a prancheta da rota, logo acima; não se redesenha. No elemento, sim.
    const variacoes =
      modo === "projeto" && alvo.substitui
        ? manifesto.variacoes.filter((v) => v.id !== "atual")
        : manifesto.variacoes;
    for (const v of variacoes) {
      let x = baseX;
      let alturaLinha = 0;
      for (const [i, t] of v.telas.entries()) {
        const html = readFileSync(join(PASTA, t), "utf8");
        const { largura, altura } = tamanho(html);
        const id = await criar(`${prefixo}${v.id} · ${i + 1}`, largura, altura, x, y, html);
        ids.push(id);
        telas.push({ id, t });
        x += largura + ESPACO;
        alturaLinha = Math.max(alturaLinha, altura);
      }
      y += alturaLinha + ESPACO_LINHAS;
    }
    await paper.chamar("finish_working_on_nodes", { fileId, nodeIds: ids });
    // cada prancheta no seu lugar: a exploração que caiu sobre outra (ou sob uma rota que cresceu) desce
    console.log(relatoDesempilhar(PAGINA, await desempilhar(paper, fileId, pageId)));

    // conferência: cada prancheta exportada do Paper contra a prévia do Chrome
    const { caminhos, repetidos } = await exportar(
      paper,
      fileId,
      pageId,
      telas.map(({ id }) => id),
    );
    if (repetidos.length) {
      const nomes = telas.filter(({ id }) => repetidos.includes(id)).map(({ t }) => t);
      console.log(`exportadas de novo, sozinhas (o lote deixou de fora): ${nomes.join(", ")}`);
    }
    for (const { id, t } of telas) {
      const origem = caminhos.get(id);
      const base = join(PASTA, t.replace(/\.html$/, ""));
      if (!origem) {
        console.log(`sem exportação  ${t}`);
        continue;
      }
      copyFileSync(origem, `${base}-paper.png`);
      rmSync(origem);
      const r = await comparar(ferramentas, `${base}.png`, `${base}-paper.png`, `${base}-diff.png`);
      console.log(
        `${r.status.padEnd(10)} ${String(r.blocosDivergentes).padStart(4)} blocos  ${t}  (diff: ${base}-diff.png)`,
      );
    }
    // aprovação e conferência voltam a esta página sem procurar o arquivo; um reenvio pede aprovação nova
    manifesto.paper = {
      fileId,
      pageId,
      url: info.url,
      modo,
      rota: manifesto.rota,
      substitui: !!alvo.substitui,
    };
    delete manifesto.aprovado;
    gravarManifesto(manifesto);
    const onde =
      modo === "projeto" ? `abaixo da rota ${manifesto.rota} na página "${PAGINA}"` : `na página "${PAGINA}"`;
    const aoAprovar =
      modo === "projeto"
        ? alvo.substitui
          ? "\nao aprovar, a variação toma o lugar da rota no espelho Claro (o Escuro fica para o executivo)"
          : "\nao aprovar, a exploração sai do projeto (o executivo implementa o elemento)"
        : "";
    console.log(
      `\n${manifesto.tipo === "estados" ? "estados" : "estudos"} ${onde} do arquivo "${ARQUIVO}": ` +
        `${info.url ?? "(o Paper não deu o link)"}${aoAprovar}` +
        `\nchamadas ao MCP do Paper: ${paper.chamadas}`,
    );
  } finally {
    paper.fechar();
  }
}

// ── aprovação ────────────────────────────────────────────────────────────────────────────
/** Arquivo e página da exploração no Paper, gravados pelo enviar. */
function noPaper(manifesto) {
  if (!manifesto.paper?.fileId) throw new Error("a exploração ainda não foi enviada ao Paper: rode enviar");
  return manifesto.paper;
}

/**
 * Comentários abertos da página "Explorações", cada um com a prancheta onde está (quando o nó dela aparece
 * no comentário) e o comentário inteiro em JSON.
 */
async function comentarios(manifesto) {
  const { fileId, pageId } = noPaper(manifesto);
  const prefixo = `${manifesto.nome} · `;
  const paper = await Paper.conectar();
  try {
    const r = await paper.chamar("list_comment_threads", {
      fileId,
      pageId,
      status: "open",
      previewLength: 1000,
    });
    const threads = r.commentThreads ?? [];
    if (!threads.length) {
      console.log(`nenhum comentário aberto na página "${nomePagina(manifesto)}"`);
      return;
    }
    const pranchetas = (await paper.chamar("get_basic_info", { fileId, pageId })).artboards ?? [];
    for (const t of threads) {
      const json = JSON.stringify(t);
      const onde = pranchetas.find((a) => json.includes(`"${a.id}"`) || json.includes(a.name));
      const lugar = !onde
        ? "prancheta não identificada (veja o nó no JSON)"
        : onde.name.startsWith(prefixo)
          ? onde.name
          : `${onde.name} (outra exploração)`;
      console.log(`${t.id ?? t.commentThreadId ?? t.threadId ?? "?"}  ${lugar}\n  ${json}`);
    }
  } finally {
    console.log(`chamadas ao MCP do Paper: ${paper.chamadas}`);
    paper.fechar();
  }
}

async function resolver(manifesto, ids) {
  if (!ids.length) throw new Error("passe os ids dos comentários atendidos");
  const { fileId } = noPaper(manifesto);
  const paper = await Paper.conectar();
  try {
    for (const id of ids) {
      await paper.chamar("set_comment_thread_status", { fileId, commentThreadId: id, status: "resolved" });
      console.log(`resolvido  ${id}`);
    }
  } finally {
    paper.fechar();
  }
}

/**
 * Só o estudo aprovado leva a marca no Paper; quem tinha sido aprovado antes a perde. Um conjunto de estados é
 * aprovado inteiro (`todos`): os ajustes de um estado voltam pelo reenvio, antes da aprovação.
 */
async function aprovar(manifesto, id) {
  const estados = manifesto.tipo === "estados";
  const ids = manifesto.variacoes.map((v) => v.id).filter((v) => v !== "atual");
  if (estados && id !== "todos")
    throw new Error("num conjunto de estados, aprove todos: aprovar <pasta> todos");
  if (!estados && !ids.includes(id))
    throw new Error(`estudo desconhecido: ${id ?? "(nenhum)"}; estudos: ${ids.join(", ")}`);
  const { fileId, pageId, modo, rota, substitui } = noPaper(manifesto);
  const prefixo = `${manifesto.nome} · `;
  const paper = await Paper.conectar();
  try {
    if (modo === "projeto")
      return await aprovarProjeto(paper, manifesto, id, { fileId, pageId, rota, substitui, prefixo });
    // Explorações/Estados: só o estudo aprovado leva ✓; quem tinha sido aprovado antes a perde
    const marca = (base) =>
      estados
        ? base.startsWith(prefixo) && !base.endsWith(" · legenda")
        : base.startsWith(`${prefixo}${id} · `);
    const pranchetas = ((await paper.chamar("get_basic_info", { fileId, pageId })).artboards ?? []).filter(
      (a) => a.name.startsWith(prefixo),
    );
    const updates = [];
    for (const a of pranchetas) {
      const base = a.name.endsWith(APROVADO) ? a.name.slice(0, -APROVADO.length) : a.name;
      const nome = marca(base) ? base + APROVADO : base;
      if (nome !== a.name) updates.push({ nodeId: a.id, name: nome });
    }
    if (!pranchetas.some((a) => marca(a.name.replace(APROVADO, ""))))
      throw new Error(`as pranchetas de ${id} não estão no Paper: rode enviar`);
    if (updates.length) await paper.chamar("rename_nodes", { fileId, updates });
    manifesto.aprovado = id;
    gravarManifesto(manifesto);
    console.log(`aprovado: ${id}  (${updates.map((u) => u.name).join(", ") || "já estava marcado"})`);
  } finally {
    console.log(`chamadas ao MCP do Paper: ${paper.chamadas}`);
    paper.fechar();
  }
}

/**
 * Modo projeto: a exploração sai do projeto ao aprovar. Na tela cheia (`substitui`), antes disso a variação
 * aprovada toma o lugar da prancheta da rota no espelho Claro — um mock, até o executivo re-sincronizar a tela
 * real; o Escuro espera o executivo. Num elemento, só a limpeza: o executivo implementa o elemento no app.
 */
async function aprovarProjeto(paper, manifesto, id, { fileId, pageId, rota, substitui, prefixo }) {
  const pranchetas = (await paper.chamar("get_basic_info", { fileId, pageId })).artboards ?? [];
  const explor = pranchetas.filter((a) => a.name.startsWith(prefixo));
  if (!explor.some((a) => a.name.startsWith(`${prefixo}${id} · `)))
    throw new Error(`as pranchetas de ${id} não estão no Paper: rode enviar`);
  if (substitui) {
    const alvo = pranchetas.find((a) => a.name === rota);
    if (!alvo) throw new Error(`a rota ${rota} não está no espelho Claro: rode o sincronizar-paper`);
    const v = manifesto.variacoes.find((x) => x.id === id);
    const html = readFileSync(join(PASTA, v.telas[0]), "utf8");
    const { largura, altura } = tamanho(html);
    // a rota recebe a tela da variação: troca o tamanho, apaga o conteúdo e grava a tela crua (como o enviar)
    await paper.chamar("update_styles", {
      fileId,
      updates: [{ nodeIds: [alvo.id], styles: { width: `${largura}px`, height: `${alturaPar(altura)}px` } }],
    });
    const filhos = (await paper.chamar("get_children", { fileId, nodeId: alvo.id })).children ?? [];
    if (filhos.length) await paper.chamar("delete_nodes", { fileId, nodeIds: filhos.map((f) => f.id) });
    await paper.chamar("write_html", { fileId, targetNodeId: alvo.id, mode: "insert-children", html });
    await paper.chamar("finish_working_on_nodes", { fileId, nodeIds: [alvo.id] });
  }
  if (explor.length) await paper.chamar("delete_nodes", { fileId, nodeIds: explor.map((a) => a.id) });
  // a rota que recebeu a variação pode ter crescido sobre o que está embaixo dela
  if (substitui) console.log(relatoDesempilhar(ESPELHO_CLARO, await desempilhar(paper, fileId, pageId)));
  manifesto.aprovado = id;
  gravarManifesto(manifesto);
  console.log(
    substitui
      ? `aprovado: ${id} — a rota ${rota} recebeu a variação no espelho Claro (mock) e a exploração saiu.\no Escuro fica para o executivo: implemente no app e rode o sincronizar-paper.`
      : `aprovado: ${id} — a exploração saiu do projeto. Implemente o elemento no app (o executivo) e rode o sincronizar-paper.`,
  );
}

/**
 * Prova do executivo: a rota do app, em repouso e no tema do estudo, contra a prévia do estudo aprovado.
 * Num conjunto de estados, prova o estado `id`, com a `rota` dele quando tem uma (`/login?erro=link`); o
 * resto do estado (banco, papel do usuário com PAPER_EMAIL) é preparado antes. Num elemento, a foto começa
 * no topo da `ancora` e tem a altura do estudo.
 */
async function conferir(navegador, ferramentas, manifesto, idPedido) {
  const estados = manifesto.tipo === "estados";
  if (estados && manifesto.aprovado !== "todos")
    throw new Error("os estados ainda não foram aprovados: aprovar <pasta> todos");
  if (estados && !idPedido) throw new Error("diga qual estado conferir: conferir <pasta> <id>");
  const v = manifesto.variacoes.find((x) => x.id === (estados ? idPedido : manifesto.aprovado));
  if (!v)
    throw new Error(
      estados ? `estado desconhecido: ${idPedido}` : "nenhum estudo aprovado: rode aprovar <id> antes",
    );
  const rota = v.rota ?? manifesto.rota;
  if (!rota) throw new Error('falta "rota" no exploracao.json: a rota do app onde a tela vive');
  const tela = v.telas[0];
  const base = join(PASTA, tela.replace(/\.html$/, ""));
  const { largura, altura } = tamanho(readFileSync(join(PASTA, tela), "utf8"));
  const contexto = await navegador.newContext({
    viewport: { width: largura, height: largura < 600 ? 844 : 900 },
    deviceScaleFactor: 1,
    locale: "pt-BR",
    reducedMotion: "reduce",
  });
  try {
    const page = await contexto.newPage();
    // como o espelho: anônimo quando a rota abre sem login; admin quando pede login ou tem [param]
    let url = rota;
    if (url.includes("[")) {
      await entrar(page);
      const [caminho, busca] = url.split("?");
      url = await resolverRota(page, caminho, descobrirRotas(), new Map());
      if (!url) throw new Error(`sem dados no banco para resolver ${rota}`);
      if (busca) url += `?${busca}`;
    } else {
      await page.goto(APP + url, { waitUntil: "networkidle" });
      if (new URL(page.url()).pathname !== new URL(APP + url).pathname) await entrar(page);
    }
    await abrirEmRepouso(page, url, manifesto.tema ?? "claro");
    const app = `${base}-app.png`;
    const foto = { path: app, fullPage: true, animations: "disabled", caret: "hide" };
    if (manifesto.ancora) {
      const topo = await page.evaluate((s) => {
        const el = document.querySelector(s);
        return el ? el.getBoundingClientRect().top + window.scrollY : null;
      }, manifesto.ancora);
      if (topo === null) throw new Error(`âncora não achada em ${url}: ${manifesto.ancora}`);
      await page.screenshot({ ...foto, clip: { x: 0, y: Math.round(topo), width: largura, height: altura } });
    } else {
      await page.screenshot(foto);
    }
    const diff = `${base}-app-diff.png`;
    const r = await comparar(ferramentas, `${base}.png`, app, diff);
    console.log(
      `${r.status}  ${r.blocosDivergentes} blocos  ${r.divergencia}%  ${estados ? "estado" : "estudo"} ${v.id} (${tela}) × app ${url}` +
        `${manifesto.ancora ? ` a partir de ${manifesto.ancora}` : ""}`,
    );
    if (r.status !== "à risca")
      console.log(
        `  tamanhos ${JSON.stringify(r.tamanhos)}  primeiros blocos ${JSON.stringify(r.primeirosBlocos)}`,
      );
    console.log(`  app: ${app}\n  diff: ${diff}`);
  } finally {
    await contexto.close();
  }
}

// ── execução ─────────────────────────────────────────────────────────────────────────────
const manifesto = lerManifesto();
// só o Paper, sem navegador
if (comando === "comentarios") await comentarios(manifesto);
if (comando === "resolver") await resolver(manifesto, resto);
if (comando === "aprovar") await aprovar(manifesto, resto[0]);
if (["comentarios", "resolver", "aprovar"].includes(comando)) process.exit(0);

if (comando === "previa") trazerAssets(manifesto);
const arquivos = manifesto.variacoes.flatMap((v) => v.telas);
const checagens = arquivos.map((t) => checarTexto(t, readFileSync(join(PASTA, t), "utf8")));

const navegador = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome", headless: true });
try {
  const contexto = await navegador.newContext({
    deviceScaleFactor: 1,
    locale: "pt-BR",
    reducedMotion: "reduce",
  });
  const page = await contexto.newPage();
  const ferramentas = await contexto.newPage();
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  const tokens = lerTokens(await lerFontesNext(page));
  const vars = tokens.paper
    .filter((t) => t.type === "color")
    .map((t) => `${t.name}:${t.value}`)
    .join(";");

  if (comando === "conferir") {
    console.log(`critério da conferência: ${CRITERIO}`);
    await conferir(navegador, ferramentas, manifesto, resto[0]);
  } else if (comando === "previa") {
    for (const c of checagens) {
      if (c.erros.length) continue;
      const html = readFileSync(join(PASTA, c.arquivo), "utf8");
      c.png = join(PASTA, c.arquivo.replace(/\.html$/, ".png"));
      c.avisos.push(...(await desenhar(page, html, vars, c.png)));
      await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
    }
    for (const c of checagens) {
      const estado = c.erros.length ? "ERRO" : c.avisos.length ? "aviso" : "ok";
      console.log(`${estado.padEnd(6)} ${c.arquivo}${c.png ? `  → ${c.png}` : ""}`);
      for (const e of c.erros) console.log(`         erro: ${e}`);
      for (const a of c.avisos) console.log(`         ${a}`);
    }
    if (checagens.some((c) => c.erros.length)) process.exit(1);
    const destino = join(PASTA, "comparativo.png");
    await comparativo(ferramentas, manifesto, destino);
    console.log(`\ncomparativo: ${destino}`);
  } else {
    const faltando = checagens.filter(
      (c) => c.erros.length || !existsSync(join(PASTA, c.arquivo.replace(/\.html$/, ".png"))),
    );
    if (faltando.length) {
      console.error(`rode a prévia sem erros antes de enviar: ${faltando.map((c) => c.arquivo).join(", ")}`);
      process.exit(1);
    }
    console.log(`critério da conferência: ${CRITERIO}`);
    await enviar(page, manifesto, tokens, vars, ferramentas);
  }
} finally {
  await navegador.close();
}
