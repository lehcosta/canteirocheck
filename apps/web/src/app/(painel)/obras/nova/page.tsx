import { listarUsuarios } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CabecalhoPagina } from "@/components/cabecalho-pagina";
import { Campo, CampoSelect } from "@/components/campos";
import { FormularioAcao } from "@/components/formulario-acao";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { criarObraAction } from "@/features/obras/actions";
import { exigirSessao } from "@/lib/sessao";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Nova obra" };

export default async function NovaObra() {
  const s = await exigirSessao();
  if (s.papel !== "admin") redirect("/obras");
  const engenheiros = (await listarUsuarios(s.contexto)).filter((u) => u.papel === "engenheiro" && u.ativo);

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

      <Card className="max-w-2xl">
        <CardContent>
          {engenheiros.length === 0 ? (
            <p className="text-[15px] text-muted-foreground">
              Cadastre ao menos um engenheiro em{" "}
              <Link
                href="/configuracoes/usuarios"
                className="font-semibold text-prumo-text underline underline-offset-4"
              >
                Usuários
              </Link>{" "}
              antes de criar uma obra.
            </p>
          ) : (
            <FormularioAcao
              acao={criarObraAction}
              className="grid gap-5 space-y-0 sm:grid-cols-2 [&>p]:col-span-full"
            >
              <Campo rotulo="Nome da obra" nome="nome" required className="sm:col-span-2" />
              <Campo rotulo="Endereço" nome="endereco" className="sm:col-span-2" />
              <Campo rotulo="Área (m²)" nome="areaM2" inputMode="decimal" placeholder="1250,50" />
              <Campo
                rotulo="Horário da pergunta diária"
                nome="horarioAnuncio"
                type="time"
                defaultValue="16:00"
              />
              <CampoSelect
                rotulo="Engenheiro responsável"
                nome="engenheiroResponsavelId"
                required
                vazio="Selecione…"
                opcoes={engenheiros.map((e) => ({ valor: e.id, rotulo: e.nome }))}
                className="sm:col-span-2"
              />
              <div className="flex flex-wrap items-center gap-3 border-t pt-5 sm:col-span-2">
                <Button type="submit" className="h-11 px-5">
                  Criar obra
                </Button>
                <Link href="/obras" className={cn(buttonVariants({ variant: "ghost" }), "h-11")}>
                  Cancelar
                </Link>
              </div>
            </FormularioAcao>
          )}
        </CardContent>
      </Card>
    </>
  );
}
