import { obterProjeto } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormularioAcao } from "@/components/formulario-acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reprocessarAction, resolverPendenciaAction } from "@/features/projetos/actions";
import { STATUS_EXTRACAO } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";

export const metadata: Metadata = { title: "Projeto" };

const RISCO = { alto: "destructive", medio: "default", baixo: "outline" } as const;

export default async function Projeto({
  params,
}: {
  params: Promise<{ obraId: string; projetoId: string }>;
}) {
  const { obraId, projetoId } = await params;
  const s = await exigirSessao();
  const p = await obterProjeto(s.contexto, projetoId);
  if (!p || p.obraId !== obraId) notFound();
  const x = p.extracao;
  const carimbo = x
    ? Object.entries({
        Cliente: x.carimbo.cliente,
        Título: x.carimbo.titulo,
        Fase: x.carimbo.fase,
        Revisão: x.carimbo.revisao,
        Data: x.carimbo.data,
        Folha: x.carimbo.folha,
        Escala: x.carimbo.escala,
        Responsável: x.carimbo.responsavel,
      }).filter(([, v]) => v)
    : [];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">
          {p.codigo} · {p.revisao} — {p.titulo}
        </h2>
        <Badge variant={p.statusExtracao === "falhou" ? "destructive" : "outline"}>
          {STATUS_EXTRACAO[p.statusExtracao]}
        </Badge>
        <a href={`/api/projetos/${p.id}/arquivo`} className="text-sm underline">
          baixar {p.tipoArquivo.toUpperCase()}
        </a>
        {p.tipoArquivo === "dwg" && (
          <FormularioAcao acao={reprocessarAction} className="inline-block">
            <input type="hidden" name="obraId" value={obraId} />
            <input type="hidden" name="projetoId" value={p.id} />
            <Button type="submit" variant="ghost" size="sm">
              Extrair de novo
            </Button>
          </FormularioAcao>
        )}
      </div>
      {p.erroExtracao && <p className="text-sm text-destructive">Erro na extração: {p.erroExtracao}</p>}

      {p.pendencias.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pendências detectadas</CardTitle>
            <CardDescription>Notas do projeto que bloqueiam etapas até serem resolvidas.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {p.pendencias.map((pd) => (
                <li key={pd.id} className="flex flex-wrap items-start gap-2">
                  <Badge variant={RISCO[pd.risco as keyof typeof RISCO] ?? "outline"}>risco {pd.risco}</Badge>
                  <span className="whitespace-pre-line">{pd.textoOriginal}</span>
                  <span className="text-muted-foreground">
                    → bloqueia {pd.etapaNome ?? "—"} · {pd.status} · {pd.classificadoPor}
                  </span>
                  {pd.status === "aberta" && (
                    <FormularioAcao
                      acao={resolverPendenciaAction}
                      className="flex w-full flex-wrap items-center gap-2"
                    >
                      <input type="hidden" name="obraId" value={obraId} />
                      <input type="hidden" name="pendenciaId" value={pd.id} />
                      <input
                        name="nota"
                        placeholder="Como foi resolvida (ex.: definido porcelanato 60x60, rev. R03)"
                        className="h-8 min-w-64 flex-1 rounded-lg border border-input px-2.5 text-sm"
                      />
                      <Button type="submit" name="status" value="resolvida" size="sm" variant="outline">
                        Resolvida
                      </Button>
                      <Button type="submit" name="status" value="descartada" size="sm" variant="ghost">
                        Não é pendência
                      </Button>
                    </FormularioAcao>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {x ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Ambientes</CardTitle>
              <CardDescription>
                Nome e área (texto do projeto ou calculada pela polilinha, em m²)
                {x.unidades.assumida ? " — unidade do desenho não informada: assumido metro" : ""}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {x.ambientes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum ambiente reconhecido.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ambiente</TableHead>
                      <TableHead>Área</TableHead>
                      <TableHead>Origem</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {x.ambientes.map((a) => (
                      <TableRow key={`${a.nome}-${a.x}-${a.y}`}>
                        <TableCell className="font-medium">{a.nome}</TableCell>
                        <TableCell className="tabular-nums">
                          {a.areaM2
                            ? `${Number(a.areaM2).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} m²`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{a.fonteArea}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Carimbo e níveis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid grid-cols-[120px_1fr] gap-y-1">
                {carimbo.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="font-medium">Cotas de nível</p>
              {x.cotasNivel.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma.</p>
              ) : (
                <ul>
                  {x.cotasNivel.map((c) => (
                    <li key={`${c.texto}-${c.x}-${c.y}`}>
                      {c.texto} <span className="text-muted-foreground">({c.camada})</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Notas do projeto</CardTitle>
              <CardDescription>
                Em destaque, as que parecem pendência (pré-filtro por termos como “a definir”, “aguardando”).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {x.notas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma nota.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {x.notas.map((n) => (
                    <li
                      key={`${n.camada}-${n.texto}`}
                      className={n.pareceDependencia ? "rounded bg-amber-50 px-2 py-1" : ""}
                    >
                      <span className="whitespace-pre-line">{n.texto}</span>{" "}
                      <span className="text-xs text-muted-foreground">({n.camada})</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Camadas</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm">
                {x.camadas.map((c) => (
                  <li key={c.nome} className={c.desligada || c.congelada ? "text-muted-foreground" : ""}>
                    {c.nome}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({c.entidades}
                      {c.desligada ? ", desligada" : ""}
                      {c.congelada ? ", congelada" : ""})
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Textos ({x.textos.length})</CardTitle>
              <CardDescription>
                Já sem códigos de formatação. Extraído por {x.versaoExtrator}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
                {x.textos.map((t) => (
                  <li key={`${t.tipo}-${t.camada}-${t.x}-${t.y}-${t.texto}`}>
                    <span className="whitespace-pre-line">{t.texto}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {t.camada}
                      {t.bloco ? ` · bloco ${t.bloco}` : ""}
                      {t.tag ? ` · ${t.tag}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : (
        p.tipoArquivo === "dwg" && (
          <p className="text-sm text-muted-foreground">
            A extração ainda não terminou. Atualize em alguns segundos.
          </p>
        )
      )}
    </>
  );
}
