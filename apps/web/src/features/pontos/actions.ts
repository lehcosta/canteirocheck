"use server";

import { criarPontoManual, definirTolerancia, revisarPonto } from "@canteirocheck/servicos";
import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/sessao";
import { campos, type EstadoAcao, tratarErro } from "../acao";

export async function criarPontoAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  const d = campos(form);
  try {
    await criarPontoManual(s.contexto, d);
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath(`/obras/${d.obraId}/pontos`);
  return {
    ok:
      s.papel === "engenheiro"
        ? "Ponto criado e aprovado."
        : "Ponto criado; aguarda aprovação do engenheiro.",
  };
}

export async function revisarPontoAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  const d = campos(form);
  try {
    await revisarPonto(s.contexto, {
      pontoId: d.pontoId ?? "",
      decisao: d.decisao === "descartar" ? "descartar" : "aprovar",
    });
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath(`/obras/${d.obraId}/pontos`);
  return undefined;
}

export async function definirToleranciaAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  try {
    await definirTolerancia(s.contexto, campos(form));
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath("/configuracoes/tolerancias");
  return { ok: "Tolerância salva." };
}
