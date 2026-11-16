"use client";

import { useState, useTransition } from "react";
import type { Acao, EstadoAcao } from "@/features/acao";
import { cn } from "@/lib/utils";

/**
 * Formulário ligado a uma Server Action.
 * Diferente do `<form action>` puro, NÃO limpa os campos quando a action devolve erro
 * (o engenheiro não precisa redigitar tudo); limpa só em caso de sucesso.
 */
export function FormularioAcao({
  acao,
  children,
  className,
}: {
  acao: Acao;
  children: React.ReactNode;
  className?: string;
}) {
  const [estado, setEstado] = useState<EstadoAcao>();
  const [pendente, iniciar] = useTransition();

  return (
    <form
      className={cn("space-y-3", className)}
      onSubmit={(evento) => {
        evento.preventDefault();
        const form = evento.currentTarget;
        // inclui o botão que enviou (ex.: Liberar × Recusar com o mesmo name)
        const dados = new FormData(form, (evento.nativeEvent as SubmitEvent).submitter);
        iniciar(async () => {
          const r = await acao(undefined, dados);
          setEstado(r);
          if (!r?.erro) form.reset();
        });
      }}
    >
      <fieldset disabled={pendente} className="contents">
        {children}
      </fieldset>
      {estado?.erro && (
        <p role="alert" className="text-sm text-destructive">
          {estado.erro}
        </p>
      )}
      {estado?.ok && (
        <p role="status" className="text-sm font-semibold text-nivel">
          {estado.ok}
        </p>
      )}
    </form>
  );
}
