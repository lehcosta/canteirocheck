"use server";

import { adicionarMembro, criarLocal, criarObra, removerMembro } from "@canteirocheck/servicos";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { exigirSessao } from "@/lib/sessao";
import { campos, type EstadoAcao, tratarErro } from "../acao";

export async function criarObraAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  let id: string;
  try {
    ({ id } = await criarObra(s.contexto, campos(form)));
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath("/obras");
  redirect(`/obras/${id}`);
}

export async function criarLocalAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  const dados = campos(form);
  try {
    await criarLocal(s.contexto, dados);
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath(`/obras/${dados.obraId}`);
  return { ok: "Local criado." };
}

export async function adicionarMembroAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  const dados = campos(form);
  try {
    await adicionarMembro(s.contexto, dados);
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath(`/obras/${dados.obraId}`);
  return { ok: "Membro adicionado." };
}

export async function removerMembroAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  const dados = campos(form);
  try {
    await removerMembro(s.contexto, dados);
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath(`/obras/${dados.obraId}`);
  return undefined;
}
