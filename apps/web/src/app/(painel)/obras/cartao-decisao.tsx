import type { StatusExecucao } from "@canteirocheck/core";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IconeEstado } from "./selo-execucao";

/** Grade dos cartões de decisão: uma coluna no celular, quantas couberem (mín. 20rem) no resto. */
export function GradeDecisoes({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-4">{children}</div>
  );
}

/**
 * Execução que espera o engenheiro liberar ou recusar.
 * `bloqueada` = divergência confirmada (fora da tolerância); `aguardando_liberacao` = conferência
 * concluída com todos os pontos dentro.
 */
export function CartaoDecisao({
  id,
  href,
  etapaNome,
  localNome,
  status,
  obraNome,
  detalhe,
}: {
  id: string;
  href: string;
  etapaNome: string;
  localNome: string;
  status: StatusExecucao;
  obraNome?: string;
  detalhe: React.ReactNode;
}) {
  const fora = status === "bloqueada";
  const idTitulo = `decisao-${id}`;
  return (
    <article
      aria-labelledby={idTitulo}
      className="flex flex-col gap-4 rounded-md border border-border bg-card p-5"
    >
      <Badge variant={fora ? "destructive" : "nivel"}>
        <IconeEstado dentro={!fora} />
        {fora ? "Fora da tolerância" : "Tudo dentro da tolerância"}
      </Badge>
      <div className="space-y-1">
        <h3 id={idTitulo} className="font-heading text-[22px] leading-7 font-bold">
          <Link href={href} className="underline-offset-4 hover:underline">
            {etapaNome} · {localNome}
          </Link>
        </h3>
        {obraNome && <p className="text-[15px] leading-[22px]">{obraNome}</p>}
        <p className="text-[13px] leading-[18px] text-muted-foreground">{detalhe}</p>
      </div>
      <Link
        href={href}
        aria-describedby={idTitulo}
        className={cn(buttonVariants({ variant: "outline" }), "mt-auto h-11 self-start")}
      >
        Abrir conferência
        <ArrowRight aria-hidden className="size-[18px]" strokeLinecap="square" strokeLinejoin="miter" />
      </Link>
    </article>
  );
}
