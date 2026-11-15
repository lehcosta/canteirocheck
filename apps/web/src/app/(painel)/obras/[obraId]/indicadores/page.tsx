import { indicadoresDaObra } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Indicadores" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

export default async function Indicadores({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const lista = await indicadoresDaObra(s.contexto, obraId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Indicadores por etapa</CardTitle>
        <CardDescription>
          Quanto a conferência antes do ponto sem volta está segurando: execuções barradas, causas mais comuns
          e o tempo até a liberação.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem execuções ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Etapa</TableHead>
                <TableHead className="text-right">Execuções</TableHead>
                <TableHead className="text-right">Liberadas</TableHead>
                <TableHead className="text-right">Ok na 1ª rodada</TableHead>
                <TableHead className="text-right">Barradas</TableHead>
                <TableHead>Causas de divergência</TableHead>
                <TableHead className="text-right">Até liberar</TableHead>
                <TableHead className="text-right">Medidas por conversa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((i) => (
                <TableRow key={i.etapa}>
                  <TableCell className="font-medium">{i.etapa}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.execucoes}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.liberadas}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pct(i.okNaPrimeiraRodada, i.liberadas)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{i.bloqueadasOuRecusadas}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal text-sm">
                    {i.causas.length ? i.causas.map((c) => `${c.causa} (${c.quantidade})`).join("; ") : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {i.horasAteLiberacaoMedia === null ? "—" : `${i.horasAteLiberacaoMedia.toFixed(1)} h`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{i.medidasNaoEstruturadas}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
