import { obterObra } from "@canteirocheck/servicos";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { STATUS_OBRA } from "@/lib/rotulos";
import { exigirSessao } from "@/lib/sessao";
import { AbasObra } from "./abas";

export default async function LayoutObra({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ obraId: string }>;
}) {
  const { obraId } = await params;
  const s = await exigirSessao();
  const obra = await obterObra(s.contexto, obraId);
  if (!obra) notFound();
  return (
    <>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{obra.nome}</h1>
        <Badge variant={obra.status === "ativa" ? "default" : "secondary"}>{STATUS_OBRA[obra.status]}</Badge>
      </div>
      <AbasObra obraId={obra.id} />
      {children}
    </>
  );
}
