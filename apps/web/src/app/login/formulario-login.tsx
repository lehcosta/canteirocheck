"use client";

import { Mail, X } from "lucide-react";
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
      <div role="status" className="space-y-6">
        <span className="flex size-12 items-center justify-center rounded-md border bg-card text-prumo-text">
          <Mail aria-hidden className="size-6" />
        </span>
        <div className="space-y-3">
          <h1 className="font-heading text-[40px] leading-[44px] font-extrabold tracking-[-0.02em]">
            Confira seu e-mail
          </h1>
          <p className="text-base text-muted-foreground">
            Se <strong className="font-semibold text-foreground">{enviado}</strong> estiver cadastrado, o link
            de acesso chega em instantes. Ele vale por 15 minutos e funciona uma vez só.
          </p>
        </div>
        <p className="text-[15px] text-muted-foreground">
          Não chegou? Veja a caixa de spam ou{" "}
          <button type="button" onClick={() => setEnviado(null)} className="text-prumo-text underline">
            use outro e-mail
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {erro && (
        <p
          role="alert"
          className="flex items-start gap-3 rounded-md border border-divergencia bg-card px-4 py-3 text-[15px] text-divergencia"
        >
          <X aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2.5} />
          <span>{erro}</span>
        </p>
      )}
      <div className="space-y-3">
        <h1 className="font-heading text-[40px] leading-[44px] font-extrabold tracking-[-0.02em]">
          Entrar no painel
        </h1>
        <p className="text-base text-muted-foreground">
          Use o e-mail cadastrado pela sua construtora. Você recebe um link de acesso, sem senha.
        </p>
      </div>
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
        <Campo
          rotulo="E-mail"
          nome="email"
          type="email"
          autoComplete="email"
          placeholder="voce@construtora.com.br"
          required
          autoFocus
        />
        <Button type="submit" size="lg" className="w-full" disabled={pendente}>
          {pendente ? "Enviando…" : "Enviar link de acesso"}
        </Button>
      </form>
    </div>
  );
}
