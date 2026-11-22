import { listarUsuarios, nomeDoPlano, obterAssinatura } from "@canteirocheck/servicos";
import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CabecalhoPagina } from "@/components/cabecalho-pagina";
import { ProgressoCadastro, TrilhoCadastro } from "@/components/passos-obra";
import { buttonVariants } from "@/components/ui/button";
import { exigirSessao } from "@/lib/sessao";
import { FormularioObra } from "./formulario-obra";

export const metadata: Metadata = { title: "Nova obra" };

/** O motivo de o cadastro não poder seguir, no lugar do formulário, com o caminho para resolver. */
function Aviso({
  titulo,
  textos,
  acao,
}: {
  titulo: string;
  textos: string[];
  acao: { href: string; rotulo: string };
}) {
  return (
    <section aria-labelledby="titulo-aviso" className="space-y-4 rounded-md border bg-card p-5 md:p-6">
      <h2 id="titulo-aviso" className="flex items-center gap-2.5 text-lg leading-6 font-semibold">
        <CircleAlert aria-hidden className="size-4 shrink-0" />
        {titulo}
      </h2>
      <div className="space-y-1.5 text-[15px] leading-[22px]">
        {textos.map((t) => (
          <p key={t}>{t}</p>
        ))}
      </div>
      <Link href={acao.href} className={buttonVariants()}>
        {acao.rotulo}
      </Link>
    </section>
  );
}

export default async function NovaObra() {
  const s = await exigirSessao();
  if (s.papel !== "admin") redirect("/obras");
  const [usuarios, assinatura] = await Promise.all([listarUsuarios(s.contexto), obterAssinatura(s.contexto)]);
  const engenheiros = usuarios.filter((u) => u.papel === "engenheiro" && u.ativo);
  // o teto do plano avisa antes de preencher; o serviço confere de novo ao criar (duas abas ao mesmo tempo)
  const { limiteObras, obrasAtivas } = assinatura;
  const noLimite = limiteObras !== null && obrasAtivas >= limiteObras;
  const travado = engenheiros.length === 0 ? "Falta um engenheiro" : noLimite ? "Plano no limite" : undefined;

  return (
    <>
      <div className="space-y-3">
        <ol aria-label="Você está em" className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <li>
            <Link href="/obras" className="hover:text-foreground">
              Obras
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-foreground">
            Nova obra
          </li>
        </ol>
        <CabecalhoPagina
          titulo="Nova obra"
          descricao="O engenheiro responsável entra na equipe da obra automaticamente."
        />
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-12">
        <TrilhoCadastro travado={travado} />
        <ProgressoCadastro />
        <div className="min-w-0 flex-1">
          {engenheiros.length === 0 ? (
            <Aviso
              titulo="Falta um engenheiro"
              textos={[
                "Cadastre ao menos um engenheiro em Usuários antes de criar uma obra.",
                "Ele vira o responsável e entra na equipe da obra.",
              ]}
              acao={{ href: "/configuracoes/usuarios", rotulo: "Cadastrar engenheiro" }}
            />
          ) : limiteObras === 0 ? (
            <Aviso
              titulo="Assinatura inativa"
              textos={["A assinatura não está ativa. Regularize em Assinatura para abrir obras."]}
              acao={{ href: "/configuracoes/assinatura", rotulo: "Regularizar assinatura" }}
            />
          ) : noLimite ? (
            <Aviso
              titulo="Limite de obras do plano"
              textos={[
                `O plano ${nomeDoPlano(assinatura.plano)} vai até ${limiteObras} obras ativas. Troque de plano em Assinatura para abrir outra.`,
                `Hoje: ${obrasAtivas} de ${limiteObras} obras ativas.`,
              ]}
              acao={{ href: "/configuracoes/assinatura", rotulo: "Trocar de plano" }}
            />
          ) : (
            <FormularioObra engenheiros={engenheiros.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
          )}
        </div>
      </div>
    </>
  );
}
