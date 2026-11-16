import { listarUsuarios } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { CabecalhoPagina, TituloSecao } from "@/components/cabecalho-pagina";
import { Campo, CampoSelect } from "@/components/campos";
import { FormularioAcao } from "@/components/formulario-acao";
import { Button } from "@/components/ui/button";
import { criarUsuarioAction } from "@/features/usuarios/actions";
import { PAPEL } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { Equipe } from "./equipe";

export const metadata: Metadata = { title: "Usuários" };

export default async function Usuarios() {
  const s = await exigirSessao();
  const usuarios = await listarUsuarios(s.contexto);
  const ehAdmin = s.papel === "admin";
  const ativos = usuarios.filter((u) => u.ativo).length;
  const inativos = usuarios.length - ativos;

  return (
    <>
      <CabecalhoPagina
        titulo="Usuários"
        descricao="Admin e engenheiro entram no painel com o e-mail. Encarregado usa só o WhatsApp."
      />

      <div className="flex flex-wrap items-start gap-6">
        <section aria-labelledby="titulo-equipe" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <TituloSecao id="titulo-equipe">Equipe</TituloSecao>
            <p className="text-sm text-muted-foreground">
              {ativos} {ativos === 1 ? "ativo" : "ativos"} · {inativos}{" "}
              {inativos === 1 ? "inativo" : "inativos"}
            </p>
          </div>
          <Equipe usuarios={usuarios} usuarioId={s.usuarioId} ehAdmin={ehAdmin} idTitulo="titulo-equipe" />
        </section>

        {ehAdmin && (
          <section
            aria-labelledby="titulo-novo"
            className="flex min-w-0 flex-[1_1_340px] flex-col gap-5 rounded-md border bg-card p-6"
          >
            <TituloSecao id="titulo-novo">Novo usuário</TituloSecao>
            <FormularioAcao acao={criarUsuarioAction} className="flex flex-col gap-4 space-y-0">
              <Campo rotulo="Nome" nome="nome" required autoComplete="off" />
              <CampoSelect
                rotulo="Papel"
                nome="papel"
                required
                defaultValue="encarregado"
                opcoes={Object.entries(PAPEL).map(([valor, rotulo]) => ({ valor, rotulo }))}
              />
              <div className="grid gap-2">
                <Campo
                  rotulo="E-mail"
                  nome="email"
                  type="email"
                  autoComplete="off"
                  aria-describedby="dica-email"
                />
                <p id="dica-email" className="text-[13px] leading-[18px] text-muted-foreground">
                  Obrigatório para admin e engenheiro.
                </p>
              </div>
              <div className="grid gap-2">
                <Campo
                  rotulo="WhatsApp"
                  nome="whatsapp"
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="(11) 99999-8888"
                  aria-describedby="dica-whatsapp"
                  className="[&_input]:font-mono [&_input]:tabular-nums"
                />
                <p id="dica-whatsapp" className="text-[13px] leading-[18px] text-muted-foreground">
                  O encarregado recebe as conferências neste número.
                </p>
              </div>
              <Button type="submit" size="lg" className="w-full">
                Criar usuário
              </Button>
            </FormularioAcao>
          </section>
        )}
      </div>
    </>
  );
}
