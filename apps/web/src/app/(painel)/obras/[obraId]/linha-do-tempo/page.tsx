import { linhaDoTempo } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import Link from "next/link";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarData, formatarDataHora } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { SeloExecucao } from "../../selo-execucao";

export const metadata: Metadata = { title: "Linha do tempo" };

export default async function LinhaDoTempo({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const itens = await linhaDoTempo(s.contexto, obraId);
  return (
    <section aria-labelledby="titulo-linha" className="space-y-4">
      <div className="space-y-1">
        <TituloSecao id="titulo-linha">Linha do tempo</TituloSecao>
        <p className="text-sm text-muted-foreground">
          Execuções anunciadas pelos encarregados no WhatsApp, da conferência à liberação.
        </p>
      </div>
      {itens.length === 0 ? (
        <p className="rounded-md border border-border bg-card p-5 text-[15px] text-muted-foreground">
          Nenhuma execução anunciada ainda. Os encarregados anunciam pelo WhatsApp.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-11 px-5">Data prevista</TableHead>
                <TableHead className="h-11 px-5">Etapa · local</TableHead>
                <TableHead className="h-11 px-5">Situação</TableHead>
                <TableHead className="h-11 px-5">Anunciada por</TableHead>
                <TableHead className="h-11 px-5">Anunciada em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="px-5 py-4 font-mono tabular-nums">
                    {formatarData(e.dataPrevista)}
                  </TableCell>
                  <TableCell className="px-5 py-4">
                    <Link
                      href={`/obras/${obraId}/execucoes/${e.id}`}
                      className="font-semibold underline-offset-4 hover:underline"
                    >
                      {e.etapaNome} · {e.localNome}
                    </Link>
                  </TableCell>
                  <TableCell className="px-5 py-4">
                    <span className="flex items-center gap-2">
                      <SeloExecucao status={e.status} />
                      {e.rodadaAtual > 1 && (
                        <span className="text-[13px] text-muted-foreground">{e.rodadaAtual}ª rodada</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="px-5 py-4">{e.anunciadaPor}</TableCell>
                  <TableCell className="px-5 py-4 text-muted-foreground tabular-nums">
                    {formatarDataHora(e.criadoEm)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
