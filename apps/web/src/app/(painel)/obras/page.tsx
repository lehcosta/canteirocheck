import { listarObras } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STATUS_OBRA } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Obras" };

export default async function Obras() {
  const s = await exigirSessao();
  const obras = await listarObras(s.contexto);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Obras</CardTitle>
        {s.papel === "admin" && (
          <Link href="/obras/nova" className={buttonVariants({ size: "sm" })}>
            Nova obra
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {obras.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma obra cadastrada ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Obra</TableHead>
                <TableHead>Engenheiro responsável</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Alertas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {obras.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <Link href={`/obras/${o.id}`} className="font-medium hover:underline">
                      {o.nome}
                    </Link>
                    {o.endereco && <div className="text-xs text-muted-foreground">{o.endereco}</div>}
                  </TableCell>
                  <TableCell>{o.engenheiroResponsavel}</TableCell>
                  <TableCell>
                    <Badge variant={o.status === "ativa" ? "default" : "secondary"}>
                      {STATUS_OBRA[o.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2">
                    {o.execucoesBloqueadas > 0 && (
                      <Badge variant="destructive">{o.execucoesBloqueadas} bloqueada(s)</Badge>
                    )}
                    {o.pendenciasAbertas > 0 && (
                      <Badge variant="outline">{o.pendenciasAbertas} pendência(s)</Badge>
                    )}
                    {o.execucoesBloqueadas === 0 && o.pendenciasAbertas === 0 && (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
