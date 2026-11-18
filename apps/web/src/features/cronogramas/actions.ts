"use server";

import { restaurarCronograma } from "@canteirocheck/servicos";
import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/sessao";
import { type EstadoAcao, tratarErro } from "../acao";

export async function restaurarCronogramaAction(obraId: string, versaoId: string): Promise<EstadoAcao> {
  const s = await exigirSessao();
  let numero: number;
  try {
    ({ numero } = await restaurarCronograma(s.contexto, versaoId));
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath(`/obras/${obraId}/cronograma`);
  return { ok: `A v${numero} é a vigente de novo.` };
}
