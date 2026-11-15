import { listarRelatorios } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { FormularioAcao } from "@/components/formulario-acao";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { solicitarPdfAction } from "@/features/execucoes/actions";
import { formatarDataHora } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Relatórios" };

export default async function Relatorios({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const lista = await listarRelatorios(s.contexto, { obraId });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Relatórios PDF</CardTitle>
        <CardDescription>
          Por execução (gerado a cada liberação ou recusa) e da obra inteira. Os arquivos ficam em bucket
          privado; o link vale 5 minutos.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FormularioAcao acao={solicitarPdfAction}>
          <input type="hidden" name="obraId" value={obraId} />
          <Button type="submit" size="sm">
            Gerar relatório da obra
          </Button>
        </FormularioAcao>
        {lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum relatório gerado ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Relatório</TableHead>
                <TableHead>Gerado em</TableHead>
                <TableHead>Por</TableHead>
                <TableHead>SHA-256</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <a
                      href={`/api/relatorios/${r.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline"
                    >
                      {r.titulo}
                    </a>
                  </TableCell>
                  <TableCell>{formatarDataHora(r.criadoEm)}</TableCell>
                  <TableCell>{r.geradoPor ?? "automático"}</TableCell>
                  <TableCell className="font-mono text-xs">{r.sha256.slice(0, 16)}…</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
