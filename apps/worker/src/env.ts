import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Local: um .env só, na raiz do monorepo. Em produção as variáveis vêm do ambiente. */
const raiz = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(raiz)) process.loadEnvFile(raiz);
