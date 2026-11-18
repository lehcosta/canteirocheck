"use server";

import {
  aprovarCheck,
  cruzarDeNovo,
  desfazerAprovacaoDoCheck,
  type EntradaCheck,
  salvarCheck,
} from "@canteirocheck/servicos";
import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/sessao";
import { type EstadoAcao, tratarErro } from "../acao";

/** A aba Cronograma (as contas no Gantt) e a página da fase mostram o mesmo check. */
function revalidar(obraId: string, faseUid?: number) {
  revalidatePath(`/obras/${obraId}/cronograma`);
  if (faseUid !== undefined) revalidatePath(`/obras/${obraId}/cronograma/${faseUid}`);
}

export async function cruzarDeNovoAction(obraId: string): Promise<EstadoAcao> {
  const s = await exigirSessao();
  try {
    await cruzarDeNovo(s.contexto, obraId);
  } catch (e) {
    return tratarErro(e);
  }
  revalidar(obraId);
  return { ok: "Cruzamento pedido." };
}

export async function salvarCheckAction(
  obraId: string,
  faseUid: number,
  checkId: string,
  entrada: EntradaCheck,
): Promise<EstadoAcao> {
  const s = await exigirSessao();
  try {
    await salvarCheck(s.contexto, checkId, entrada);
  } catch (e) {
    return tratarErro(e);
  }
  revalidar(obraId, faseUid);
  return { ok: "Perguntas salvas." };
}

/** Devolve o dia em que o check sai, para o recado de quem aprovou. */
export async function aprovarCheckAction(
  obraId: string,
  faseUid: number,
  checkId: string,
): Promise<NonNullable<EstadoAcao> & { saiEm?: string | null }> {
  const s = await exigirSessao();
  let saiEm: string | null;
  try {
    ({ saiEm } = await aprovarCheck(s.contexto, checkId));
  } catch (e) {
    return tratarErro(e) ?? {};
  }
  revalidar(obraId, faseUid);
  return { saiEm };
}

export async function desfazerAprovacaoAction(
  obraId: string,
  faseUid: number,
  checkId: string,
): Promise<EstadoAcao> {
  const s = await exigirSessao();
  try {
    await desfazerAprovacaoDoCheck(s.contexto, checkId);
  } catch (e) {
    return tratarErro(e);
  }
  revalidar(obraId, faseUid);
  return { ok: "Aprovação desfeita." };
}
