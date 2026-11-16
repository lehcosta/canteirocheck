import type { MensagemSaida } from "./mensagens";

/**
 * Templates (categoria UTILITY, pt_BR) que precisam ser cadastrados e aprovados na Meta.
 * Fora da janela de 24h só template é entregue; por isso o padrão é: template curto com um
 * botão de resposta rápida → o usuário toca → a janela abre → mandamos a mensagem interativa
 * (Flow, botões) que estava esperando. Botão FLOW em template UTILITY não está confirmado na
 * doc (ver docs/referencia-meta-whatsapp.md, Divergências 2), então não dependemos dele.
 */

export interface DefinicaoTemplate {
  nome: string;
  categoria: "UTILITY";
  idioma: "pt_BR";
  corpo: string; // {{1}}, {{2}}… posicionais
  exemplo: string[];
  respostasRapidas: string[]; // textos dos botões
}

export const TEMPLATES = {
  aviso: {
    nome: "canteiro_aviso",
    categoria: "UTILITY",
    idioma: "pt_BR",
    corpo: "Olá, {{1}}. Há uma atualização da obra {{2}}: {{3}}. Toque em Ver para abrir.",
    exemplo: ["Ana", "Edifício Teste", "conferência da concretagem da L4 aguardando sua decisão"],
    respostasRapidas: ["Ver"],
  },
  anuncioDiario: {
    nome: "canteiro_anuncio_diario",
    categoria: "UTILITY",
    idioma: "pt_BR",
    corpo: "Boa tarde, {{1}}. O que vai ser executado amanhã na obra {{2}}? Toque em Anunciar para informar.",
    exemplo: ["João", "Edifício Teste"],
    respostasRapidas: ["Anunciar"],
  },
} as const satisfies Record<string, DefinicaoTemplate>;

export function templateAviso(nome: string, obra: string, assunto: string): MensagemSaida {
  return {
    tipo: "template",
    nome: TEMPLATES.aviso.nome,
    idioma: TEMPLATES.aviso.idioma,
    parametros: [nome, obra, assunto],
    respostasRapidas: ["ver"],
  };
}

export function templateAnuncioDiario(nome: string, obra: string, obraId: string): MensagemSaida {
  return {
    tipo: "template",
    nome: TEMPLATES.anuncioDiario.nome,
    idioma: TEMPLATES.anuncioDiario.idioma,
    parametros: [nome, obra],
    respostasRapidas: [`anunciar:${obraId}`],
  };
}
