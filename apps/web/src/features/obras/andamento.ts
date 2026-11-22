import { andamentoDaObra } from "@canteirocheck/servicos";
import { cache } from "react";
import { exigirSessao } from "@/lib/sessao";

/** O andamento da obra, uma consulta por requisição: o layout (a faixa) e as páginas leem o mesmo. */
export const carregarAndamento = cache(async (obraId: string) => {
  const s = await exigirSessao();
  return andamentoDaObra(s.contexto, obraId);
});
