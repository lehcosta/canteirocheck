import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

function lerVersaoDoPacote(arquivo: string | URL): string {
  const conteudo: unknown = JSON.parse(readFileSync(arquivo, "utf8"));
  if (typeof conteudo === "object" && conteudo !== null && "version" in conteudo) {
    return String(conteudo.version);
  }
  throw new Error(`package.json sem "version": ${String(arquivo)}`);
}

/** Raiz instalada de @mlightcad/libredwg-web (o mapa `exports` não expõe o package.json). */
export const RAIZ_LIBREDWG_WEB = path.resolve(
  path.dirname(createRequire(import.meta.url).resolve("@mlightcad/libredwg-web")),
  "..",
);

/** src/ e dist/ ficam ambos um nível abaixo da raiz do serviço. */
export const VERSAO_EXTRATOR = lerVersaoDoPacote(new URL("../package.json", import.meta.url));

export const VERSAO_LIBREDWG_WEB = lerVersaoDoPacote(path.join(RAIZ_LIBREDWG_WEB, "package.json"));
