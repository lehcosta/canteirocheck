// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: script local das skills do Paper, não roda pelo turbo
// Adaptador do projeto para as skills do Paper (paper-sync, paper-explorer, paper-states, paper-critique).
// Copie para .claude/paper/projeto.mjs e ajuste cada linha marcada com "mude:". O que não estiver aqui usa o
// padrão de .claude/skills/paper-sync/scripts/projeto.mjs, feito para Next (App Router) + Tailwind v4.
//
// Fora desse padrão, exporte também a função que difere, com o mesmo nome e contrato:
//   descobrirRotas()                  → ["/", "/login", "/obras/[obraId]", …]
//   lerTokens(fontes)                 → { paper: [{ type, name, value }…], cores: [{ nome, rgb }…] }
//   abrirEmRepouso(page, url, tema)   abre APP + url no tema "claro" ou "escuro", sem foco, fontes carregadas
// Este modelo é o adaptador do Prumo, que entra por magic link lido no Mailpit.
import { createRequire } from "node:module";
import { join } from "node:path";

/** Pasta do app a partir da raiz: tem o package.json com @playwright/test e o src/app (ou app) do Next. */
export const pastaApp = "apps/web"; // mude: "." se o app é a raiz

/** Rota pública que já carrega as fontes da marca: a página em branco das prévias e medições. */
export const paginaBase = "/login"; // mude

/** Arquivo do Paper das quatro skills, achado ou criado no time ativo. */
export const arquivoPaper = "Prumo — espelho do app"; // mude

/** CSS dos tokens, a partir de pastaApp, e os seletores dos blocos dele (cores em hex). */
export const css = "src/app/globals.css"; // mude
export const seletores = {
  tema: "@theme inline",
  claro: ":root, .claro", // mude: ":root" no shadcn padrão
  escuro: ".dark", // mude: null se o app não tem tema escuro
  // apelidos que valem nos dois temas (--primary → --acao, por exemplo); apague se não houver
  apelidos: ":root, .dark, .claro", // mude
};

/** Classe no <html> que liga o tema escuro. */
export const classeEscuro = "dark";

/** Token da ação: a crítica acusa a cor dele fora de botão ou link. */
export const acento = "--color-prumo"; // mude: "--color-primary" no shadcn padrão

/** Rotas que não são tela do produto. */
export const rotasFora = ["/dev", "/api"]; // mude

/** Idioma do navegador nas capturas (datas e números); a crítica cobra o formato pt-BR só em português. */
export const idioma = "pt-BR"; // mude

/** Legenda que o paper-explorer grava acima dos estudos. Apague para usar a primeira fonte dos tokens e cores fixas. */
export const legenda = {
  titulo: "font-family:Archivo;font-weight:800", // mude
  texto: "font-family:'IBM Plex Sans';font-weight:400", // mude
  cor: "var(--color-ink)", // mude
  apoio: "var(--color-ink-muted)", // mude
  fundo: "var(--color-surface-raised)", // mude
};

/**
 * Abre a sessão de quem vê todas as telas. Recebe a página do Playwright e { APP, env, RAIZ } (env é o .env da
 * raiz). Apague a função se o app não tem login: toda rota é capturada anônima.
 *
 * mude: este é o login do Prumo — o primeiro admin ativo do banco, por magic link lido no Mailpit.
 */
export async function entrar(page, { APP, env, RAIZ }) {
  const mailpit = process.env.MAILPIT_URL ?? env.MAILPIT_URL ?? "http://localhost:8025";
  const email = process.env.PAPER_EMAIL ?? (await emailAdmin(env, RAIZ));
  const desde = Date.now() - 2000;
  await page.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: /link/i }).click();
  for (let i = 0; i < 40; i++) {
    const busca = await (
      await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=5`)
    ).json();
    const msg = busca.messages?.find((m) => Date.parse(m.Created) >= desde);
    if (msg) {
      const corpo = await (await fetch(`${mailpit}/api/v1/message/${msg.ID}`)).json();
      const link = new RegExp(
        `${APP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/auth/magic-link/verify\\S+`,
      ).exec(corpo.Text)?.[0];
      if (link) {
        await page.goto(link, { waitUntil: "networkidle" });
        if (!page.url().includes("/login")) return;
        throw new Error(`o magic link de ${email} não abriu sessão (parou em ${page.url()})`);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`o e-mail de acesso de ${email} não chegou ao Mailpit (${mailpit}); o banco está semeado?`);
}

async function emailAdmin(env, RAIZ) {
  const { Client } = createRequire(join(RAIZ, "packages/db/package.json"))("pg");
  const banco = new Client({ connectionString: env.DATABASE_URL_MIGRATOR ?? env.DATABASE_URL });
  await banco.connect();
  try {
    const r = await banco.query(
      "select email from usuario where papel = 'admin' and ativo and email is not null and auth_user_id is not null order by criado_em limit 1",
    );
    if (!r.rows[0]) throw new Error("nenhum admin ativo com login no banco; rode o seed do projeto");
    return r.rows[0].email;
  } finally {
    await banco.end();
  }
}
