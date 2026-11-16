import { aguardaDecisao, liberacaoExigeJustificativa } from "@canteirocheck/core";
import { listarRelatorios, obterExecucao } from "@canteirocheck/servicos";
import { Check, FileText, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormularioAcao } from "@/components/formulario-acao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { decidirAction, solicitarPdfAction } from "@/features/execucoes/actions";
import { CANAL, COR_STATUS_EXECUCAO, formatarData, STATUS_EXECUCAO } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { cn } from "@/lib/utils";
import { LinhaDoTempoExecucao } from "./linha-do-tempo";
import { DivergenciasDaRodada, dia, FotosDaRodada, hora, type Rodada, TabelaMedidas } from "./medidas";

export const metadata: Metadata = { title: "Execução" };

const ICONE = { "aria-hidden": true, strokeWidth: 3, strokeLinecap: "square" } as const;
const TITULO_SECAO = "text-lg leading-6 font-semibold";
const PAINEL = "space-y-4 rounded-md border bg-card p-5 sm:p-6";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
/** "Concretagem" → "concretagem", sem mexer em siglas no meio do nome. */
const minuscula = (s: string) => s.charAt(0).toLocaleLowerCase("pt-BR") + s.slice(1);

/** Os três números da rodada: medidos, dentro e fora da tolerância. */
function Resumo({ rodada }: { rodada: Rodada }) {
  const total = rodada.pontos.length;
  const medidos = rodada.pontos.filter((p) => p.tentativas.length > 0).length;
  const caixa = "flex min-w-0 flex-col gap-1 rounded-md border bg-card px-4 py-4 sm:px-5";
  const rotulo = "text-xs leading-4 font-semibold tracking-[0.06em] text-muted-foreground uppercase";
  const numero =
    "flex items-center gap-2 font-mono text-[28px] leading-10 font-medium tabular-nums sm:text-[32px]";
  return (
    <dl className="grid grid-cols-3 gap-3 sm:gap-4">
      <div className={caixa}>
        <dt className={rotulo}>Pontos medidos</dt>
        <dd className={numero}>
          {medidos}
          {medidos < total && <span className="text-base text-muted-foreground">de {total}</span>}
        </dd>
      </div>
      <div className={caixa}>
        <dt className={rotulo}>Dentro da tolerância</dt>
        <dd className={cn(numero, "text-nivel")}>
          <Check {...ICONE} className="size-5 shrink-0" />
          {rodada.ok}
        </dd>
      </div>
      <div className={caixa}>
        <dt className={rotulo}>Fora da tolerância</dt>
        <dd className={cn(numero, rodada.divergentes ? "text-divergencia" : "text-foreground")}>
          <X {...ICONE} className="size-5 shrink-0" />
          {rodada.divergentes}
        </dd>
      </div>
    </dl>
  );
}

/** Decisão já registrada na rodada atual (texto "Liberada por …" / "Recusada por …"). */
function DecisaoRegistrada({ decisao }: { decisao: NonNullable<Rodada["decisao"]> }) {
  const liberada = decisao.decisao === "liberada";
  const Icone = liberada ? Check : X;
  return (
    <div className="space-y-2">
      <p
        className={cn(
          "flex items-center gap-2 text-base font-semibold",
          liberada ? "text-nivel" : "text-divergencia",
        )}
      >
        <Icone {...ICONE} className="size-5 shrink-0" />
        {liberada ? "Liberada" : "Recusada"} por {decisao.engenheiroNome}
      </p>
      <p className="text-sm text-muted-foreground">
        {dia(decisao.criadoEm)} às {hora(decisao.criadoEm)} ·{" "}
        {CANAL[decisao.canal as keyof typeof CANAL] ?? decisao.canal}
      </p>
      {decisao.justificativa && (
        <blockquote className="rounded-md bg-muted px-4 py-3 text-[15px] leading-[22px] whitespace-pre-line">
          {decisao.justificativa}
        </blockquote>
      )}
    </div>
  );
}

export default async function Execucao({
  params,
}: {
  params: Promise<{ obraId: string; execucaoId: string }>;
}) {
  const { obraId, execucaoId } = await params;
  const s = await exigirSessao();
  const e = await obterExecucao(s.contexto, execucaoId);
  if (!e || e.obraId !== obraId) notFound();
  const relatorios = await listarRelatorios(s.contexto, { obraId, execucaoId });
  const ehResponsavel = s.usuarioId === e.engenheiroResponsavel.id;
  const podeDecidir = aguardaDecisao(e.status) && ehResponsavel;
  const exigeJustificativa = liberacaoExigeJustificativa(e.status);
  const atual = e.rodadas.at(-1);
  const anteriores = e.rodadas.slice(0, -1).reverse();
  const variante = COR_STATUS_EXECUCAO[e.status];
  const fora = atual?.divergentes ?? 0;

  const pendente = aguardaDecisao(e.status)
    ? podeDecidir
      ? "Aguardando sua decisão"
      : `Aguardando decisão de ${e.engenheiroResponsavel.nome}`
    : null;

  const situacaoDecisao = atual?.decisao ? (
    <DecisaoRegistrada decisao={atual.decisao} />
  ) : (
    <p className="text-[15px] leading-[22px] text-muted-foreground">
      {e.status === "cancelada"
        ? "Execução cancelada. Não há decisão a tomar."
        : aguardaDecisao(e.status)
          ? `Aguardando a decisão de ${e.engenheiroResponsavel.nome}.`
          : "A decisão abre quando o encarregado enviar a conferência."}
    </p>
  );

  const camposDecisao = (
    <>
      <p className="text-[15px] leading-[22px] text-muted-foreground">
        {exigeJustificativa
          ? `${plural(fora, "ponto está", "pontos estão")} fora da tolerância. Para liberar mesmo assim, escreva a justificativa.`
          : "Todos os pontos estão dentro da tolerância."}
      </p>
      <input type="hidden" name="obraId" value={obraId} />
      <input type="hidden" name="execucaoId" value={e.id} />
      <input type="hidden" name="rodada" value={e.rodadaAtual} />
      <div className="grid gap-2">
        <Label htmlFor="justificativa">
          Justificativa {exigeJustificativa ? "(obrigatória)" : "(obrigatória para recusar)"}
        </Label>
        <textarea
          id="justificativa"
          name="justificativa"
          rows={4}
          className="w-full resize-y rounded-sm border border-input bg-card px-3.5 py-3 text-base text-foreground placeholder:text-muted-foreground"
          placeholder="Ex.: Ajustar forma e reenviar conferência."
        />
      </div>
      <div className="grid gap-3">
        <Button type="submit" name="decisao" value="liberada" size="lg">
          Liberar {minuscula(e.etapaNome)}
        </Button>
        <Button type="submit" name="decisao" value="recusada" variant="destructive" size="lg">
          Recusar
        </Button>
      </div>
      <p className="text-[13px] leading-[18px] text-muted-foreground">
        {e.anunciadaPor} recebe a decisão no WhatsApp. A decisão fica registrada e não pode ser editada
        depois.
      </p>
    </>
  );

  return (
    <>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-heading text-2xl leading-8 font-bold tracking-[-0.01em]">
            {e.etapaNome} · {e.localNome}
          </h2>
          <Badge variant={variante}>
            {variante === "nivel" && <Check {...ICONE} />}
            {variante === "destructive" && <X {...ICONE} />}
            {STATUS_EXECUCAO[e.status]}
          </Badge>
        </div>
        <p className="text-[15px] leading-[22px] text-muted-foreground">
          Rodada {e.rodadaAtual} · Anunciada por {e.anunciadaPor} em {dia(e.criadoEm)} · Prevista para{" "}
          {formatarData(e.dataPrevista)} · Responsável: {e.engenheiroResponsavel.nome}
        </p>
      </header>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-6">
        <div className="min-w-0 space-y-8">
          {atual && atual.pontos.length === 0 ? (
            <div className="space-y-1 rounded-md border bg-card px-5 py-8 text-center text-[15px]">
              <p className="font-semibold">Nenhum ponto de controle aprovado para esta etapa neste local.</p>
              <p className="text-muted-foreground">
                Aprove os pontos em{" "}
                <Link
                  href={`/obras/${obraId}/pontos`}
                  className="font-semibold text-prumo-text underline-offset-4 hover:underline"
                >
                  Pontos de controle
                </Link>{" "}
                para o encarregado ter o que medir.
              </p>
            </div>
          ) : atual ? (
            <>
              <Resumo rodada={atual} />
              <section aria-labelledby="titulo-medidas" className="space-y-3">
                <h3 id="titulo-medidas" className={TITULO_SECAO}>
                  Medidas{e.rodadas.length > 1 ? ` · rodada ${atual.rodada}` : ""}
                </h3>
                <TabelaMedidas rodada={atual} rotulo="Medidas da rodada atual" />
              </section>
              <DivergenciasDaRodada rodada={atual} tituloId="titulo-divergencias" />
              <FotosDaRodada rodada={atual} tituloId="titulo-fotos" />
            </>
          ) : (
            <p className="rounded-md border bg-card px-5 py-8 text-center text-[15px] text-muted-foreground">
              Ainda não há medidas. O encarregado confere pelo WhatsApp.
            </p>
          )}

          {anteriores.length > 0 && (
            <section aria-labelledby="titulo-anteriores" className="space-y-3">
              <h3 id="titulo-anteriores" className={TITULO_SECAO}>
                Rodadas anteriores
              </h3>
              {anteriores.map((r) => (
                <details key={r.rodada} className="group rounded-md border bg-card">
                  <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[15px] font-semibold">
                    Rodada {r.rodada}
                    <span className="font-normal text-muted-foreground">
                      {r.ok} dentro · {r.divergentes} fora
                      {r.decisao &&
                        ` · ${r.decisao.decisao === "liberada" ? "liberada" : "recusada"} por ${r.decisao.engenheiroNome} em ${dia(r.decisao.criadoEm)}`}
                    </span>
                  </summary>
                  <div className="space-y-6 border-t px-5 py-5">
                    <TabelaMedidas rodada={r} rotulo={`Medidas da rodada ${r.rodada}`} />
                    <DivergenciasDaRodada rodada={r} tituloId={`titulo-divergencias-${r.rodada}`} />
                    {r.decisao?.justificativa && (
                      <p className="text-[15px] text-muted-foreground">
                        Justificativa da decisão: {r.decisao.justificativa}
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </section>
          )}
        </div>

        <aside aria-label="Decisão e histórico" className="space-y-6">
          <section aria-labelledby="titulo-decisao" className={PAINEL}>
            <h3 id="titulo-decisao" className={TITULO_SECAO}>
              Decisão{e.rodadas.length > 1 ? ` · rodada ${e.rodadaAtual}` : ""}
            </h3>
            {/* O formulário fica montado mesmo depois da decisão: a revalidação troca só o conteúdo
                e a mensagem de confirmação ("Execução recusada…") continua visível. */}
            {ehResponsavel ? (
              <FormularioAcao key="decisao" acao={decidirAction} className="grid gap-4 space-y-0">
                {podeDecidir ? camposDecisao : situacaoDecisao}
              </FormularioAcao>
            ) : (
              situacaoDecisao
            )}
          </section>

          <section aria-labelledby="titulo-linha" className={PAINEL}>
            <h3 id="titulo-linha" className={TITULO_SECAO}>
              Linha do tempo
            </h3>
            <LinhaDoTempoExecucao execucao={e} pendente={pendente} />
          </section>

          <section aria-labelledby="titulo-relatorio" className={PAINEL}>
            <div className="space-y-1">
              <h3 id="titulo-relatorio" className={TITULO_SECAO}>
                Relatório PDF
              </h3>
              <p className="text-sm text-muted-foreground">
                Sai a cada decisão. Gere de novo quando precisar.
              </p>
            </div>
            {relatorios.length > 0 && (
              <ul className="space-y-1">
                {relatorios.map((r) => (
                  <li key={r.id}>
                    <a
                      href={`/api/relatorios/${r.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 items-center gap-3 rounded-md px-1 hover:bg-muted"
                    >
                      <FileText
                        aria-hidden
                        className="size-5 shrink-0 text-muted-foreground"
                        strokeWidth={2}
                      />
                      <span className="min-w-0">
                        <span className="block text-[15px] font-semibold text-prumo-text">
                          PDF de {dia(r.criadoEm)} às {hora(r.criadoEm)}
                        </span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          sha256 {r.sha256.slice(0, 12)}…
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <FormularioAcao acao={solicitarPdfAction}>
              <input type="hidden" name="obraId" value={obraId} />
              <input type="hidden" name="execucaoId" value={e.id} />
              <Button type="submit" variant="outline" className="w-full">
                Gerar PDF agora
              </Button>
            </FormularioAcao>
          </section>
        </aside>
      </div>
    </>
  );
}
