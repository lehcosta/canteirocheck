# As oito lentes

Para cada lente: o que o olho pergunta (a medição não responde), o que a medição traz e a correção típica. A marca (tokens, fontes, a cor de ação, raios, componentes) está no `.claude/paper/PROJETO.md`; a correção usa os nomes de lá.

## Hierarquia e contenção (HIE)

- **O olho pergunta:**
  - No `semicerrado.png`, o que se lê primeiro, segundo e terceiro? É a ordem do que a pessoa veio fazer?
  - Existe uma ação principal por janela?
  - O que dá para tirar sem perda: borda, caixa, rótulo repetido, segundo destaque?
  - Algum destaque chama atenção para algo que não pede ação?
- **A medição traz:** primárias na mesma janela; a cor de ação (o `acento` do adaptador) fora de ação; as primeiras leituras (maior corpo × peso); a tipografia em uso.
- **Correção típica:** rebaixar o segundo primário para `variant="outline"` ou `ghost`; sinalizar estado com as cores de estado da marca ou neutros, em vez da cor de ação; tirar a caixa e deixar o espaço separar.

## Espaço (ESP)

- **O olho pergunta:**
  - O que é relacionado está mais perto entre si do que do vizinho (proximidade)?
  - As margens da página e dos cartões repetem o mesmo valor?
  - As colunas se alinham de cima a baixo?
  - A densidade serve ao uso? O painel aguenta ser denso, desde que se leia.
- **A medição traz:** espaçamento fora da grade (valor ímpar); escala com valores demais; inícios de texto e bordas de caixa quase alinhados (1–4px).
- **Correção típica:** trocar o valor solto pelo vizinho da escala (`gap-4`, `p-6`); igualar o padding do cartão e da célula para alinhar o texto na coluna.

## Estabilidade (EST)

- **O olho pergunta:**
  - Algo se move sem a pessoa pedir: conteúdo que chega depois, aviso que empurra, imagem sem tamanho, troca de fonte?
  - O hover ou o foco mudam o tamanho de algo?
  - A página pula entre telas curtas e longas (barra de rolagem)?
- **A medição traz:** cada layout shift do carregamento, com o elemento e o tempo (CLS bom ≤ 0,1), e o controle cujo hover, foco ou pressionado muda o próprio tamanho ou empurra os vizinhos.
- **Correção típica:**
  - reservar espaço (altura mínima, `aspect-ratio`, skeleton do mesmo tamanho);
  - trocar borda que aparece por `outline` ou `ring` (não ocupam espaço), ou deixar a borda transparente no repouso;
  - usar `scrollbar-gutter: stable` no `html`.

## Interação (INT)

- **O olho pergunta (no `estados.png`):**
  - O que é clicável parece clicável?
  - Cada controle responde ao mouse, mostra foco pelo teclado e afunda ao pressionar?
  - O desabilitado parece desabilitado e diz por quê?
  - O clique tem retorno imediato (pendente, sucesso, erro)?
- **A medição traz:** alvo menor que 24×24 (com a exceção de espaçamento do WCAG 2.5.8); cursor que não é de clique; controle sem nome acessível; sem foco visível; sem resposta ao mouse.
- **No celular (`--largura 390`)** a pessoa usa o dedo: "sem resposta ao mouse" vira acabamento, e alvo abaixo de 44px vira atrito, mesmo acima de 24.
- **Correção típica:**
  - estado `hover:` com fundo ou sublinhado;
  - foco: o anel costuma sumir porque alguém escreveu `outline-none` sem pôr outro anel no `focus-visible:`, então procure por ele;
  - `aria-label` em botão só com ícone;
  - aumentar o alvo com padding em vez de aumentar o ícone.

## Contraste e cor (COR)

- **O olho pergunta:**
  - A cor tem sempre o mesmo significado (divergência em vermelho, nível em verde)?
  - Existe outro sinal além da cor (ícone, texto)?
  - O estado mais importante da tela é também o de maior contraste?
- **A medição traz:**
  - contraste de cada texto contra o fundo composto (AA: 4,5:1; texto grande, 3:1);
  - borda de campo contra o fundo (3:1);
  - cores fora dos tokens;
  - a paleta em uso.
- **Correção típica:** passar o texto para o token de texto ou de texto secundário; em selo sobre fundo tingido, escurecer o texto ou clarear o fundo; trocar a cor literal pelo token.

## Texto (TXT)

- **O olho pergunta:**
  - O rótulo diz o que acontece ("Liberar concretagem", não "Confirmar")?
  - O vocabulário é o do domínio?
  - Números e datas estão no formato do idioma do app?
  - A mensagem de erro diz o que fazer?
- **A medição traz:** texto abaixo de 12px; caixa alta sem espaçamento entre letras; texto cortado sem forma de ler o resto; texto vazando; linha longa (mais de 90 caracteres); entrelinha apertada; palavra sozinha na última linha de título; em português, data ISO, ponto decimal e AM/PM; `undefined` ou `null` na tela.
- **Correção típica:** `title` ou tooltip no texto truncado (ou deixar quebrar); `tracking-wider` na caixa alta; `max-w-prose` no parágrafo; `text-wrap: balance` no título; formatar com `Intl` no idioma do app.

## Consistência (CON)

- **O olho pergunta:**
  - O mesmo componente tem a mesma cara e o mesmo comportamento em toda a tela, e nas telas vizinhas?
  - A mesma coisa tem o mesmo nome em todo lugar?
  - Os ícones têm o mesmo tamanho e traço?
- **A medição traz:** fonte fora da marca; peso que a marca não carrega (negrito sintetizado, ou outro peso no lugar); raio fora dos tokens; botões quase iguais; o inventário de variantes e ícones.
- **Correção típica:** usar o componente da biblioteca do app em vez de um botão feito à mão; usar um peso carregado; trocar o raio pelo token (pesos e raios no `PROJETO.md`).

## Movimento (MOV)

- **O olho pergunta:**
  - O movimento explica algo (de onde veio, para onde foi, o que mudou) ou só enfeita?
  - Ele se repete a ponto de cansar?
- **A medição traz:** `transition: all`; resposta acima de 400ms num controle; animação infinita em repouso; animação que continua com "reduzir movimento".
- **Correção típica:** listar as propriedades (`transition-colors`); usar 150–200ms nos estados; envolver o movimento em `motion-safe:`; tirar o loop de quem não está carregando nada.
