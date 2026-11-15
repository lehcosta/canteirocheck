import { linhaDoTempo } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COR_STATUS_EXECUCAO, formatarData, formatarDataHora, STATUS_EXECUCAO } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Linha do tempo" };

export default async function LinhaDoTempo({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const itens = await linhaDoTempo(s.contexto, obraId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Linha do tempo</CardTitle>
        <CardDescription>
          Execuções anunciadas pelos encarregados no WhatsApp, da conferência à liberação.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma execução anunciada ainda. Os encarregados anunciam pelo WhatsApp.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data prevista</TableHead>
                <TableHead>Etapa · local</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Anunciada por</TableHead>
                <TableHead>Em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {itens.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums">{formatarData(e.dataPrevista)}</TableCell>
                  <TableCell>
                    <Link href={`/obras/${obraId}/execucoes/${e.id}`} className="font-medium hover:underline">
                      {e.etapaNome} · {e.localNome}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={COR_STATUS_EXECUCAO[e.status]}>{STATUS_EXECUCAO[e.status]}</Badge>
                    {e.rodadaAtual > 1 && (
                      <span className="ml-2 text-xs text-muted-foreground">{e.rodadaAtual}ª rodada</span>
                    )}
                  </TableCell>
                  <TableCell>{e.anunciadaPor}</TableCell>
                  <TableCell className="text-muted-foreground">{formatarDataHora(e.criadoEm)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
