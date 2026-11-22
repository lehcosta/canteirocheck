"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EstadoAcao } from "@/features/acao";
import { criarObraAction } from "@/features/obras/actions";
import { cn } from "@/lib/utils";

const ERRO = "text-[13px] leading-[18px] text-divergencia";

/** Campo do cadastro: o erro que o serviço aponta para ele aparece embaixo, com a borda vermelha. */
function Campo({
  rotulo,
  nome,
  erro,
  ...props
}: { rotulo: string; nome: string; erro?: string } & Omit<React.ComponentProps<"input">, "name" | "id">) {
  return (
    // content-start: o vizinho de um campo com erro não desce quando a linha da grade cresce
    <div className="grid content-start gap-2">
      <Label htmlFor={nome}>{rotulo}</Label>
      <Input
        id={nome}
        name={nome}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? `${nome}-erro` : undefined}
        {...props}
      />
      {erro && (
        <p id={`${nome}-erro`} className={ERRO}>
          {erro}
        </p>
      )}
    </div>
  );
}

/**
 * Cadastro da obra (passo 1 de 4). Não limpa os campos quando a ação devolve erro; o erro de um campo fica
 * embaixo dele, e o resto acima do botão. Enquanto cria, o botão segue laranja com o giro (o travado cinza do
 * Button é para o que não dá para fazer).
 */
export function FormularioObra({ engenheiros }: { engenheiros: { valor: string; rotulo: string }[] }) {
  const [estado, setEstado] = useState<EstadoAcao>();
  const [pendente, iniciar] = useTransition();
  const erroDe = (campo: string) => (estado?.campo === campo ? estado.erro : undefined);
  const erroGeral = estado?.erro && !estado.campo ? estado.erro : undefined;
  const erroEngenheiro = erroDe("engenheiroResponsavelId");

  return (
    <form
      className="flex flex-col gap-5 rounded-md border bg-card p-5 md:p-6"
      onSubmit={(evento) => {
        evento.preventDefault();
        const dados = new FormData(evento.currentTarget);
        setEstado(undefined); // o erro da tentativa anterior sai enquanto cria
        iniciar(async () => setEstado(await criarObraAction(undefined, dados)));
      }}
    >
      <fieldset disabled={pendente} className="contents">
        <Campo rotulo="Nome da obra" nome="nome" required erro={erroDe("nome")} />
        <Campo rotulo="Endereço" nome="endereco" erro={erroDe("endereco")} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Campo
            rotulo="Área (m²)"
            nome="areaM2"
            inputMode="decimal"
            placeholder="1250,50"
            erro={erroDe("areaM2")}
          />
          <Campo
            rotulo="Horário da pergunta diária"
            nome="horarioAnuncio"
            type="time"
            defaultValue="16:00"
            erro={erroDe("horarioAnuncio")}
          />
        </div>
        <div className="grid content-start gap-2">
          <Label htmlFor="engenheiroResponsavelId">Engenheiro responsável</Label>
          <select
            id="engenheiroResponsavelId"
            name="engenheiroResponsavelId"
            required
            aria-invalid={erroEngenheiro ? true : undefined}
            aria-describedby={erroEngenheiro ? "engenheiroResponsavelId-erro" : undefined}
            className="h-11 w-full rounded-sm border border-input bg-card px-3 text-base text-foreground disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive"
          >
            <option value="">Selecione…</option>
            {engenheiros.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.rotulo}
              </option>
            ))}
          </select>
          {erroEngenheiro && (
            <p id="engenheiroResponsavelId-erro" className={ERRO}>
              {erroEngenheiro}
            </p>
          )}
        </div>
      </fieldset>
      <div className="space-y-5 border-t pt-5">
        {erroGeral && (
          <p role="alert" className="flex items-center gap-2 text-sm text-divergencia">
            <CircleAlert aria-hidden className="size-4 shrink-0" />
            {erroGeral}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={pendente}
            aria-busy={pendente}
            className="disabled:border-transparent disabled:bg-primary disabled:text-primary-foreground"
          >
            {pendente ? (
              <>
                <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
                Criando a obra…
              </>
            ) : (
              <>
                <span className="sm:hidden">Criar e seguir</span>
                <span className="hidden sm:inline">Criar e seguir para a equipe</span>
              </>
            )}
          </Button>
          <Link href="/obras" className={cn(buttonVariants({ variant: "ghost" }), "h-11")}>
            Cancelar
          </Link>
        </div>
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          <span className="md:hidden">Os outros passos esperam na página da obra.</span>
          <span className="hidden md:inline">
            A obra fica salva neste passo; os outros esperam na página dela.
          </span>
        </p>
      </div>
    </form>
  );
}
