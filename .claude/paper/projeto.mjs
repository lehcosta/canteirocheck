// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: script local das skills do Paper, não roda pelo turbo
// Adaptador do Prumo para as skills do Paper (paper-sync, paper-explorer, paper-states, paper-critique).
// O que não estiver aqui usa o padrão de .claude/skills/paper-sync/scripts/projeto.mjs.
import { createRequire } from "node:module";
import { join } from "node:path";

/** Pasta do app a partir da raiz: tem o package.json com @playwright/test e o src/app do Next. */
export const pastaApp = "apps/web";

/** Rota pública que já carrega as fontes da marca: a página em branco das prévias e medições. */
export const paginaBase = "/login";

/** Arquivo do Paper das quatro skills, achado ou criado no time ativo. */
export const arquivoPaper = "Prumo — espelho do app";

/** CSS dos tokens, a partir de pastaApp, e os seletores dos blocos dele. */
export const css = "src/app/globals.css";
export const seletores = {
  tema: "@theme inline",
  claro: ":root, .claro",
  escuro: ".dark",
  // apelidos que valem nos dois temas (--primary → --acao, por exemplo)
  apelidos: ":root, .dark, .claro",
};

/** Classe no <html> que liga o tema escuro. */
export const classeEscuro = "dark";

/** Token da ação: a crítica acusa o laranja fora de botão ou link. */
export const acento = "--color-prumo";

/** Rotas que não são tela do produto. */
export const rotasFora = ["/dev", "/api"];

/** Idioma do navegador nas capturas (datas e números). */
export const idioma = "pt-BR";

/** Legenda que o paper-explorer grava acima dos estudos, e o comparativo da prévia. */
export const legenda = {
  titulo: "font-family:Archivo;font-weight:800",
  texto: "font-family:'IBM Plex Sans';font-weight:400",
  cor: "var(--color-ink)",
  apoio: "var(--color-ink-muted)",
  fundo: "var(--color-surface-raised)",
};

/**
 * Entra como o primeiro admin ativo do banco da worktree (ele vê todas as telas do painel), por magic link:
 * pede o link no /login e o lê no Mailpit. PAPER_EMAIL troca o usuário.
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
    if (!r.rows[0]) throw new Error("nenhum admin ativo com login no banco da worktree; rode `pnpm db:seed`");
    return r.rows[0].email;
  } finally {
    await banco.end();
  }
}
