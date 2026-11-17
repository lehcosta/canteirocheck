---
name: paper-explorer
description: Estudos de design no Paper para o usuário aprovar, e o executivo do estudo aprovado no app Prumo. Use quando o usuário pedir para explorar, estudar ou ver alternativas, variações ou opções de uma tela, fluxo ou elemento; quando aprovar ou pedir ajuste num estudo ("gostei do A", "mude o B"); ou quando disser que comentou no Paper.
---

# Paper explorer

Explorar é abrir o leque de **estudos** do mesmo alvo, cada um apostando num **partido**: a ideia central que organiza a tela, dita numa frase. O que separa um estudo do outro é o partido; trocar só cor ou espaçamento não gera estudo novo.

Como na obra: **estudo**, **aprovação**, **executivo**. Os estudos vão para o Paper, e o usuário aprova um no chat ou num comentário na prancheta. O estudo aprovado é só o caminho feliz: os outros estados dele passam pela skill `paper-states`, e só então vem o executivo, a implementação no app.

A marca é fixa: cores, fontes e raios vêm dos tokens do app. O espaço de exploração é estrutura, hierarquia, sequência e linguagem. Paleta, "mood" e brief (o guia do Paper pede isso para design novo) só entram se o usuário pedir para explorar a própria marca.

Ferramentas, sempre da raiz do repositório: `node .claude/skills/paper-explorer/scripts/explorar.mjs <comando> <pasta>`.

- `previa` desenha no Chrome, confere e monta o comparativo. Não gasta cota do Paper.
- `enviar` grava os estudos no Paper e imprime o link da página.
- `comentarios`, `resolver`, `aprovar` e `conferir` servem para a volta do usuário ([APROVACAO.md](APROVACAO.md)).
- A captura da skill `sincronizar-paper` fornece o ponto de partida.

## Quando o usuário volta

Se ele aprova, pede ajuste ou diz que comentou no Paper, siga [APROVACAO.md](APROVACAO.md).

## Passos da rodada de estudos

1. **Enquadrar.** Escreva quatro linhas:
   - o alvo (rota, fluxo ou componente);
   - a pergunta que a exploração responde: o problema, não a solução;
   - quem usa e em que momento;
   - o que não muda: dados que existem, regras do domínio e a marca.

   Se o pedido não trouxer a pergunta, deduza do domínio e escreva. Pergunte ao usuário só quando o próprio alvo for ambíguo.
   _Pronto quando_ as quatro linhas estão escritas e a pergunta não cita nenhuma solução.

2. **Ponto de partida.** Crie a pasta `.claude/skills/paper-explorer/exploracoes/<nome>/`. Ela fica fora do git e guarda a exploração até a aprovação, que pode chegar dias depois.
   - Capture o alvo com `node .claude/skills/sincronizar-paper/scripts/sincronizar.mjs --previa --rotas '<rota>' --temas claro` (0 chamadas ao Paper). Copie como `atual.html` o `<rota>-claro.html` da pasta que esta rodada imprimiu na linha `relatório:`. Cada rodada cria uma pasta nova, e uma pasta antiga traz a tela de antes.
   - Num fluxo, capture um passo por arquivo: `atual-1.html`, `atual-2.html`…
   - Numa tela nova ou num elemento sem rota, capture a rota mais próxima. O HTML dela é o vocabulário: barra lateral, cabeçalho, botões, selos, tabela.
   - No `exploracao.json`, a `rota` diz onde o executivo vai morar. Num elemento, a `ancora` é o seletor do trecho da página onde o estudo começa ([FORMATO.md](FORMATO.md)).

   _Pronto quando_ o atual (ou a rota de vocabulário) está na pasta e você leu o PNG do gabarito.

3. **Leque de partidos.** Antes de desenhar, liste os partidos no `exploracao.json` (formato em [FORMATO.md](FORMATO.md)). São pelo menos três estudos (o `explorar.mjs` recusa menos); passe disso se o usuário pedir. Cada um tem uma frase de tese e o eixo que move: hierarquia, layout, densidade, sequência, padrão de interação ou linguagem. Um estudo é refinamento do atual, outro quebra uma convenção do app, e nenhum par empurra o mesmo eixo na mesma direção. Mostre a lista no chat e siga em frente.
   _Pronto quando_ cada partido cabe numa frase, os eixos não se repetem e o leque tem o refinamento e a quebra.

4. **Desenhar.** Faça uma tela HTML por passo de cada estudo, no dialeto do Paper descrito abaixo, com o conteúdo real do app (o atual e o banco).
   - Se o partido mexe numa região, parta de uma cópia do atual e troque só aquela região.
   - Se o partido muda a estrutura, escreva em flex e reaproveite do atual a barra lateral e os componentes.
   - Dado que o estudo pede e o app ainda não tem entra no HTML e é marcado como **dado novo** na apresentação.

   _Pronto quando_ toda tela listada no manifesto existe.

5. **Prévia e crítica.** Rode `previa`. Ela checa o dialeto e a marca: erro bloqueia; aviso se corrige ou se explica. Depois:
   - Leia cada PNG em tamanho real. O partido aparece em três segundos? Hierarquia, alinhamento e texto estão limpos?
   - Leia o `comparativo.png`. Se dois estudos parecem o mesmo, redesenhe o mais fraco com um partido mais radical.
   - Meça cada estudo com a crítica: `node .claude/skills/criticar-tela/scripts/medir.mjs --html <pasta>/<tela>.html`. Corrija todo achado de quebra. O atual é a tela convertida, com artefatos da conversão; quem quiser criticá-lo usa a rota viva.

   Corrija e rode de novo.
   _Pronto quando_ a prévia sai sem erro, cada aviso foi corrigido ou explicado, nenhum estudo tem quebra na medição da crítica, cada PNG foi lido depois da última edição e o comparativo mostra opções que se distinguem de longe.

6. **Enviar.** Rode `enviar`. Ele grava na página "Explorações" do arquivo do espelho uma legenda e uma linha por estudo, exporta cada prancheta e confere com a prévia. Reenviar a mesma exploração substitui as pranchetas dela no mesmo lugar e pede aprovação nova.
   _Pronto quando_ toda prancheta sai `à risca` na conferência. Se a cota do Paper acabou, entregue o comparativo e diga que os estudos ainda não estão no Paper.

7. **Apresentar.** No chat, entregue:
   - o link da página no Paper, impresso pelo `enviar`;
   - uma tabela com estudo, partido, o que ganha, o que perde e o custo de implementar (componentes novos, dados novos, mudança de fluxo);
   - a recomendação, com o motivo ligado à pergunta do passo 1;
   - como aprovar: dizer o estudo no chat ou comentar na prancheta ("aprovado", "mude X").

   A rodada termina na apresentação; a aprovação abre os estados do estudo, e o executivo vem depois deles.
   _Pronto quando_ o usuário sabe onde abrir os estudos e como aprovar.

## Dialeto do Paper

- Só estilo inline. O layout é feito com flex, padding e gap; posição absoluta serve para sobrepor. O Paper não desenha margin, grid, `<table>` nem `display: inline`, e a prévia barra esses quatro.
- O elemento raiz de cada tela é `position:absolute;left:0px;top:0px`, com `width` e `height` em px. Tela do painel é 1440×900. Elemento é o menor quadro que mostre os estados dele.
- Texto é um `<div>` só com texto, com `font-family`, `font-weight`, `font-size` e `line-height` em px. Trecho com outro estilo vai num `<span>`.
- Cor é sempre token: `var(--color-ink)` ou `color-mix(var(--color-prumo) 10%, transparent)`. Os tokens são os do `globals.css` (`--color-surface`, `--color-surface-raised`, `--color-line`, `--color-ink`, `--color-ink-muted`, `--color-prumo`, `--color-on-prumo`, `--color-divergencia`, `--color-nivel`, `--color-liquido`…). O tema escuro usa os mesmos nomes com o sufixo `-escuro`. O laranja `--color-prumo` é só para ação.
- Fontes e pesos que a marca carrega:
  - Archivo 700/800 nos títulos;
  - IBM Plex Sans 400/600 no texto;
  - IBM Plex Mono 500 em números e medidas.
- Ícone é `<svg>` inline com `stroke` ou `fill` por token. Imagem local é `<img src="paper-asset:///caminho/absoluto.png">`; a `previa` copia para a pasta da exploração as imagens que estão fora dela.
- Botão leva `layer-name="botão"` e link leva `layer-name="link"`. São os nomes que o conversor do espelho usa e que a crítica reconhece como controle.

## Cota do Paper

A `previa` e o `conferir` não gastam cota. O `enviar` gasta umas 3 chamadas por tela e mais umas 10 por envio: uma exploração com o atual e três estudos de uma tela custa umas 25. `aprovar` e `comentarios` gastam 2 cada, e `resolver`, 1 por comentário. No plano gratuito a cota é semanal, então itere na prévia e envie uma vez.
