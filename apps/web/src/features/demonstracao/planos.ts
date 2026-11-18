import { CATALOGO } from "@canteirocheck/core";

const reais = (centavos: number, casas = 2) =>
  (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/**
 * Planos da landing (docs/estudo-precos.md). O preço é por obra ativa, escalonado: 1ª e 2ª a R$ 19,90,
 * 3ª à 6ª a R$ 16,90, 7ª à 15ª a R$ 13,90. O valor de cada plano é o teto da faixa; o ano vale 10 meses.
 */
export const PLANOS = [
  {
    id: "canteiro",
    nome: CATALOGO.canteiro.nome,
    frase: "Para quem toca a obra de perto.",
    preco: reais(CATALOGO.canteiro.centavos.mensal),
    ano: `ou R$ ${reais(CATALOGO.canteiro.centavos.anual, 0)} no ano`,
    obras: `até ${CATALOGO.canteiro.limiteObras} obras ativas`,
    itens: [
      "3 pessoas no painel",
      "Leitura do projeto e do cronograma",
      "Checks e fotos pelo WhatsApp",
      "Relatório em PDF de cada liberação",
    ],
    destaque: false,
  },
  {
    id: "construtora",
    nome: CATALOGO.construtora.nome,
    frase: "Para quem tem várias frentes ao mesmo tempo.",
    preco: reais(CATALOGO.construtora.centavos.mensal),
    ano: `ou R$ ${reais(CATALOGO.construtora.centavos.anual, 0)} no ano`,
    obras: `até ${CATALOGO.construtora.limiteObras} obras ativas`,
    itens: [
      "Painel sem limite de pessoas",
      "Tudo do Canteiro",
      "Indicadores por etapa e por obra",
      "Tolerâncias padrão da empresa",
    ],
    destaque: true,
  },
  {
    id: "grupo",
    nome: CATALOGO.grupo.nome,
    frase: "Para quem precisa do mesmo padrão em todas.",
    preco: reais(CATALOGO.grupo.centavos.mensal),
    ano: `ou R$ ${reais(CATALOGO.grupo.centavos.anual, 0)} no ano`,
    obras: `até ${CATALOGO.grupo.limiteObras} obras ativas`,
    itens: [
      "Painel sem limite de pessoas",
      "Tudo do Construtora",
      "Implantação acompanhada",
      "Atendimento com prioridade",
    ],
    destaque: false,
  },
];

/** Opções do campo "Plano" do pedido de demonstração; o `id` é o valor de `?plano=` na landing. */
export const OPCOES_PLANO = [
  { id: "a-definir", rotulo: "Ainda não sei" },
  ...PLANOS.map((p) => ({
    id: p.id,
    rotulo: `${p.nome} · ${p.obras.replace(" ativas", "")} · R$ ${p.preco}/mês`,
  })),
  { id: "sob-medida", rotulo: "Mais de 15 obras · sob medida" },
] as const;

export type IdPlano = (typeof OPCOES_PLANO)[number]["id"];

export const IDS_PLANO = OPCOES_PLANO.map((o) => o.id) as [IdPlano, ...IdPlano[]];
