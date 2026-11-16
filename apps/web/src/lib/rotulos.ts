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

export const STATUS_EXECUCAO = {
  anunciada: "Anunciada",
  em_conferencia: "Em conferência",
  bloqueada: "Bloqueada",
  aguardando_liberacao: "Aguardando liberação",
  liberada: "Liberada",
  recusada: "Recusada",
  cancelada: "Cancelada",
} as const;

/**
 * Variante do Badge por status (DS Prumo): laranja cheio só para o que pede decisão,
 * `nivel` para liberada, `destructive` (divergência) para bloqueada/recusada.
 * Quem usa `nivel`/`destructive` mostra também ✓/✕ ou a palavra, nunca só a cor.
 */
export const COR_STATUS_EXECUCAO: Record<
  keyof typeof STATUS_EXECUCAO,
  "default" | "secondary" | "destructive" | "outline" | "nivel" | "atencao"
> = {
  anunciada: "outline",
  em_conferencia: "secondary",
  bloqueada: "destructive",
  aguardando_liberacao: "default",
  liberada: "nivel",
  recusada: "destructive",
  cancelada: "secondary",
};

export const GRANDEZA = {
  nivel: "Nível",
  distancia: "Distância",
  prumo: "Prumo",
  esquadro: "Esquadro",
  existencia: "Existência",
} as const;

export const UNIDADE = { m: "m", cm: "cm", mm: "mm", booleano: "sim/não" } as const;

export const STATUS_REVISAO = {
  sugerido: "Sugerido",
  aprovado: "Aprovado",
  descartado: "Descartado",
} as const;

export const CANAL = {
  flow: "WhatsApp (formulário)",
  conversa: "WhatsApp (conversa)",
  painel: "Painel",
} as const;

export function formatarData(iso: string): string {
  return iso.split("-").reverse().join("/");
}

export function formatarDataHora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export const STATUS_EXTRACAO: Record<string, string> = {
  pendente: "Na fila",
  processando: "Extraindo…",
  concluida: "Extraído",
  falhou: "Falhou",
  nao_aplicavel: "Referência (PDF)",
};
