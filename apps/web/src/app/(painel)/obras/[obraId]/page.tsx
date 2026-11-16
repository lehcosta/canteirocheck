import type { StatusExecucao } from "@canteirocheck/core";
import { listarUsuarios, obterObra, painelDaObra } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { Campo, CampoSelect } from "@/components/campos";
import { FormularioAcao } from "@/components/formulario-acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adicionarMembroAction, criarLocalAction, removerMembroAction } from "@/features/obras/actions";
import { formatarData, formatarWhatsapp, PAPEL, TIPO_LOCAL } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { cn } from "@/lib/utils";
import { CartaoDecisao, GradeDecisoes } from "../cartao-decisao";

export const metadata: Metadata = { title: "Obra" };

const contar = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const TIPO_CUSTO: Record<string, string> = {
  whatsapp_template: "WhatsApp: mensagens-modelo",
  whatsapp_servico: "WhatsApp: conversas",
  llm_tokens: "IA (tokens)",
  transcricao_audio: "Transcrição de áudio",
};

const dolar = (valor: number, casas: number) =>
  valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });

/** Rótulo pequeno em caixa alta (estilo `label` do DS), para termos de definição. */
const ROTULO = "text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase";

export default async function DetalheObra({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const obra = await obterObra(s.contexto, obraId);
  if (!obra) notFound();

  const usuarios = await listarUsuarios(s.contexto);
  const painel = await painelDaObra(s.contexto, obraId);
  const naEquipe = new Set(obra.membros.map((m) => m.usuarioId));
  const candidatos = usuarios.filter((u) => u.ativo && !naEquipe.has(u.id));
  const nomeLocal = new Map(obra.locais.map((l) => [l.id, `${TIPO_LOCAL[l.tipo]} ${l.nome}`]));
  const aguardando = painel?.aguardandoDecisao ?? [];
  const emAndamento = painel?.emAndamento ?? 0;
  const pendencias = painel?.pendenciasAbertas ?? 0;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-labelledby="titulo-decisao" className="space-y-4 lg:col-span-2">
          <div className="space-y-1">
            <TituloSecao id="titulo-decisao" className="flex items-center gap-3">
              Aguardando decisão
              {aguardando.length > 0 && (
                <Badge className="min-w-6 tracking-normal">{aguardando.length}</Badge>
              )}
            </TituloSecao>
            <p className="text-sm text-muted-foreground">
              Execuções conferidas que só seguem com a liberação do engenheiro responsável.
            </p>
          </div>
          {aguardando.length > 0 ? (
            <GradeDecisoes>
              {aguardando.map((e) => (
                <CartaoDecisao
                  key={e.id}
                  id={e.id}
                  href={`/obras/${obra.id}/execucoes/${e.id}`}
                  etapaNome={e.etapaNome}
                  localNome={e.localNome}
                  status={e.status as StatusExecucao}
                  detalhe={
                    <>
                      Prevista para <span className="tabular-nums">{formatarData(e.dataPrevista)}</span>
                    </>
                  }
                />
              ))}
            </GradeDecisoes>
          ) : (
            <p className="rounded-md border border-border bg-card p-5 text-[15px] text-muted-foreground">
              Nenhuma conferência esperando liberação.
              {emAndamento > 0 &&
                ` ${contar(emAndamento, "execução", "execuções")} em andamento no canteiro.`}
            </p>
          )}
        </section>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>No canteiro</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <dt className={ROTULO}>Em andamento</dt>
                  <dd className="font-heading text-[32px] leading-10 font-bold tabular-nums">
                    {emAndamento}
                  </dd>
                  <dd className="text-[13px] text-muted-foreground">
                    {emAndamento === 1 ? "execução" : "execuções"}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className={ROTULO}>Pendências</dt>
                  <dd
                    className={cn(
                      "font-heading text-[32px] leading-10 font-bold tabular-nums",
                      pendencias > 0 && "text-prumo-text",
                    )}
                  >
                    {pendencias}
                  </dd>
                  <dd className="text-[13px] text-muted-foreground">
                    de projeto {pendencias === 1 ? "aberta" : "abertas"}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Custo acumulado</CardTitle>
              <CardDescription>Mensagens do WhatsApp e IA. Estimativa em dólar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="font-heading text-[32px] leading-10 font-bold tabular-nums">
                {dolar(Number(painel?.custo.total ?? 0), 2)}
              </p>
              {painel?.custo.porTipo.length ? (
                <dl className="divide-y border-t text-sm">
                  {painel.custo.porTipo.map((c) => (
                    <div key={c.tipo} className="flex items-baseline justify-between gap-3 py-2">
                      <dt className="text-muted-foreground">
                        {TIPO_CUSTO[c.tipo] ?? c.tipo}{" "}
                        <span className="font-mono text-xs tabular-nums">
                          ({Number(c.quantidade).toLocaleString("pt-BR")})
                        </span>
                      </dt>
                      <dd className="font-mono tabular-nums">{dolar(Number(c.total), 4)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dados da obra</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <dt className={ROTULO}>Endereço</dt>
              <dd className="text-[15px]">{obra.endereco ?? "—"}</dd>
            </div>
            <div className="space-y-1">
              <dt className={ROTULO}>Área</dt>
              <dd className="font-mono text-[15px] tabular-nums">
                {obra.areaM2
                  ? `${Number(obra.areaM2).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²`
                  : "—"}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className={ROTULO}>Engenheiro responsável</dt>
              <dd className="text-[15px]">{obra.engenheiroResponsavel.nome}</dd>
            </div>
            <div className="space-y-1">
              <dt className={ROTULO}>Pergunta diária</dt>
              <dd className="text-[15px]">
                <span className="font-mono tabular-nums">{obra.horarioAnuncio.slice(0, 5)}</span>{" "}
                <span className="text-sm text-muted-foreground">({obra.fusoHorario})</span>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Locais</CardTitle>
            <CardDescription>
              Pavimentos, lajes, ambientes e eixos usados nos pontos de controle.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {obra.locais.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">Nenhum local cadastrado.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-0">Tipo</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Dentro de</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {obra.locais.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="pl-0 text-muted-foreground">{TIPO_LOCAL[l.tipo]}</TableCell>
                      <TableCell className="font-semibold">{l.nome}</TableCell>
                      <TableCell>
                        {l.paiId ? nomeLocal.get(l.paiId) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <FormularioAcao
              acao={criarLocalAction}
              className="grid gap-3 space-y-0 border-t pt-5 sm:grid-cols-3 [&>p]:col-span-full"
            >
              <input type="hidden" name="obraId" value={obra.id} />
              <CampoSelect
                rotulo="Tipo"
                nome="tipo"
                required
                opcoes={Object.entries(TIPO_LOCAL).map(([valor, rotulo]) => ({ valor, rotulo }))}
              />
              <Campo rotulo="Nome" nome="nome" required placeholder="L4" />
              <CampoSelect
                rotulo="Dentro de"
                nome="paiId"
                vazio="—"
                opcoes={obra.locais.map((l) => ({ valor: l.id, rotulo: nomeLocal.get(l.id) ?? l.nome }))}
              />
              <div className="sm:col-span-3">
                <Button type="submit" variant="outline" className="h-11">
                  Adicionar local
                </Button>
              </div>
            </FormularioAcao>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Equipe</CardTitle>
            <CardDescription>
              Encarregados recebem a pergunta diária e os checklists pelo WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-0">Nome</TableHead>
                  <TableHead className="hidden sm:table-cell">Papel</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {obra.membros.map((m) => (
                  <TableRow key={m.usuarioId}>
                    <TableCell className="pl-0">
                      <span className="font-semibold">{m.nome}</span>
                      <span className="block text-[13px] text-muted-foreground sm:hidden">
                        {PAPEL[m.papel]}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {PAPEL[m.papel]}
                    </TableCell>
                    <TableCell className="font-mono text-sm tabular-nums">
                      {formatarWhatsapp(m.whatsappE164)}
                    </TableCell>
                    <TableCell className="pr-0 text-right">
                      {m.usuarioId === obra.engenheiroResponsavel.id ? (
                        <span className="inline-flex h-9 items-center px-3 text-[13px] text-muted-foreground">
                          Responsável
                        </span>
                      ) : (
                        <FormularioAcao acao={removerMembroAction}>
                          <input type="hidden" name="obraId" value={obra.id} />
                          <input type="hidden" name="usuarioId" value={m.usuarioId} />
                          <Button type="submit" variant="ghost" size="sm" aria-label={`Remover ${m.nome}`}>
                            Remover
                          </Button>
                        </FormularioAcao>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {candidatos.length > 0 && (
              <FormularioAcao
                acao={adicionarMembroAction}
                className="flex flex-wrap items-end gap-3 space-y-0 border-t pt-5 [&>p]:basis-full"
              >
                <input type="hidden" name="obraId" value={obra.id} />
                <CampoSelect
                  rotulo="Adicionar à equipe"
                  nome="usuarioId"
                  required
                  vazio="Selecione…"
                  className="min-w-56 flex-1"
                  opcoes={candidatos.map((u) => ({ valor: u.id, rotulo: `${u.nome} (${PAPEL[u.papel]})` }))}
                />
                <Button type="submit" variant="outline" className="h-11">
                  Adicionar
                </Button>
              </FormularioAcao>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
