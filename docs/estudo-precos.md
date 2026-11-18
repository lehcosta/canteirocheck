# Estudo de preços de mercado e proposta de planos

Dados vistos em 2026-11-18. Só entram preços publicados; "sob consulta" não foi estimado.

## Concorrentes e adjacentes no Brasil com preço público

| Produto | Métrica | Preço publicado | Fonte | Confiança |
|---|---|---|---|---|
| Obra Prima | Faixa de obras ativas e usuários | A partir de R$ 399,20/mês; planos de 2, 5 e ilimitadas obras | [oficial](https://obraprima.eng.br/planos/) | Alta na entrada |
| Stant | Faixa de obras e usuários | R$ 149 (1 obra, 6 usuários), R$ 280 (3 obras, 15), R$ 342 (6 obras, 30); acima, orçamento | [oficial](https://stant.com.br/construcao-civil/) | Média (a página é um modelo de 404 que ainda lista os planos) |
| Mais Controle | Base fixa + módulos + usuário extra | R$ 269/mês no anual (2 usuários, obras ilimitadas); diário +R$ 60; IA de compras +R$ 90; usuário extra R$ 40 | [blog oficial](https://maiscontroleerp.com.br/quanto-custa-contratar-um-software-de-gestao-de-obras/) | Alta |
| ConstruXion | Faixa de obras ativas, usuários ilimitados | R$ 139,90 (1 obra), R$ 490 (3), R$ 790 (5), R$ 1.190 (10); implantação à parte | [oficial](https://www.construxion.com.br/precos) | Alta |
| Obras Check | Faixa de obras ativas | R$ 90 (2 obras), R$ 110 (4), R$ 350 (12); teste de 14 dias | [oficial](https://www.obrascheck.com.br/rdo) | Alta |
| ConstruSoft | Fixo, tudo ilimitado | R$ 479,99/mês; de R$ 305,99 em pacotes de 6 a 18 meses; teste de 14 dias | [oficial](https://construsoftbr.com/comparativo) | Alta |
| ObraFácil | Faixa de obras | R$ 79 (1 obra) a R$ 349 (ilimitadas) | [ConstruSoft](https://construsoftbr.com/comparativo), não oficial | Média |

Sob consulta (sem preço público): Sienge Plataforma, Gestor Obras, Construpoint, Prevision, Vobi, Construct IN, Mobuss, Inmeta, Agilean, Checklist Fácil, Produttivo, Autodoc, Procore.

Não confirmados: Diário de Obra Online (site ilegível pelo fetch), Obras Control (não localizado), Construct App (site fora do ar).

## Internacionais de referência

| Produto | Métrica | Preço publicado | Fonte |
|---|---|---|---|
| Fieldwire | Por usuário | Grátis (5 usuários, 3 projetos); US$ 39, 64 e 89 por usuário/mês no anual | [oficial](https://www.fieldwire.com/pricing/) |
| PlanRadar | Por usuário | € 26, € 89 e € 129 por usuário/mês; teste de 30 dias | [oficial](https://www.planradar.com/de/preise/) |
| SafetyCulture | Por assento | Grátis até 10 assentos; US$ 24/assento/mês no anual | [oficial](https://mitti.com/pricing/) |
| Buildertrend | Fixo mensal | Não publica; terceiros estimam US$ 339 a 1.099/mês | [Projul](https://projul.com/blog/buildertrend-pricing-analysis-2026/), não oficial |

## Custo variável: WhatsApp Business Platform no Brasil

- A cobrança é por mensagem entregue, não mais por conversa ([Meta](https://developers.facebook.com/docs/whatsapp/pricing)).
- Utility: cerca de R$ 0,035 por mensagem (agregadores citando a planilha da Meta de 30/09/2026; não oficial).
- Service: 1.000 mensagens grátis por número por mês; depois, o mesmo valor.
- Utility dentro da janela de 24 h deixou de ser grátis em 01/10/2026.
- A 2.000 mensagens por obra/mês, o custo fica perto de R$ 70 por obra. Conferir no [rate card oficial](https://business.whatsapp.com/products/platform-pricing#rates) antes de fechar o modelo de custo.

## Leitura

- **Entrada (1 a 2 obras):** R$ 90 a R$ 150/mês em diário de obra e qualidade; R$ 269 a R$ 400 em gestão completa.
- **Meio (3 a 6 obras):** R$ 280 a R$ 800/mês.
- **Topo com preço público (cerca de 10 obras):** em torno de R$ 1.190/mês. Acima disso, tudo é sob consulta.
- **Métrica dominante:** plano fixo por faixa de obras ativas, com usuários ilimitados ou generosos. Cobrança por usuário é dos internacionais e sai cara em reais.
- **Espaço:** nenhum concorrente com preço público cobra por leitura de IA nem por mensagem de WhatsApp, e ninguém ocupa com preço transparente a faixa de R$ 150 a R$ 500 por obra/mês. Essa segunda parte é inferência dos dados acima.

## Preço escolhido (2026-11-18)

A primeira proposta (R$ 390, R$ 890 e R$ 1.790 por faixa de obras) foi considerada cara para o público brasileiro. O preço passa a ser por obra ativa, caindo conforme a construtora cresce. A cobrança é escalonada: cada obra paga o valor da faixa em que ela cai.

| Obra | Valor por obra/mês |
|---|---|
| 1ª e 2ª | R$ 19,90 |
| 3ª à 6ª | R$ 16,90 |
| 7ª à 15ª | R$ 13,90 |
| mais de 15 | sob consulta |

Exemplos: 2 obras = R$ 39,80; 4 obras = R$ 73,60; 6 obras = R$ 107,40; 15 obras = R$ 232,50. Anual = 10 mensalidades. Os degraus de R$ 16,90 e R$ 13,90 são proposta, a validar.

Custo de WhatsApp: o Prumo não tem chat de IA. Só envia o Flow do questionário, lembretes e cobranças de resposta, todos modelos de utilidade a cerca de R$ 0,035; a resposta do responsável chega pelo Flow e não é cobrada. Com 60 envios por obra no mês (2 por dia), o custo é de uns R$ 2,10 por obra, cerca de 10% dos R$ 19,90 e 15% dos R$ 13,90. O limite prático é a quantidade de lembretes por check, que convém ter teto. Falta medir o custo de IA das leituras de projeto e de cronograma, que ocorre por importação, não por mensagem.

Em aberto: teste grátis de 14 dias, teto de lembretes por check, limite de leituras por IA.
