import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { STATUS_EXTRACAO } from "@/lib/rotulos";

const ICONE = { "aria-hidden": true, strokeWidth: 3, strokeLinecap: "square" } as const;

/** Situação da leitura do projeto: verde e vermelho sempre com ✓/✕ e a palavra. */
export function SeloExtracao({ status }: { status: string }) {
  const rotulo = STATUS_EXTRACAO[status] ?? status;
  if (status === "concluida")
    return (
      <Badge variant="nivel">
        <Check {...ICONE} />
        {rotulo}
      </Badge>
    );
  if (status === "falhou")
    return (
      <Badge variant="destructive">
        <X {...ICONE} />
        {rotulo}
      </Badge>
    );
  return <Badge variant={status === "nao_aplicavel" ? "outline" : "secondary"}>{rotulo}</Badge>;
}
