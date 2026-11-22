// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: script local da skill, não roda pelo turbo
// O projeto visto pelas skills do Paper (paper-sync, paper-explorer, paper-states, paper-critique).
// O que muda de um projeto para outro mora no adaptador `.claude/paper/projeto.mjs` do repositório
// (modelo em `paper-sync/modelo/`). Aqui ficam o carregamento dele e os padrões para um app Next
// (App Router) com Tailwind v4: `.env`, o Chrome do Playwright, a tela em repouso, as fontes, os tokens
// do CSS e as rotas. O adaptador troca `descobrirRotas`, `lerTokens` ou `abrirEmRepouso` exportando uma
// função com o mesmo nome.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const CAMINHO = process.env.PAPER_PROJETO
  ? resolve(process.env.PAPER_PROJETO)
  : join(RAIZ, ".claude/paper/projeto.mjs");
if (!existsSync(CAMINHO))
  throw new Error(
    `falta o adaptador do projeto (${CAMINHO}): copie .claude/skills/paper-sync/modelo/ para .claude/paper/ e ajuste-o (passo a passo em paper-sync/INSTALAR.md)`,
  );
const projeto = await import(pathToFileURL(CAMINHO).href);
if (typeof projeto.pastaApp !== "string")
  throw new Error(`${CAMINHO}: exporte pastaApp, a pasta do app a partir da raiz ("." se for a própria raiz)`);

export const WEB = join(RAIZ, projeto.pastaApp);

export const env = Object.fromEntries(
  (existsSync(join(RAIZ, ".env")) ? readFileSync(join(RAIZ, ".env"), "utf8") : "")
    .split("\n")
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
export const APP = process.env.APP_URL ?? env.APP_URL ?? "http://localhost:3000";

/** Rota pública que já carrega as fontes da marca: a página em branco onde as prévias e medições desenham. */
export const PAGINA_BASE = projeto.paginaBase ?? "/";
/** Token da ação; a crítica acusa a cor dele fora de ação. */
export const ACENTO = projeto.acento ?? "--color-primary";
export const IDIOMA = projeto.idioma ?? "pt-BR";
/** Estilo da legenda e do comparativo do paper-explorer (titulo, texto, cor, apoio, fundo); o que faltar vem dos tokens. */
export const LEGENDA = projeto.legenda ?? {};
/** Arquivo do Paper de todas as skills, achado ou criado no time ativo. */
export const ARQUIVO = process.env.PAPER_ARQUIVO ?? projeto.arquivoPaper ?? `${nomeDoRepositorio()} — espelho do app`;

function nomeDoRepositorio() {
  try {
    return JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).name ?? "app";
  } catch {
    return "app";
  }
}

/** O Playwright do app, carregado só quando alguém abre o navegador (o desempilhar não abre). */
let playwright;
export const chromium = {
  launch(opcoes) {
    if (!playwright) {
      try {
        playwright = createRequire(join(WEB, "package.json"))("@playwright/test");
      } catch {
        throw new Error(`não achei @playwright/test a partir de ${join(WEB, "package.json")}: instale no app`);
      }
    }
    return playwright.chromium.launch(opcoes);
  },
};

/**
 * Abre uma rota do app no estado de repouso, o mesmo para o gabarito do espelho e para a conferência de um
 * estudo: sem o overlay do Next, sem foco (o autofocus desenharia o anel), no tema pedido e com as fontes
 * carregadas.
 */
export const abrirEmRepouso =
  projeto.abrirEmRepouso ??
  (async (page, url, tema) => {
    await page.goto(APP + url, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.evaluate(
      ({ escuro, classe }) => {
        document.activeElement?.blur();
        document.documentElement.classList.toggle(classe, escuro);
      },
      { escuro: tema === "escuro", classe: projeto.classeEscuro ?? "dark" },
    );
    await page.evaluate(() =>
      document.fonts.ready.then(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      ),
    );
  });

/** Famílias das variáveis --font-* da página (o next/font registra --font-archivo → Archivo). */
export function lerFontes(page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const nomes = [...cs].filter((p) => p.startsWith("--font-"));
    return Object.fromEntries(
      nomes.map((n) => [
        n,
        cs
          .getPropertyValue(n)
          .split(",")[0]
          .trim()
          .replace(/^["']|["']$/g, ""),
      ]),
    );
  });
}

/**
 * Tokens do CSS do app: o que vai para o Paper e as cores da marca para o conversor reconhecer. Só cores em
 * hex viram token; os seletores dos blocos vêm do adaptador.
 */
export const lerTokens =
  projeto.lerTokens ??
  ((fontes) => {
    const arquivo = join(WEB, projeto.css ?? "src/app/globals.css");
    const texto = readFileSync(arquivo, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const blocos = {};
    for (const m of texto.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const seletor = m[1].split(/;\s*/).at(-1).replace(/\s+/g, "");
      const decl = {};
      for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decl[d[1]] = d[2].trim();
      blocos[seletor] = { ...blocos[seletor], ...decl };
    }
    const s = { tema: "@theme inline", claro: ":root", escuro: ".dark", ...projeto.seletores };
    const bloco = (seletor) => (seletor ? blocos[seletor.replace(/\s+/g, "")] : undefined);
    const tema = bloco(s.tema) ?? blocos["@theme"];
    const claro = bloco(s.claro);
    const escuro = s.escuro ? bloco(s.escuro) : {};
    const apelidos = bloco(s.apelidos) ?? {};
    if (!tema || !claro || !escuro)
      throw new Error(
        `${arquivo}: não achei os blocos '${s.tema}', '${s.claro}' e '${s.escuro}' (seletores no adaptador do projeto)`,
      );

    const alvo = (v) => /^var\((--[\w-]+)\)$/.exec(v)?.[1];
    const nomeNoTema = Object.fromEntries(Object.entries(tema).map(([nome, v]) => [alvo(v), nome]));
    const marca = [];
    const marcaEscuro = [];
    const aliases = [];
    const familias = [];
    const raios = [];
    for (const [nome, valor] of Object.entries(tema)) {
      const v = alvo(valor);
      if (nome.startsWith("--color-") && v && /^#/.test(claro[v] ?? "")) {
        marca.push({ type: "color", name: nome, value: claro[v] });
        if (escuro[v]) marcaEscuro.push({ type: "color", name: `${nome}-escuro`, value: escuro[v] });
      } else if (nome.startsWith("--color-") && v && alvo(apelidos[v] ?? "")) {
        const destino = nomeNoTema[alvo(apelidos[v])];
        if (destino) aliases.push({ type: "color", name: nome, value: `var(${destino})` });
      } else if (nome.startsWith("--font-")) {
        const primeira = valor.split(",")[0].trim();
        const familia = alvo(primeira) ? fontes[alvo(primeira)] : primeira.replace(/^["']|["']$/g, "");
        if (familia) familias.push({ type: "fontFamily", name: nome, value: familia });
      } else if (nome.startsWith("--radius-") && /^\d+(\.\d+)?px$/.test(valor)) {
        raios.push({ type: "radius", name: nome, value: valor });
      }
    }
    raios.sort((a, b) => Number.parseFloat(a.value) - Number.parseFloat(b.value));
    const rgb = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
    return {
      paper: [...marca, ...marcaEscuro, ...aliases, ...familias, ...raios],
      // ordem de preferência quando dois tokens têm a mesma cor: marca clara, depois escura
      cores: [...marca, ...marcaEscuro].map((t) => ({ nome: t.name, rgb: rgb(t.value) })),
    };
  });

// ── rotas: uma por page.tsx do App Router ───────────────────────────────────────────────
export const descobrirRotas =
  projeto.descobrirRotas ??
  (() => {
    const fora = projeto.rotasFora ?? ["/api"];
    const base = [join(WEB, "src/app"), join(WEB, "app")].find(existsSync);
    if (!base) throw new Error(`não achei src/app nem app em ${WEB}: exporte descobrirRotas no adaptador`);
    const rotas = [];
    for (const arq of readdirSync(base, { recursive: true })) {
      if (!/(^|[/\\])page\.(tsx|ts|jsx|js|mdx)$/.test(arq)) continue;
      const segs = dirname(arq)
        .split(sep)
        .filter((s) => s && s !== ".");
      if (segs.some((s) => s.startsWith("_"))) continue;
      const rota = `/${segs.filter((s) => !/^\(.*\)$/.test(s)).join("/")}`;
      if (!fora.some((f) => rota === f || rota.startsWith(`${f}/`))) rotas.push(rota);
    }
    return rotas.sort();
  });

/** Troca cada [param] por um valor real, achado nos links das páginas acima dele. */
export async function resolverRota(page, rota, todas, cache) {
  let atual = "";
  for (const seg of rota.split("/").slice(1)) {
    if (!/^\[.+\]$/.test(seg)) {
      atual += `/${seg}`;
      continue;
    }
    const chave = `${atual}/${seg}`;
    if (!cache.has(chave)) {
      const estaticos = new Set(
        todas.filter((r) => r.startsWith(`${atual}/`)).map((r) => r.slice(atual.length + 1).split("/")[0]),
      );
      let valor = null;
      for (let onde = atual; valor === null && onde; onde = onde.slice(0, onde.lastIndexOf("/"))) {
        await page.goto(APP + onde, { waitUntil: "networkidle" });
        const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
        valor =
          hrefs
            .filter((h) => h.startsWith(`${atual}/`))
            .map((h) => h.slice(atual.length + 1).split(/[/?#]/)[0])
            .find((v) => v && !estaticos.has(v)) ?? null;
      }
      cache.set(chave, valor);
    }
    if (!cache.get(chave)) return null;
    atual += `/${cache.get(chave)}`;
  }
  return atual || "/";
}

/**
 * Abre a sessão de quem vê todas as telas, pelo `entrar` do adaptador. Sem ele, o app não tem login e toda
 * rota é capturada anônima.
 */
export async function entrar(page) {
  if (projeto.entrar) await projeto.entrar(page, { APP, env, RAIZ });
}
