import { podeEntrarNoPainel } from "@canteirocheck/db";
import { obterDbParaAuth, schemaAuth } from "@canteirocheck/db/auth-adapter";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { enviarEmail } from "./email";
import { env } from "./env";

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const auth = betterAuth({
  appName: "Prumo",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(obterDbParaAuth(), { provider: "pg", schema: schemaAuth }),
  user: { modelName: "auth_user" },
  session: { modelName: "auth_session", expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  account: { modelName: "auth_account" },
  verification: { modelName: "auth_verification" },
  emailAndPassword: { enabled: false },
  plugins: [
    magicLink({
      // Sem cadastro aberto: só entra quem o admin criou (servicos/usuarios.ts cria o auth_user).
      disableSignUp: true,
      expiresIn: 60 * 15,
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }) => {
        // Silencioso para e-mails sem acesso: não revela quem tem conta e não vira canal de spam.
        if (!(await podeEntrarNoPainel(email))) return;
        await enviarEmail({
          para: email,
          assunto: "Seu link de acesso ao Prumo",
          texto: `Para entrar no Prumo, abra este link (vale por 15 minutos):\n\n${url}\n\nSe você não pediu, ignore este e-mail.`,
          html: `<p>Para entrar no Prumo, clique no link abaixo. Ele vale por 15 minutos.</p>
<p><a href="${escapar(url)}">Entrar no Prumo</a></p>
<p style="color:#666">Se você não pediu, ignore este e-mail.</p>`,
        });
      },
    }),
    nextCookies(), // precisa ser o último
  ],
});
