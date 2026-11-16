import { cn } from "@/lib/utils";

/** Cabeçalho de página do painel: título em Archivo (estilo `title` do DS), descrição curta e ações à direita. */
export function CabecalhoPagina({
  titulo,
  descricao,
  acoes,
  className,
}: {
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  acoes?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="font-heading text-[28px] leading-8 font-bold tracking-[-0.01em]">{titulo}</h1>
        {descricao && <p className="text-[15px] text-muted-foreground">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-3">{acoes}</div>}
    </header>
  );
}

/** Título de seção dentro da página (estilo `heading`). */
export function TituloSecao({
  children,
  className,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <h2 id={id} className={cn("text-lg leading-6 font-semibold", className)}>
      {children}
    </h2>
  );
}
