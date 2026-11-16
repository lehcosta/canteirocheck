import { aguardaDecisao } from "@canteirocheck/core";
import { linhaDoTempo, listarObras, type ResumoObra } from "@canteirocheck/servicos";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CabecalhoPagina, TituloSecao } from "@/components/cabecalho-pagina";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarData, STATUS_OBRA } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { cn } from "@/lib/utils";
import { CartaoDecisao, GradeDecisoes } from "./cartao-decisao";
import { IconeEstado } from "./selo-execucao";

export const metadata: Metadata = { title: "Obras" };

const contar = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function SeloObra({ status }: { status: ResumoObra["status"] }) {
  if (status === "ativa") return <Badge variant="outline">{STATUS_OBRA.ativa}</Badge>;
  return (
    <Badge variant="secondary">
      {status === "concluida" && <IconeEstado dentro />}
      {STATUS_OBRA[status]}
    </Badge>
  );
}

export default async function Obras() {
  const s = await exigirSessao();
  const obras = await listarObras(s.contexto);

  // Execuções que esperam liberação, de todas as obras (uma consulta por obra, em paralelo).
  const execucoes = await Promise.all(obras.map((o) => linhaDoTempo(s.contexto, o.id)));
  const aguardando = obras
    .flatMap((o, i) =>
      (execucoes[i] ?? []).filter((e) => aguardaDecisao(e.status)).map((e) => ({ ...e, obra: o })),
    )
    .sort(
      (a, b) => b.dataPrevista.localeCompare(a.dataPrevista) || b.criadoEm.getTime() - a.criadoEm.getTime(),
    );

  const ativas = obras.filter((o) => o.status === "ativa").length;
  const resumo = obras.length
    ? `${contar(obras.length, "obra", "obras")}, ${contar(ativas, "ativa", "ativas")}`
    : "Nenhuma obra cadastrada";

  return (
    <>
      <CabecalhoPagina
        titulo="Obras"
        descricao={resumo}
        acoes={
          s.papel === "admin" && (
            <Link href="/obras/nova" className={cn(buttonVariants(), "h-11 px-5")}>
              <Plus aria-hidden className="size-[18px]" strokeWidth={2.25} strokeLinecap="square" />
              Nova obra
            </Link>
          )
        }
      />

      {aguardando.length > 0 && (
        <section aria-labelledby="titulo-decisao" className="space-y-4">
          <TituloSecao id="titulo-decisao" className="flex items-center gap-3">
            {s.papel === "engenheiro" ? "Aguardando sua decisão" : "Aguardando decisão"}
            <Badge className="min-w-6 tracking-normal">{aguardando.length}</Badge>
          </TituloSecao>
          <GradeDecisoes>
            {aguardando.map((e) => (
              <CartaoDecisao
                key={e.id}
                id={e.id}
                href={`/obras/${e.obra.id}/execucoes/${e.id}`}
                etapaNome={e.etapaNome}
                localNome={e.localNome}
                status={e.status}
                obraNome={e.obra.nome}
                detalhe={
                  <>
                    Prevista para <span className="tabular-nums">{formatarData(e.dataPrevista)}</span> ·
                    anunciada por {e.anunciadaPor}
                    {e.rodadaAtual > 1 && ` · ${e.rodadaAtual}ª rodada`}
                  </>
                }
              />
            ))}
          </GradeDecisoes>
        </section>
      )}

      <section aria-labelledby="titulo-obras" className="space-y-4">
        <TituloSecao id="titulo-obras">Todas as obras</TituloSecao>
        {obras.length === 0 ? (
          <p className="rounded-md border border-border bg-card p-5 text-[15px] text-muted-foreground">
            Nenhuma obra cadastrada ainda.
            {s.papel === "admin" && " Use Nova obra para cadastrar a primeira."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-11 px-5">Obra</TableHead>
                  <TableHead className="h-11 px-5">Engenheiro responsável</TableHead>
                  <TableHead className="h-11 px-5">Status</TableHead>
                  <TableHead className="h-11 px-5">Alertas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {obras.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="px-5 py-4 whitespace-normal">
                      <Link
                        href={`/obras/${o.id}`}
                        className="font-semibold underline-offset-4 hover:underline"
                      >
                        {o.nome}
                      </Link>
                      {o.endereco && (
                        <div className="text-[13px] leading-[18px] text-muted-foreground">{o.endereco}</div>
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-4">{o.engenheiroResponsavel}</TableCell>
                    <TableCell className="px-5 py-4">
                      <SeloObra status={o.status} />
                    </TableCell>
                    <TableCell className="px-5 py-4">
                      {o.execucoesBloqueadas === 0 && o.pendenciasAbertas === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {o.execucoesBloqueadas > 0 && (
                            <Badge variant="destructive">
                              <IconeEstado dentro={false} />
                              {contar(o.execucoesBloqueadas, "bloqueada", "bloqueadas")}
                            </Badge>
                          )}
                          {o.pendenciasAbertas > 0 && (
                            <Badge variant="atencao">
                              {contar(o.pendenciasAbertas, "pendência", "pendências")}
                            </Badge>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}
