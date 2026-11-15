import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const raiz = path.resolve(import.meta.dirname, "../..");

// Um único .env na raiz do monorepo (em produção as variáveis vêm do ambiente do container).
if (existsSync(path.join(raiz, ".env"))) process.loadEnvFile(path.join(raiz, ".env"));

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
};

export default nextConfig;
