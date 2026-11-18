import { obterCronograma, obterRiscosDoCronograma } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { Badge } from "@/components/ui/badge";
import { plural } from "@/features/checks/textos";
import { agoraDaTela } from "@/lib/agora";
import { formatarData } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { FaixaDoCruzamento, type SituacaoDoCruzamento } from "./faixa";
import { Gantt } from "./gantt";
import { HistoricoCronograma } from "./historico";
import { ImportarCronograma } from "./importacao";

export const metadata: Metadata = { title: "Cronograma" };

const FUSO = "America/Sao_Paulo";
const dia = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: FUSO });
const hora = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });

export default async function Cronograma({
  params,
  searchParams,
}: {
  params: Promise<{ obraId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { obraId } = await params;
  const { hoje } = agoraDaTela(await searchParams);
  const s = await exigirSessao();
  const [{ versoes, vigente, tarefas }, riscos] = await Promise.all([
    obterCronograma(s.contexto, obraId),
    obterRiscosDoCronograma(s.contexto, obraId, hoje),
  ]);
  const { cruzamento, analise } = riscos;
  const cruzando = cruzamento?.status === "pendente" || cruzamento?.status === "processando";
  const situacao: SituacaoDoCruzamento | null = !riscos.temProjeto
    ? { tipo: "sem-projeto" }
    : cruzando
      ? {
          tipo: "cruzando",
          projetos: cruzamento.projetos,
          versao: vigente?.numero ?? 0,
          desde: hora(cruzamento.criadoEm),
        }
      : cruzamento?.status === "falhou"
        ? { tipo: "falhou", erro: cruzamento.erro ?? "O cruzamento parou sem dizer o motivo." }
        : null;
  return (
    <>
      <ImportarCronograma
        obraId={obraId}
        versoes={versoes.map((v) => ({ id: v.id, numero: v.numero, statusLeitura: v.statusLeitura }))}
        numeroVigente={vigente?.numero ?? null}
      />

      {vigente ? (
        <section aria-labelledby="titulo-cronograma" className="space-y-3">
          <Gantt
            key={vigente.id}
            obraId={obraId}
            tarefas={tarefas}
            hoje={hoje}
            riscos={{
              analise: analise !== null,
              esperando: cruzando && analise === null,
              fases: riscos.fases,
            }}
            faixa={situacao && <FaixaDoCruzamento obraId={obraId} situacao={situacao} />}
            cabecalho={
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-3">
                  <TituloSecao id="titulo-cronograma">Cronograma vigente</TituloSecao>
                  <Badge className="bg-foreground text-card">v{vigente.numero}</Badge>
                  {/* o selo pousa no fundo da página: o cinza dele sumiria ali */}
                  {cruzando && (
                    <Badge variant="secondary" className="bg-card">
                      Cruzando…
                    </Badge>
                  )}
                </div>
                <p className="text-[15px] leading-[22px] text-muted-foreground">
                  {vigente.arquivoNome} · importado por {vigente.enviadoPor} em {dia(vigente.criadoEm)} às{" "}
                  {hora(vigente.criadoEm)}
                  {vigente.termino && ` · término em ${formatarData(vigente.termino)}`}
                </p>
                {analise && (
                  <p className="flex flex-wrap gap-x-2 text-[15px] leading-[22px]">
                    <span className="text-muted-foreground">
                      Cruzado com {plural(analise.projetos, "projeto", "projetos")} em{" "}
                      {dia(analise.concluidoEm)} às {hora(analise.concluidoEm)}:
                    </span>
                    <span className="font-semibold">
                      {plural(analise.riscos, "risco", "riscos")} em {plural(analise.fases, "fase", "fases")},{" "}
                      {plural(analise.perguntas, "pergunta", "perguntas")} de check
                    </span>
                  </p>
                )}
              </div>
            }
          />
        </section>
      ) : (
        <section aria-labelledby="titulo-cronograma" className="space-y-3">
          <TituloSecao id="titulo-cronograma">Cronograma</TituloSecao>
          <p className="rounded-md border bg-card px-4 py-8 text-center text-[15px] text-muted-foreground">
            Nenhum cronograma importado. Envie o arquivo do MS Project para ver o Gantt da obra.
          </p>
        </section>
      )}

      {versoes.length > 0 && (
        <HistoricoCronograma
          obraId={obraId}
          linhas={versoes.map((v) => ({
            id: v.id,
            numero: v.numero,
            vigente: v.vigente,
            arquivoNome: v.arquivoNome,
            statusLeitura: v.statusLeitura,
            erroLeitura: v.erroLeitura,
            totalTarefas: v.totalTarefas,
            termino: v.termino && formatarData(v.termino),
            enviadoPor: v.enviadoPor,
            importadoEm: `${dia(v.criadoEm)} ${hora(v.criadoEm)}`,
          }))}
        />
      )}
    </>
  );
}
