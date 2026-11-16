import { listarRelatorios } from "@canteirocheck/servicos";
import { Download, FileText } from "lucide-react";
import type { Metadata } from "next";
import { TituloSecao } from "@/components/cabecalho-pagina";
import { FormularioAcao } from "@/components/formulario-acao";
import { Button, buttonVariants } from "@/components/ui/button";
import { solicitarPdfAction } from "@/features/execucoes/actions";
import { formatarDataHora } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Relatórios" };

/** Limite da consulta em `listarRelatorios`. */
const LIMITE = 50;

export default async function Relatorios({ params }: { params: Promise<{ obraId: string }> }) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const lista = await listarRelatorios(s.contexto, { obraId });

  return (
    <section aria-labelledby="titulo-relatorios" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl space-y-1">
          <TituloSecao id="titulo-relatorios">Relatórios PDF</TituloSecao>
          <p className="text-[15px] text-muted-foreground">
            O de cada execução sai sozinho a cada liberação ou recusa. O da obra inteira sai quando você
            pedir. O link para baixar vale 5 minutos.
          </p>
        </div>
        <FormularioAcao acao={solicitarPdfAction} className="flex flex-col gap-2 space-y-0 sm:items-end">
          <input type="hidden" name="obraId" value={obraId} />
          <Button type="submit" size="lg">
            Gerar relatório da obra
          </Button>
        </FormularioAcao>
      </div>

      {lista.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-concreto bg-card px-6 py-12 text-center">
          <FileText aria-hidden className="size-6 text-muted-foreground" strokeWidth={2} />
          <p className="font-semibold">Nenhum relatório ainda.</p>
          <p className="max-w-md text-sm text-muted-foreground">
            O primeiro sai quando o engenheiro liberar ou recusar uma execução. Para ver a obra inteira agora,
            use Gerar relatório da obra.
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y rounded-md border bg-card">
            {lista.map((r) => {
              const data = formatarDataHora(r.criadoEm);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
                  <div className="min-w-0 flex-[1_1_16rem] space-y-0.5">
                    <p className="font-semibold">{r.titulo}</p>
                    <p className="text-sm text-muted-foreground">
                      {r.execucaoId ? "Execução" : "Obra inteira"} · Gerado{" "}
                      {r.geradoPor ? `por ${r.geradoPor}` : "automaticamente"} em{" "}
                      <span className="tabular-nums">{data}</span>
                    </p>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground tabular-nums" title={r.sha256}>
                    <span className="sr-only">Código de verificação </span>
                    SHA-256 {r.sha256.slice(0, 12)}…
                  </p>
                  <a
                    href={`/api/relatorios/${r.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11")}
                  >
                    <Download aria-hidden />
                    Baixar PDF
                    <span className="sr-only">
                      {" "}
                      — {r.titulo}, {data} (abre em outra aba)
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          {lista.length >= LIMITE && (
            <p className="text-[13px] text-muted-foreground">Mostrando os {LIMITE} mais recentes.</p>
          )}
        </>
      )}
    </section>
  );
}
