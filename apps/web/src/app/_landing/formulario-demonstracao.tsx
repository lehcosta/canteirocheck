"use client";

import { Check } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pedirDemonstracaoAction } from "@/features/demonstracao/actions";

/** Remonta o formulário (zera o estado da action) quando a pessoa quer mandar outro contato. */
export function FormularioDemonstracao() {
  const [chave, setChave] = useState(0);
  return <Formulario key={chave} outroContato={() => setChave((c) => c + 1)} />;
}

function Formulario({ outroContato }: { outroContato: () => void }) {
  const [estado, enviar, pendente] = useActionState(pedirDemonstracaoAction, undefined);

  if (estado?.ok) {
    return (
      <div role="status" className="space-y-4">
        <span className="flex size-12 items-center justify-center rounded-md bg-[#191816] text-liquido">
          <Check aria-hidden className="size-6" strokeWidth={3} />
        </span>
        <h3 className="font-heading text-[28px] leading-8 font-bold">Recebido.</h3>
        <p className="text-base text-muted-foreground">
          A gente te chama no WhatsApp para marcar a demonstração.
        </p>
        <button type="button" onClick={outroContato} className="text-[15px] text-prumo-text underline">
          Enviar outro contato
        </button>
      </div>
    );
  }

  return (
    <form action={enviar} className="relative space-y-4">
      <h3 className="text-xl font-semibold">Agende uma demonstração</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="nome">Seu nome</Label>
          <Input id="nome" name="nome" autoComplete="name" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="construtora">Construtora</Label>
          <Input id="construtora" name="construtora" autoComplete="organization" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <Input
            id="whatsapp"
            name="whatsapp"
            type="tel"
            autoComplete="tel"
            placeholder="(11) 99999-8888"
            className="font-mono"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="voce@construtora.com.br"
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="obras">Obras em andamento</Label>
        <select
          id="obras"
          name="obras"
          className="h-11 w-full rounded-sm border border-input bg-card px-3 text-base text-foreground"
        >
          <option>1 a 3</option>
          <option>4 a 10</option>
          <option>Mais de 10</option>
        </select>
      </div>
      {/* armadilha para robôs */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="site">Não preencha</label>
        <input id="site" name="site" tabIndex={-1} autoComplete="off" />
      </div>
      {estado?.erro && (
        <p role="alert" className="text-sm font-semibold text-divergencia">
          {estado.erro}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pendente}>
        {pendente ? "Enviando…" : "Quero uma demonstração"}
      </Button>
      <p className="text-[13px] text-muted-foreground">
        Usamos seus dados só para falar com você sobre o Prumo.
      </p>
    </form>
  );
}
