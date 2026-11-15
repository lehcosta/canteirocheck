"use client";

import { useState, useTransition } from "react";
import { Campo } from "@/components/campos";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function FormularioLogin({ erroInicial }: { erroInicial?: string }) {
  const [enviado, setEnviado] = useState<string | null>(null);
  const [erro, setErro] = useState(erroInicial);
  const [pendente, iniciar] = useTransition();

  if (enviado) {
    return (
      <p role="status" className="text-sm">
        Se <strong>{enviado}</strong> estiver cadastrado, o link de acesso chega em instantes. Ele vale por 15
        minutos.
      </p>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(evento) => {
        evento.preventDefault();
        const email = String(new FormData(evento.currentTarget).get("email") ?? "").trim();
        iniciar(async () => {
          const { error } = await authClient.signIn.magicLink({
            email,
            callbackURL: "/obras",
            errorCallbackURL: "/login?erro=link",
          });
          if (error)
            setErro(
              error.status === 429
                ? "Muitas tentativas. Aguarde um minuto."
                : "Não foi possível enviar o link.",
            );
          else setEnviado(email);
        });
      }}
    >
      <Campo rotulo="E-mail" nome="email" type="email" autoComplete="email" required autoFocus />
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? "Enviando…" : "Receber link de acesso"}
      </Button>
    </form>
  );
}
