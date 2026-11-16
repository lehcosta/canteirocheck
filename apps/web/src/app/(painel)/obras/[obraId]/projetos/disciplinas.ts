/** Disciplinas aceitas no envio de projeto (mesmos valores do serviço). */
export const DISCIPLINAS = [
  { valor: "arquitetura", rotulo: "Arquitetura" },
  { valor: "estrutura", rotulo: "Estrutura" },
  { valor: "instalacoes", rotulo: "Instalações" },
  { valor: "interiores", rotulo: "Interiores" },
] as const;

export function rotuloDisciplina(valor: string): string {
  return DISCIPLINAS.find((d) => d.valor === valor)?.rotulo ?? valor;
}
