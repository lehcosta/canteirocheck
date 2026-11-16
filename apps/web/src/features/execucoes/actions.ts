"use server";

import { decidirPeloPainel, solicitarRelatorio } from "@canteirocheck/servicos";
import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/sessao";
import { campos, type EstadoAcao, tratarErro } from "../acao";

export async function decidirAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  const d = campos(form);
  const decisao = d.decisao === "recusada" ? "recusada" : "liberada";
  try {
    await decidirPeloPainel(s.contexto, {
      execucaoId: d.execucaoId ?? "",
      rodada: Number(d.rodada),
      decisao,
      justificativa: d.justificativa ?? null,
    });
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath(`/obras/${d.obraId}`, "layout");
  return {
    ok:
      decisao === "liberada"
        ? "Execução liberada. O encarregado foi avisado."
        : "Execução recusada. O encarregado foi avisado.",
  };
}

export async function solicitarPdfAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  const d = campos(form);
  try {
    await solicitarRelatorio(s.contexto, { obraId: d.obraId ?? "", execucaoId: d.execucaoId || null });
  } catch (e) {
    return tratarErro(e);
  }
  return { ok: "Gerando o PDF. Atualize a página em alguns segundos." };
}
