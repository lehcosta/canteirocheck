import { obterProjeto } from "@canteirocheck/servicos";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { FormularioAcao } from "@/components/formulario-acao";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reprocessarAction, resolverPendenciaAction } from "@/features/projetos/actions";
import { exigirSessao } from "@/lib/sessao";
import { cn } from "@/lib/utils";
import { rotuloDisciplina } from "../disciplinas";
import { SeloExtracao } from "../selo-extracao";

export const metadata: Metadata = { title: "Projeto" };

const RISCO = {
  alto: { variante: "destructive", rotulo: "Risco alto" },
  medio: { variante: "atencao", rotulo: "Risco médio" },
  baixo: { variante: "outline", rotulo: "Risco baixo" },
} as const;
const STATUS_PENDENCIA: Record<string, string> = {
  aberta: "Aberta",
  resolvida: "Resolvida",
  descartada: "Não é pendência",
};
const ORIGEM_AREA: Record<string, string> = {
  texto: "Texto do projeto",
  polilinha: "Calculada pela polilinha",
};

const FUSO = "America/Sao_Paulo";
const dataHora = (d: Date) =>
  `${d.toLocaleDateString("pt-BR", { timeZone: FUSO })} às ${d.toLocaleTimeString("pt-BR", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
  })}`;

const PAINEL = "space-y-4 rounded-md border bg-card p-5 sm:p-6";
const SUBTITULO = "text-lg leading-6 font-semibold";
const ROTULO = "text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase";
const VAZIO = "text-[15px] text-muted-foreground";

function Painel({
  titulo,
  descricao,
  id,
  className,
  children,
}: {
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn(PAINEL, className)}>
      <div className="space-y-1">
        <h3 id={id} className={SUBTITULO}>
          {titulo}
        </h3>
        {descricao && <p className="text-sm text-muted-foreground">{descricao}</p>}
      </div>
      {children}
    </section>
  );
}

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
  const abertas = p.pendencias.filter((pd) => pd.status === "aberta").length;

  return (
    <>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-2xl leading-8 font-bold tracking-[-0.01em]">{p.titulo}</h2>
          <SeloExtracao status={p.statusExtracao} />
          {p.substituido && <Badge variant="secondary">Substituído</Badge>}
        </div>
        <p className="text-[15px] leading-[22px] text-muted-foreground">
          <span className="font-mono font-medium text-foreground">
            {p.codigo} · {p.revisao}
          </span>{" "}
          · {rotuloDisciplina(p.disciplina)} · {p.tipoArquivo.toUpperCase()} · Enviado por {p.enviadoPor} em{" "}
          {dataHora(p.criadoEm)}
        </p>
        <div className="flex flex-wrap items-start gap-3">
          <a
            href={`/api/projetos/${p.id}/arquivo`}
            className={cn(buttonVariants({ variant: "outline" }), "h-11")}
          >
            <Download aria-hidden strokeWidth={2} strokeLinecap="square" />
            Baixar {p.tipoArquivo.toUpperCase()}
          </a>
          {p.tipoArquivo === "dwg" && (
            <FormularioAcao acao={reprocessarAction} className="flex flex-wrap items-center gap-3 space-y-0">
              <input type="hidden" name="obraId" value={obraId} />
              <input type="hidden" name="projetoId" value={p.id} />
              <Button type="submit" variant="ghost" className="h-11">
                Ler o projeto de novo
              </Button>
            </FormularioAcao>
          )}
        </div>
      </header>

      {p.erroExtracao && (
        <div
          role="alert"
          className="space-y-1 rounded-md border border-l-4 border-l-divergencia bg-card px-5 py-4"
        >
          <p className="font-semibold text-divergencia">Não consegui ler o projeto.</p>
          <p className="text-[15px]">{p.erroExtracao}</p>
          <p className="text-sm text-muted-foreground">Confira o arquivo e use “Ler o projeto de novo”.</p>
        </div>
      )}

      {p.pendencias.length > 0 && (
        <section aria-labelledby="titulo-pendencias" className="space-y-4">
          <div className="space-y-1">
            <TituloSecao id="titulo-pendencias" className="flex flex-wrap items-center gap-3">
              Pendências detectadas
              {abertas > 0 && <Badge>{abertas === 1 ? "1 aberta" : `${abertas} abertas`}</Badge>}
            </TituloSecao>
            <p className="text-[15px] text-muted-foreground">
              Notas do projeto que bloqueiam etapas até serem resolvidas.
            </p>
          </div>
          <ul className="space-y-3">
            {p.pendencias.map((pd) => {
              const risco = RISCO[pd.risco as keyof typeof RISCO];
              const aberta = pd.status === "aberta";
              return (
                <li
                  key={pd.id}
                  className={cn(
                    "space-y-3 rounded-md border bg-card px-5 py-4",
                    aberta ? "border-l-4 border-l-prumo" : "text-muted-foreground",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={risco?.variante ?? "outline"}>
                      {risco?.rotulo ?? `Risco ${pd.risco}`}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Bloqueia {pd.etapaNome ?? "—"} · {STATUS_PENDENCIA[pd.status] ?? pd.status}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "text-[15px] leading-[22px] whitespace-pre-line",
                      aberta && "text-foreground",
                    )}
                  >
                    {pd.textoOriginal}
                  </p>
                  {aberta && (
                    <FormularioAcao
                      acao={resolverPendenciaAction}
                      className="flex flex-wrap items-end gap-3 space-y-0"
                    >
                      <input type="hidden" name="obraId" value={obraId} />
                      <input type="hidden" name="pendenciaId" value={pd.id} />
                      <div className="grid min-w-64 flex-1 gap-2">
                        <Label htmlFor={`nota-${pd.id}`}>Como foi resolvida</Label>
                        <Input
                          id={`nota-${pd.id}`}
                          name="nota"
                          placeholder="Ex.: definido porcelanato 60x60, rev. R03"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="submit"
                          name="status"
                          value="resolvida"
                          variant="outline"
                          className="h-11"
                        >
                          Resolvida
                        </Button>
                        <Button
                          type="submit"
                          name="status"
                          value="descartada"
                          variant="ghost"
                          className="h-11"
                        >
                          Não é pendência
                        </Button>
                      </div>
                    </FormularioAcao>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {x ? (
        <section aria-labelledby="titulo-leitura" className="space-y-4">
          <div className="space-y-1">
            <TituloSecao id="titulo-leitura">Leitura do projeto</TituloSecao>
            <p className="text-[15px] text-muted-foreground">
              Lido em {dataHora(x.criadoEm)}.
              {x.unidades.assumida && " O desenho não informa a unidade: as medidas foram lidas em metro."}
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Painel id="titulo-carimbo" titulo="Carimbo">
              {carimbo.length === 0 ? (
                <p className={VAZIO}>Nenhum campo do carimbo reconhecido.</p>
              ) : (
                <dl className="grid grid-cols-[minmax(0,120px)_1fr] gap-x-4 gap-y-2 text-[15px]">
                  {carimbo.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className={cn(ROTULO, "pt-1")}>{k}</dt>
                      <dd className="min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Painel>

            <Painel id="titulo-cotas" titulo="Cotas de nível" descricao="Como aparecem no desenho.">
              {x.cotasNivel.length === 0 ? (
                <p className={VAZIO}>Nenhuma cota de nível encontrada.</p>
              ) : (
                <ul className="divide-y">
                  {x.cotasNivel.map((c) => (
                    <li
                      key={`${c.texto}-${c.x}-${c.y}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 first:pt-0 last:pb-0"
                    >
                      <span className="font-mono font-medium tabular-nums">{c.texto}</span>
                      <span className="text-[13px] text-muted-foreground">{c.camada}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Painel>

            <Painel
              id="titulo-ambientes"
              titulo="Ambientes"
              descricao="Nome e área, do texto do projeto ou calculada pela polilinha."
              className="lg:col-span-2"
            >
              {x.ambientes.length === 0 ? (
                <p className={VAZIO}>Nenhum ambiente reconhecido.</p>
              ) : (
                <div className="rounded-md border">
                  <Table aria-label="Ambientes" className="min-w-[480px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead scope="col" className="px-4">
                          Ambiente
                        </TableHead>
                        <TableHead scope="col" className="px-4 text-right">
                          Área
                        </TableHead>
                        <TableHead scope="col" className="px-4">
                          Origem da área
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {x.ambientes.map((a) => (
                        <TableRow key={`${a.nome}-${a.x}-${a.y}`} className="hover:bg-transparent">
                          <TableCell className="px-4 font-semibold whitespace-normal">{a.nome}</TableCell>
                          <TableCell className="px-4 text-right font-mono tabular-nums">
                            {a.areaM2
                              ? `${Number(a.areaM2).toLocaleString("pt-BR", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })} m²`
                              : "—"}
                          </TableCell>
                          <TableCell className="px-4 text-muted-foreground">
                            {a.fonteArea ? (ORIGEM_AREA[a.fonteArea] ?? a.fonteArea) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Painel>

            <Painel
              id="titulo-notas"
              titulo="Notas do projeto"
              descricao="Em destaque, as que parecem pendência (termos como “a definir” e “aguardando”)."
              className="lg:col-span-2"
            >
              {x.notas.length === 0 ? (
                <p className={VAZIO}>Nenhuma nota.</p>
              ) : (
                <ul className="space-y-2">
                  {x.notas.map((n) => (
                    <li
                      key={`${n.camada}-${n.texto}`}
                      className={cn(
                        "space-y-1 rounded-md px-4 py-3",
                        n.pareceDependencia ? "border border-l-4 border-l-prumo" : "bg-muted",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {n.pareceDependencia && <Badge variant="atencao">Parece pendência</Badge>}
                        <span className="text-[13px] text-muted-foreground">{n.camada}</span>
                      </div>
                      <p className="text-[15px] leading-[22px] whitespace-pre-line">{n.texto}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Painel>

            <Painel id="titulo-camadas" titulo="Camadas" descricao="Quantidade de elementos por camada.">
              {x.camadas.length === 0 ? (
                <p className={VAZIO}>Nenhuma camada.</p>
              ) : (
                <ul className="max-h-80 divide-y overflow-y-auto pr-1">
                  {x.camadas.map((c) => {
                    const apagada = c.desligada || c.congelada;
                    return (
                      <li
                        key={c.nome}
                        className={cn(
                          "flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0 text-[15px]",
                          apagada && "text-muted-foreground",
                        )}
                      >
                        <span className="min-w-0 break-words">
                          {c.nome}
                          {apagada && (
                            <span className="text-[13px]">
                              {" "}
                              ·{" "}
                              {[c.desligada && "desligada", c.congelada && "congelada"]
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 font-mono text-sm tabular-nums">{c.entidades}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Painel>

            <Painel
              id="titulo-textos"
              titulo={
                <>
                  Textos{" "}
                  <span className="font-mono font-medium text-muted-foreground">{x.textos.length}</span>
                </>
              }
              descricao={`Já sem códigos de formatação. Lido por ${x.versaoExtrator}.`}
            >
              {x.textos.length === 0 ? (
                <p className={VAZIO}>Nenhum texto.</p>
              ) : (
                <ul className="max-h-80 divide-y overflow-y-auto pr-1">
                  {x.textos.map((t) => (
                    <li
                      key={`${t.tipo}-${t.camada}-${t.x}-${t.y}-${t.texto}`}
                      className="py-2 first:pt-0 last:pb-0"
                    >
                      <span className="block text-[15px] whitespace-pre-line">{t.texto}</span>
                      <span className="block text-[13px] text-muted-foreground">
                        {t.camada}
                        {t.bloco ? ` · bloco ${t.bloco}` : ""}
                        {t.tag ? ` · ${t.tag}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Painel>
          </div>
        </section>
      ) : p.tipoArquivo === "dwg" ? (
        <p className="rounded-md border bg-card px-5 py-8 text-center text-[15px] text-muted-foreground">
          {p.statusExtracao === "falhou"
            ? "A leitura falhou. Confira o arquivo e tente ler de novo."
            : "A leitura do projeto ainda não terminou. Atualize em alguns segundos."}
        </p>
      ) : (
        <p className="rounded-md border bg-card px-5 py-8 text-center text-[15px] text-muted-foreground">
          PDF fica como referência: não há leitura automática.
        </p>
      )}
    </>
  );
}
