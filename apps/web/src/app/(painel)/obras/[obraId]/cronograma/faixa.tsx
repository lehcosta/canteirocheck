"use client";

import { ArrowRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cruzarDeNovoAction } from "@/features/checks/actions";
import { cn } from "@/lib/utils";

const ICONE = { "aria-hidden": true, strokeWidth: 2, strokeLinecap: "square" } as const;

export type SituacaoDoCruzamento =
  | { tipo: "sem-projeto" }
  | { tipo: "cruzando"; projetos: number; versao: number; desde: string }
  | { tipo: "falhou"; erro: string };

/**
 * Aviso entre o cabeçalho do cronograma e o Gantt, no padrão da caixa de importar: falta o projeto,
 * o cruzamento ainda roda (a tela se atualiza sozinha até ele acabar) ou ele não terminou.
 */
export function FaixaDoCruzamento({ obraId, situacao }: { obraId: string; situacao: SituacaoDoCruzamento }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const cruzando = situacao.tipo === "cruzando";
  useEffect(() => {
    if (!cruzando) return;
    const relogio = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(relogio);
  }, [cruzando, router]);

  const [titulo, texto] =
    situacao.tipo === "sem-projeto"
      ? [
          "Falta o projeto para cruzar com o cronograma",
          // o PDF de projeto ainda não é lido: só o DWG entra no cruzamento
          "Envie o DWG da obra. O cruzamento aponta os riscos de cada fase e sugere as perguntas de check.",
        ]
      : situacao.tipo === "cruzando"
        ? [
            `Cruzando ${situacao.projetos} ${situacao.projetos === 1 ? "projeto" : "projetos"} com o cronograma v${situacao.versao}`,
            `Começou às ${situacao.desde}. Pode sair desta página: os riscos e as perguntas aparecem aqui quando o cruzamento terminar.`,
          ]
        : ["O cruzamento não terminou", situacao.erro];

  function cruzar() {
    setErro(null);
    iniciar(async () => {
      const r = await cruzarDeNovoAction(obraId);
      if (r?.erro) setErro(r.erro);
    });
  }

  return (
    <section
      aria-labelledby="titulo-cruzamento"
      className="relative overflow-hidden rounded-md border bg-card py-4 pr-4 pl-5"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1 basis-80 space-y-0.5">
            <h3 id="titulo-cruzamento" className="text-[15px] leading-[22px] font-semibold">
              {titulo}
            </h3>
            <p className="text-sm text-muted-foreground">{texto}</p>
          </div>
          {situacao.tipo === "sem-projeto" && (
            <Link
              href={`/obras/${obraId}/projetos`}
              className={cn(buttonVariants({ variant: "outline" }), "h-11")}
            >
              Ir para Projetos
              <ArrowRight {...ICONE} />
            </Link>
          )}
          {situacao.tipo === "falhou" && (
            <Button variant="outline" className="h-11" disabled={pendente} onClick={cruzar}>
              <RotateCcw {...ICONE} />
              {pendente ? "Pedindo…" : "Cruzar de novo"}
            </Button>
          )}
        </div>
        {erro && (
          <p role="alert" className="text-right text-sm text-destructive">
            {erro}
          </p>
        )}
      </div>
      {cruzando && (
        // andamento sem número: um trecho cheio correndo na régua do pé (parado em "reduzir movimento")
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-line">
          <div className="h-full w-[300px] bg-foreground motion-safe:animate-andamento" />
        </div>
      )}
    </section>
  );
}
