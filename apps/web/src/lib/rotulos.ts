export const PAPEL = { admin: "Admin", engenheiro: "Engenheiro", encarregado: "Encarregado" } as const;
export const TIPO_LOCAL = {
  pavimento: "Pavimento",
  laje: "Laje",
  ambiente: "Ambiente",
  eixo: "Eixo",
} as const;
export const STATUS_OBRA = { ativa: "Ativa", pausada: "Pausada", concluida: "Concluída" } as const;

/** +5511999998888 → +55 (11) 99999-8888 */
export function formatarWhatsapp(e164: string): string {
  const m = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(e164);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}
