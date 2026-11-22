#!/usr/bin/env node
// Tira as sobreposições das pranchetas no arquivo do espelho: cada prancheta no seu lugar. O sincronizar e o
// enviar/aprovar do paper-explorer já desempilham a página deles no fim; este é para quando alguém vê
// pranchetas uma sobre a outra. Custa 2 chamadas por página (1 se a página já está limpa) e mais umas 3.
//
// uso (da raiz do repositório):
//   node .claude/skills/sincronizar-paper/scripts/desempilhar.mjs [--paginas Claro,Escuro,Explorações,Estados] [--previa]
// --previa: só lista o que moveria (1 chamada por página, nenhuma mudança).
import { parseArgs } from "node:util";
import { acharArquivo, desempilhar, Paper, planoDesempilhar, relatoDesempilhar } from "./paper.mjs";

const { values: opcoes } = parseArgs({
  options: { paginas: { type: "string" }, previa: { type: "boolean", default: false } },
});

const paper = await Paper.conectar();
try {
  const fileId = await acharArquivo(paper);
  const { pages } = await paper.chamar("open_file", { fileId });
  const pedidas = opcoes.paginas?.split(",").map((p) => p.trim());
  const paginas = pages.filter((p) => p.type !== "divider" && (!pedidas || pedidas.includes(p.name)));
  for (const p of paginas) {
    const mudancas = opcoes.previa
      ? planoDesempilhar((await paper.chamar("get_basic_info", { fileId, pageId: p.id })).artboards ?? [])
      : await desempilhar(paper, fileId, p.id);
    console.log(relatoDesempilhar(p.name, mudancas));
  }
} finally {
  console.log(`chamadas ao MCP do Paper: ${paper.chamadas}`);
  paper.fechar();
}
