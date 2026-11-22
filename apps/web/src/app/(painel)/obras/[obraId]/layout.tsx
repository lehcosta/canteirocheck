import { passosDaObra } from "@canteirocheck/core";
import { obterObra } from "@canteirocheck/servicos";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AvisoPronta, FaixaPassos, quandoPergunta, quemRecebe } from "@/components/passos-obra";
import { Badge } from "@/components/ui/badge";
import { carregarAndamento } from "@/features/obras/andamento";
import { STATUS_OBRA } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { AbasObra } from "./abas";

export default async function LayoutObra({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ obraId: string }>;
}) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const obra = await obterObra(s.contexto, obraId);
  if (!obra) notFound();
  // a obra ainda sem algum passo (ou pronta, antes da primeira etapa anunciada) mostra a faixa em todas as abas
  const andamento = await carregarAndamento(obraId);
  const passos = andamento && passosDaObra(andamento.fatos);
  const encarregados = obra.membros.filter((m) => m.papel === "encarregado").map((m) => m.nome);
  return (
    <>
      <header className="space-y-3">
        <ol aria-label="Você está em" className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <li>
            <Link href="/obras" className="hover:text-foreground">
              Obras
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-foreground">
            {obra.nome}
          </li>
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-[28px] leading-8 font-bold tracking-[-0.01em]">{obra.nome}</h1>
          <Badge variant={obra.status === "ativa" ? "outline" : "secondary"}>
            {STATUS_OBRA[obra.status]}
          </Badge>
        </div>
      </header>
      <AbasObra obraId={obra.id} />
      {andamento &&
        passos?.visivel &&
        (passos.pronta ? (
          <AvisoPronta
            quem={quemRecebe(encarregados)}
            quando={quandoPergunta(obra.horarioAnuncio, obra.fusoHorario)}
          />
        ) : (
          <FaixaPassos
            obraId={obra.id}
            passos={passos}
            papel={s.papel}
            responsavel={obra.engenheiroResponsavel.nome}
            sugeridos={andamento.pontosSugeridos.ia + andamento.pontosSugeridos.manual}
            leitura={andamento.leitura?.status ?? null}
            horario={obra.horarioAnuncio.slice(0, 5)}
          />
        ))}
      {children}
    </>
  );
}
