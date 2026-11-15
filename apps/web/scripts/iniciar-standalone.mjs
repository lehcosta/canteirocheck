// `next start` não serve o build `output: "standalone"`. Este script copia os assets estáticos
// para dentro do bundle standalone e sobe o servidor dele — o mesmo que o container de produção fará.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(app, ".next/standalone/apps/web");
if (!existsSync(standalone)) {
  console.error("Build standalone não encontrado. Rode `pnpm build` antes.");
  process.exit(1);
}
cpSync(path.join(app, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
if (existsSync(path.join(app, "public")))
  cpSync(path.join(app, "public"), path.join(standalone, "public"), { recursive: true });

// Local: usa o .env da raiz. Em produção as variáveis vêm do ambiente do container (sem .env).
const envRaiz = path.resolve(app, "../../.env");
if (existsSync(envRaiz)) process.loadEnvFile(envRaiz);
process.env.PORT ??= "3000";
await import(path.join(standalone, "server.js"));
