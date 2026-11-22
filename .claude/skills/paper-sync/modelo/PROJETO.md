# <Projeto> no Paper

O que é deste projeto nas skills do Paper (paper-sync, paper-explorer, paper-states, paper-critique): o que precisa estar no ar, a marca, onde mora o código e o domínio. O adaptador em código é o `projeto.mjs`, ao lado. As pastas `exploracoes/` e `estados/` guardam o trabalho até a aprovação, fora do git.

Troque cada `<…>` pelo que vale neste projeto e apague a linha que não se aplica.

## No ar

- Infra: `<comando que sobe banco, e-mail…>`.
- App: `<comando de dev>` respondendo no `APP_URL` do `.env`.
- Login: `<como o entrar abre a sessão, o que ele exige (usuário no banco, seed) e como entrar com outro usuário>`.
- Paper Desktop aberto e logado no time `<time>`.

_Pronto quando_ `curl -sf "$APP_URL<paginaBase>"` responde e o Paper está aberto no time `<time>`.

## Marca

- Tokens do `<caminho do CSS>`: `<lista dos --color-*>`. O tema escuro usa os mesmos nomes com o sufixo `-escuro`.
- Texto em `<token>`, texto secundário em `<token>`.
- A cor de ação `<acento>` é só para ação. Estado se sinaliza com `<tokens de estado>` ou neutros.
- Fontes e pesos carregados: `<família peso/peso no uso>`.
- Raios: `<classes ou tokens>`.

## Código

- O app é `<pastaApp>`: componentes de `<pastas>`, com as classes dos tokens.
- Achar a linha de um achado: grep pelo texto ou pela classe em `<pasta do código>`.
- Lint e tipos: `<comandos>`.

## Domínio

- Vocabulário: `<palavras do domínio que a interface usa>`.
- Papéis: `<papéis de usuário e o que cada um vê>`.
- Status: `<onde estão os enums de status>`. Cada valor que a tela pode mostrar é um estado.
- As famílias de estados, neste domínio: `<exemplos concretos de vazio, muitos itens, conteúdo longo, dado faltando, processamento ao fundo>`.
- Estados que só o domínio tem: `<…>`.
