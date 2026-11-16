import type { StatusExecucao } from "@canteirocheck/core";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { COR_STATUS_EXECUCAO, STATUS_EXECUCAO } from "@/lib/rotulos";

/** Ícone de estado no traço do DS (pontas retas). Fica como filho direto do Badge, que o dimensiona. */
export function IconeEstado({ dentro }: { dentro: boolean }) {
  const Icone = dentro ? Check : X;
  return <Icone aria-hidden strokeWidth={3} strokeLinecap="square" strokeLinejoin="miter" />;
}

/** Status da execução: verde e vermelho sempre acompanhados de ✓/✕ e da palavra, nunca só a cor. */
export function SeloExecucao({ status }: { status: StatusExecucao }) {
  const variante = COR_STATUS_EXECUCAO[status];
  return (
    <Badge variant={variante}>
      {variante === "nivel" && <IconeEstado dentro />}
      {variante === "destructive" && <IconeEstado dentro={false} />}
      {STATUS_EXECUCAO[status]}
    </Badge>
  );
}
