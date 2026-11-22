# Como o conversor decide

Referência para corrigir `scripts/conversor.mjs` quando uma tela diverge do gabarito.

## Captura (`sync.mjs`)

- **Rotas**: uma por `page.tsx` em `apps/web/src/app`, fora `/dev` e `/api`. Cada `[param]` é resolvido pelos links das páginas acima dele, usando o primeiro registro do banco.
- **Quem vê a rota**: a rota que abre sem login é capturada anônima (landing, login); as demais, como admin.
- **Janela**: 1440×900, com a página inteira na altura. O foco é tirado (o `autofocus` desenharia o anel), o movimento é reduzido e o overlay do Next fica escondido.
- **Escuro**: classe `dark` no `<html>`. O app não tem alternância global de tema, então o escuro mostra o que os tokens `.dark` do `globals.css` produzem. Seções com `.claro` e `.dark` próprios continuam como no código.
- **Tokens**, lidos do `globals.css`:
  - `--color-*` da marca com o nome do app (valor claro) e com o sufixo `-escuro` (valor do `.dark`);
  - apelidos do shadcn como `var(--color-…)`;
  - `--font-*` resolvidos pelo `next/font` no navegador;
  - `--radius-*`.

  Num nó, a cor vira `var(token)` quando o sRGB bate com algum token (±1 por canal), na ordem marca clara e depois escura. Com alfa, vira `color-mix(var(token) N%, transparent)`.

## Conversão (`conversor.mjs`, roda dentro da página)

- **Flex** vira flex no Paper, com tamanhos explícitos e `flex-shrink: 0`, mas só quando nenhum filho tem margem, `order`, `transform` ou deslocamento relativo. Fora isso (bloco, grid, tabela, margens), os filhos ficam em posição absoluta medida em relação à caixa de padding do pai.
- **Espaçador do flex**: elemento vazio e sem pintura some, menos quando é item de um flex e tem tamanho: aí ele ocupa lugar (o `flex-1` que empurra o pé de um cartão) e vira uma caixa vazia do tamanho medido.
- **Alinhamento do flex**: o Chrome 158 devolve `flex-start`/`flex-end` como `flow-start`/`flow-end` no estilo computado. O Paper não conhece esses nomes e põe o item no começo, então o conversor devolve o nome antigo.
- **Texto**: nós de texto e inlines só de texto viram um nó de texto do Paper. As quebras de linha ficam onde o navegador quebrou: cada palavra é medida, e letra a letra quando a palavra se parte entre linhas. O nó usa `white-space: pre`, e trechos com estilo próprio viram `<span>`. O espaço entre palavras sai no estilo do trecho onde apareceu primeiro, como no CSS: em `Deu <span class="font-mono">3,004</span>`, o espaço é da Plex Sans, não da mono. Um texto truncado com `ellipsis` é cortado onde o navegador corta. Um texto de várias linhas com entrelinha fracionária vira um frame com uma linha por nó, cada uma no topo em que o Chrome a pôs (ver abaixo).
- **Célula de tabela só com texto**: não vira o próprio nó de texto, como os outros elementos sem caixa. A célula centra o texto na altura da linha, então vira um frame e o texto é medido dentro dela.
- **Posição vertical do texto**: o `Range` mede o glifo, mas o Paper posiciona pela caixa da linha, então o topo sobe o meio-entrelinha.
- **Recorte**: `img`, `canvas`, `video`, `iframe`, `select` e inputs não textuais viram recorte do gabarito alinhado à grade de pixels (`paper-asset://`).
- **Campo de texto**: vira um frame com o valor ou o placeholder, na cor do `::placeholder`.
- **SVG**: o SVG é clonado, com `fill` e `stroke` computados em cada elemento (token quando bate) e as classes removidas.

## Onde o Paper difere do CSS

- O Paper ignora `background-clip`. Uma borda transparente sai da caixa e vira deslocamento. Com `bg-clip-padding` (botões do shadcn), a caixa vira frame externo (tamanho da borda) mais frame interno com o fundo. Uma camada absoluta por cima não serve, porque pintaria sobre o texto em fluxo.
- Um filho absoluto se posiciona pelo ancestral posicionado mais próximo, então caixa em fluxo leva `position: relative`.
- Prancheta de altura ímpar sai exportada meio pixel abaixo, e cada borda de 1px vira duas linhas com metade da cor. Por isso a prancheta tem a altura par mais próxima (`alturaPar` em `paper.mjs`): o frame "página" mantém a altura da tela, a linha a mais fica com o fundo da prancheta e a comparação a recorta.
- O Paper empilha as linhas de um texto com entrelinha fracionária (44px × 1,05 = 46,2px) diferente do Chrome: a segunda linha chega a cair 2px abaixo, e a diferença varia de uma gravação para outra. Com cada linha num nó próprio, sobra no máximo o 1px de linha de base que a comparação aceita. Texto de uma linha com entrelinha fracionária não tem esse problema.
- A exportação em lote às vezes deixa uma prancheta fora da resposta, sem erro. O `exportar` de `paper.mjs` exporta essa prancheta de novo, sozinha.
- A exportação PNG vem com perfil ICC. A comparação no navegador converte para sRGB, então o PNG visto cru parece desbotado, mas isso não é divergência.
- Chrome e Paper arredondam a linha de base do texto de jeitos diferentes, o que desloca glifos em até 1px. Por isso a comparação aceita um pixel que bata com um vizinho a 1px de distância.

## Critério à risca

Nenhum bloco de 32×32 px pode ter mais de 5% de pixels divergentes. Um pixel é divergente quando difere em mais de 48 num canal do pixel correspondente e de todos os vizinhos a 1px. As dimensões também precisam bater; a única folga é a linha a mais da prancheta de altura par, que a comparação recorta. A porcentagem global aparece só como informação, porque ela dilui defeito localizado: um ícone com a cor errada dá 0,02% da tela, mas reprova 2 blocos.

## O que as outras skills usam daqui

- Cada captura grava, além do `.json`, um `<rota>-<tema>.html`: o frame "página" no dialeto do Paper, com as imagens em `paper-asset://`. Esse arquivo é o ponto de partida das explorações.
- O `paper-explorer` importa `scripts/paper.mjs`, `scripts/prumo.mjs` e `scripts/comparar.mjs`. O `abrirEmRepouso` do `prumo.mjs` prepara tanto o gabarito do espelho quanto a conferência do executivo de um estudo; mudar o repouso muda as duas provas.
- A `paper-critique` importa `scripts/prumo.mjs` (login, rotas e tokens).
- Depois de mexer num desses módulos, rode as três skills: a prévia da sincronização, a prévia de uma exploração e a medição de uma rota.
- O conversor nomeia as camadas de botão e link como `layer-name="botão"` e `"link"`; a crítica reconhece esses nomes como controle na tela estática.
- As duas skills dividem o mesmo arquivo no Paper. A sincronização só apaga pranchetas `/...` nas páginas "Claro" e "Escuro". As explorações ficam na página "Explorações", com nomes que nunca começam com `/`.
