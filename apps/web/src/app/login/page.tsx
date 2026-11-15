import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { obterSessao } from "@/lib/sessao";
import { FormularioLogin } from "./formulario-login";

export const metadata: Metadata = { title: "Entrar" };

const ERROS: Record<string, string> = {
  link: "Esse link expirou ou já foi usado. Peça um novo.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (await obterSessao()) redirect("/obras");
  const { erro } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">CanteiroCheck</CardTitle>
          <CardDescription>
            Entre com o e-mail cadastrado pela sua construtora. Você recebe um link de acesso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioLogin erroInicial={erro ? (ERROS[erro] ?? ERROS.link) : undefined} />
        </CardContent>
      </Card>
    </main>
  );
}
