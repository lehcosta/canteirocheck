import { lerConfig } from "./config.ts";
import { criarExecutor } from "./executor.ts";
import { criarServidor } from "./servidor.ts";

const config = lerConfig();
const servidor = criarServidor({ extrair: criarExecutor(config) });

servidor.listen(config.porta, () => {
  console.log(JSON.stringify({ evento: "iniciado", ...config }));
});

for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.once(sinal, () => servidor.close(() => process.exit(0)));
}
