"use server";

import { criarUsuario, definirAtivo } from "@canteirocheck/servicos";
import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/sessao";
import { campos, type EstadoAcao, tratarErro } from "../acao";

export async function criarUsuarioAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  try {
    await criarUsuario(s.contexto, campos(form));
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath("/configuracoes/usuarios");
  return { ok: "Usuário criado." };
}

export async function definirAtivoAction(_: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const s = await exigirSessao();
  const dados = campos(form);
  try {
    await definirAtivo(s.contexto, { usuarioId: dados.usuarioId, ativo: dados.ativo === "true" });
  } catch (e) {
    return tratarErro(e);
  }
  revalidatePath("/configuracoes/usuarios");
  return undefined;
}
