import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const raiz = path.resolve(import.meta.dirname, "../..");

// Um único .env na raiz do monorepo (em produção as variáveis vêm do ambiente do container).
if (existsSync(path.join(raiz, ".env"))) process.loadEnvFile(path.join(raiz, ".env"));

// `pnpm dev` roda atrás do portless, que dá a cada checkout uma URL própria
// (https://<worktree>.canteirocheck.localhost). Ela vale mais que a do .env: o link mágico,
// os cookies e o simulador de WhatsApp precisam da URL que o navegador abre de fato.
if (process.env.PORTLESS_URL) {
  process.env.APP_URL = process.env.PORTLESS_URL;
  process.env.BETTER_AUTH_URL = process.env.PORTLESS_URL;
}

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: raiz,
  // Pacotes do monorepo exportam TypeScript-fonte.
  transpilePackages: [
    "@canteirocheck/core",
    "@canteirocheck/db",
    "@canteirocheck/queue",
    "@canteirocheck/servicos",
    "@canteirocheck/storage",
    "@canteirocheck/whatsapp",
  ],
  serverExternalPackages: ["pg", "sharp", "bullmq", "ioredis"],
  poweredByHeader: false,
  // dev atrás do portless: o navegador pede os assets e o HMR por este host, não por localhost
  allowedDevOrigins: ["canteirocheck.localhost", "**.canteirocheck.localhost"],
};

export default nextConfig;
