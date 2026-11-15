import { listarProjetos } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarDataHora, STATUS_EXTRACAO } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { EnvioProjeto } from "./envio";

export const metadata: Metadata = { title: "Projetos" };

export default async function Projetos({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const lista = await listarProjetos(s.contexto, obraId);
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Projetos</CardTitle>
          <CardDescription>
            DWG é lido automaticamente (textos, camadas, ambientes, níveis, carimbo e notas). PDF fica como
            referência. Nova revisão do mesmo código substitui a anterior.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lista.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum projeto enviado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código · revisão</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Disciplina</TableHead>
                  <TableHead>Extração</TableHead>
                  <TableHead>Enviado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((p) => (
                  <TableRow key={p.id} className={p.substituido ? "opacity-60" : ""}>
                    <TableCell className="whitespace-nowrap font-medium">
                      <Link href={`/obras/${obraId}/projetos/${p.id}`} className="hover:underline">
                        {p.codigo} · {p.revisao}
                      </Link>
                      {p.substituido && (
                        <span className="ml-2 text-xs text-muted-foreground">substituído</span>
                      )}
                    </TableCell>
                    <TableCell>{p.titulo}</TableCell>
                    <TableCell className="capitalize">{p.disciplina}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          p.statusExtracao === "falhou"
                            ? "destructive"
                            : p.statusExtracao === "concluida"
                              ? "default"
                              : "outline"
                        }
                      >
                        {STATUS_EXTRACAO[p.statusExtracao] ?? p.statusExtracao}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.enviadoPor} · {formatarDataHora(p.criadoEm)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {
        <Card>
          <CardHeader>
            <CardTitle>Enviar projeto</CardTitle>
          </CardHeader>
          <CardContent>
            <EnvioProjeto obraId={obraId} />
          </CardContent>
        </Card>
      }
    </>
  );
}
