"use server";

import { reprocessarProjeto, resolverPendencia } from "@canteirocheck/servicos";
import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/sessao";
import { campos, type EstadoAcao, tratarErro } from "../acao";

export async function reprocessarAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  const d = campos(form);
  try {
    await reprocessarProjeto(s.contexto, d.projetoId ?? "");
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath(`/obras/${d.obraId}/projetos/${d.projetoId}`);
  return { ok: "Extração reenfileirada." };
}

export async function resolverPendenciaAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  const d = campos(form);
  try {
    await resolverPendencia(s.contexto, {
      pendenciaId: d.pendenciaId ?? "",
      status: d.status === "descartada" ? "descartada" : "resolvida",
      nota: d.nota ?? null,
    });
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath(`/obras/${d.obraId}`, "layout");
  return { ok: "Pendência atualizada." };
}
