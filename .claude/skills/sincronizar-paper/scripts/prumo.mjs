// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: script local da skill, não roda pelo turbo
// Peças do projeto que as skills do Paper compartilham (sincronizar-paper e paper-explorer):
// caminhos do repositório, .env, o Chrome do Playwright e os tokens do globals.css.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const WEB = join(RAIZ, "apps/web");
export const { chromium } = createRequire(join(WEB, "package.json"))("@playwright/test");

export const env = Object.fromEntries(
  (existsSync(join(RAIZ, ".env")) ? readFileSync(join(RAIZ, ".env"), "utf8") : "")
    .split("\n")
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
export const APP = process.env.APP_URL ?? env.APP_URL ?? "http://localhost:3000";
export const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

/**
 * Abre uma rota do app no estado de repouso, o mesmo para o gabarito do espelho e para a conferência de um
 * estudo: sem o overlay do Next, sem foco (o autofocus desenharia o anel), no tema pedido e com as fontes
 * carregadas.
 */
export async function abrirEmRepouso(page, url, tema) {
  await page.goto(APP + url, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.evaluate((escuro) => {
    document.activeElement?.blur();
    document.documentElement.classList.toggle("dark", escuro);
  }, tema === "escuro");
  await page.evaluate(() =>
    document.fonts.ready.then(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    ),
  );
}

/** Famílias que o next/font registrou (--font-archivo → Archivo), lidas numa página do app. */
export function lerFontesNext(page) {
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

/** Tokens do globals.css: o que vai para o Paper e as cores da marca para o conversor reconhecer. */
export function lerTokens(fontesNext) {
  const texto = readFileSync(join(WEB, "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocos = {};
  for (const m of texto.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const seletor = m[1].split(/;\s*/).at(-1).replace(/\s+/g, "");
    const decl = {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decl[d[1]] = d[2].trim();
    blocos[seletor] = { ...blocos[seletor], ...decl };
  }
  const tema = blocos["@themeinline"] ?? blocos["@theme"];
  const claro = blocos[":root,.claro"];
  const escuro = blocos[".dark"];
  const apelidos = blocos[":root,.dark,.claro"] ?? {};
  if (!tema || !claro || !escuro)
    throw new Error("globals.css: não achei @theme inline, ':root, .claro' ou '.dark'");

  const alvo = (v) => /^var\((--[\w-]+)\)$/.exec(v)?.[1];
  const nomeNoTema = Object.fromEntries(Object.entries(tema).map(([nome, v]) => [alvo(v), nome]));
  const marca = [];
  const marcaEscuro = [];
  const aliases = [];
  const fontes = [];
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
      const familia = alvo(primeira) ? fontesNext[alvo(primeira)] : primeira.replace(/^["']|["']$/g, "");
      if (familia) fontes.push({ type: "fontFamily", name: nome, value: familia });
    } else if (nome.startsWith("--radius-") && /^\d+(\.\d+)?px$/.test(valor)) {
      raios.push({ type: "radius", name: nome, value: valor });
    }
  }
  raios.sort((a, b) => Number.parseFloat(a.value) - Number.parseFloat(b.value));
  const rgb = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return {
    paper: [...marca, ...marcaEscuro, ...aliases, ...fontes, ...raios],
    // ordem de preferência quando dois tokens têm a mesma cor: marca clara, depois escura
    cores: [...marca, ...marcaEscuro].map((t) => ({ nome: t.name, rgb: rgb(t.value) })),
  };
}

// ── rotas: uma por page.tsx ──────────────────────────────────────────────────────────────
const FORA = ["/dev", "/api"];

export function descobrirRotas() {
  const base = join(WEB, "src/app");
  const rotas = [];
  for (const arq of readdirSync(base, { recursive: true })) {
    if (!/(^|[/\\])page\.(tsx|ts|jsx|js)$/.test(arq)) continue;
    const segs = dirname(arq)
      .split(sep)
      .filter((s) => s && s !== ".");
    if (segs.some((s) => s.startsWith("_"))) continue;
    const rota = `/${segs.filter((s) => !/^\(.*\)$/.test(s)).join("/")}`;
    if (!FORA.some((f) => rota === f || rota.startsWith(`${f}/`))) rotas.push(rota);
  }
  return rotas.sort();
}

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

// ── login: admin da worktree por magic link (Mailpit) ─────────────────────────────────────
/** Admin ativo com e-mail no banco da worktree: vê todas as telas do painel. */
async function emailAdmin() {
  if (process.env.PAPER_EMAIL) return process.env.PAPER_EMAIL;
  const { Client } = createRequire(join(RAIZ, "packages/db/package.json"))("pg");
  const banco = new Client({ connectionString: env.DATABASE_URL_MIGRATOR ?? env.DATABASE_URL });
  await banco.connect();
  try {
    const r = await banco.query(
      "select email from usuario where papel = 'admin' and ativo and email is not null and auth_user_id is not null order by criado_em limit 1",
    );
    if (!r.rows[0]) throw new Error("nenhum admin ativo com login no banco da worktree; rode `pnpm db:seed`");
    return r.rows[0].email;
  } finally {
    await banco.end();
  }
}

export async function entrar(page) {
  const EMAIL = await emailAdmin();
  const desde = Date.now() - 2000;
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("E-mail").fill(EMAIL);
  await page.getByRole("button", { name: /link/i }).click();
  for (let i = 0; i < 40; i++) {
    const busca = await (
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${EMAIL}`)}&limit=5`)
    ).json();
    const msg = busca.messages?.find((m) => Date.parse(m.Created) >= desde);
    if (msg) {
      const corpo = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
      const link = new RegExp(
        `${APP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/auth/magic-link/verify\\S+`,
      ).exec(corpo.Text)?.[0];
      if (link) {
        await page.goto(link, { waitUntil: "networkidle" });
        if (!page.url().includes("/login")) return;
        throw new Error(`o magic link de ${EMAIL} não abriu sessão (parou em ${page.url()})`);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`o e-mail de acesso de ${EMAIL} não chegou ao Mailpit (${MAILPIT}); o banco está semeado?`);
}
