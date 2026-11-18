import { obterCronograma } from "@canteirocheck/servicos";
import type { Metadata } from "next";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { Badge } from "@/components/ui/badge";
import { formatarData } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { Gantt } from "./gantt";
import { HistoricoCronograma } from "./historico";
import { ImportarCronograma } from "./importacao";

export const metadata: Metadata = { title: "Cronograma" };

const FUSO = "America/Sao_Paulo";
const dia = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: FUSO });
const hora = (d: Date) =>
  d.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit" });
/** Hoje no fuso da obra, AAAA-MM-DD (o formato sueco já é ISO). */
const hojeIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: FUSO });

export default async function Cronograma({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const { versoes, vigente, tarefas } = await obterCronograma(s.contexto, obraId);
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
            tarefas={tarefas}
            hoje={hojeIso()}
            cabecalho={
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-3">
                  <TituloSecao id="titulo-cronograma">Cronograma vigente</TituloSecao>
                  <Badge className="bg-foreground text-card">v{vigente.numero}</Badge>
                </div>
                <p className="text-[15px] text-muted-foreground">
                  {vigente.arquivoNome} · importado por {vigente.enviadoPor} em {dia(vigente.criadoEm)} às{" "}
                  {hora(vigente.criadoEm)}
                  {vigente.termino && ` · término previsto em ${formatarData(vigente.termino)}`}
                </p>
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
