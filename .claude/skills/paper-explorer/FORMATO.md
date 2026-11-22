# Formato da exploração

## Pasta

```
.claude/skills/paper-explorer/exploracoes/<nome>/   fora do git (.gitignore da skill)
  exploracao.json      manifesto (abaixo)
  atual.html           ponto de partida, copiado da captura do paper-sync
  a.html, b-1.html…    uma tela por arquivo, no dialeto do Paper
  assets/              imagens das telas, trazidas pela previa (a captura fica no $TMPDIR, que é limpo)
  <tela>.png           prévia de cada tela (gerada pela previa)
  comparativo.png      todos os estudos lado a lado (gerado pela previa)
  <tela>-paper.png     exportação do Paper (gerada pelo enviar)
  <tela>-diff.png      diferença entre a prévia e o Paper (gerada pelo enviar)
  <tela>-app.png       a rota do app depois do executivo (gerada pelo conferir)
  <tela>-app-diff.png  diferença entre o estudo aprovado e o app (gerada pelo conferir)
```

## exploracao.json

```json
{
  "nome": "obras-decisao",
  "alvo": "/obras",
  "rota": "/obras",
  "tema": "claro",
  "pergunta": "Como a lista de obras faz o engenheiro ver, logo ao entrar, a execução parada esperando a decisão dele?",
  "variacoes": [
    { "id": "atual", "partido": "Como está hoje: pendências acima da tabela", "telas": ["atual.html"] },
    { "id": "A", "partido": "A decisão pendente vira a faixa mais forte da tela", "eixo": "hierarquia (refinamento)", "telas": ["a.html"] },
    { "id": "B", "partido": "Cada obra é um cartão que já traz a decisão dela", "eixo": "layout", "telas": ["b.html"] },
    { "id": "C", "partido": "A tela vira uma fila de decisões com as ações à mão", "eixo": "sequência (quebra a lista primeiro)", "telas": ["c-1.html", "c-2.html"] }
  ]
}
```

- `nome`: prefixo das pranchetas no Paper, com até 30 caracteres. O Paper corta nome de camada em 50, e um nome cortado não seria achado no reenvio. Nunca começa com `/`, porque a sincronização do espelho apaga pranchetas `/...` órfãs. O `explorar.mjs` recusa um nome fora dessas regras.
- `variacoes`: os estudos. O `atual` vem primeiro, e mais pelo menos três. Cada estudo tem `id`, `partido` e `telas`; os que não são o atual também levam `eixo`.
- `telas`: uma é tela ou elemento; várias, em ordem, formam um fluxo (uma linha no Paper).
- `rota`: a rota do app onde o estudo aprovado vai morar, como no relatório do espelho (`/obras/[obraId]`). O `conferir` a fotografa; numa rota com `[param]` ou que pede login, ele entra como admin.
- `ancora`: só num elemento. É o seletor CSS do trecho da página onde o estudo começa (`#demonstracao`); o `conferir` fotografa a partir do topo dele, com a altura do estudo. Sem `ancora`, a foto é a página inteira. Num fluxo, o `conferir` compara a primeira tela; os outros passos se provam no navegador.
- Gravados pelos comandos, não à mão: `paper` (arquivo, página e link, pelo `enviar`) e `aprovado` (o id, pelo `aprovar`; um reenvio o apaga).

## Conjunto de estados

A skill `paper-states` usa o mesmo `exploracao.json`, na pasta `.claude/skills/paper-states/estados/<nome>/`, com `"tipo": "estados"` e a lista em `estados` no lugar de `variacoes`:

```json
{
  "tipo": "estados",
  "nome": "login-estados",
  "alvo": "/login",
  "rota": "/login",
  "tema": "claro",
  "pergunta": "Em que estados a tela de login pode estar?",
  "estados": [
    { "id": "feliz", "estado": "Formulário vazio, pronto para o e-mail", "quando": "a pessoa abre o login", "telas": ["feliz.html"] },
    { "id": "link-vencido", "estado": "Aviso de link vencido acima do formulário", "quando": "o link mágico já foi usado", "rota": "/login?erro=link", "telas": ["link-vencido.html"] }
  ]
}
```

- Cada estado tem `id`, `estado` (o que a tela mostra), `quando` (o que leva a tela até ele) e `telas`. Não tem partido nem eixo, nem mínimo de três.
- `rota` num estado: a URL que abre a tela nele, quando existe; senão vale a `rota` do manifesto.
- No Paper, os estados vão para a página "Estados".
- `aprovar <pasta> todos` aprova o conjunto inteiro e marca todas as pranchetas com ✓.
- `conferir <pasta> <id>` prova um estado. O banco, o papel do usuário (`PAPER_EMAIL=<email>`) ou um erro forçado são preparados antes, à mão.

## No Paper

A exploração vai para o arquivo "Prumo — espelho do app" (os tokens são do arquivo), na página "Explorações". As páginas "Claro" e "Escuro" são do espelho.

- Pranchetas: `<nome> · legenda` e `<nome> · <id> · <n>`. A legenda mostra a pergunta e o partido de cada estudo; abaixo dela vem uma linha por estudo, com as telas da esquerda para a direita.
- Aprovado: as pranchetas do estudo aprovado ganham ` ✓` no fim do nome (`login-direita · A · 1 ✓`).
- Comentários: o usuário comenta nas pranchetas. O `comentarios` lista os abertos da página e o `resolver` marca os atendidos.
- Exploração nova: entra 400 px abaixo da última prancheta da página.
- Cada prancheta no seu lugar: no fim do `enviar` (e do `aprovar` que troca a rota) a página é desempilhada. As pranchetas de uma exploração andam juntas e descem inteiras até ficar 200 px abaixo do que encostavam; uma prancheta de rota que caia sobre outra vai para o fim da fileira do topo. A regra mora em `planoDesempilhar` (`paper-sync/scripts/paper.mjs`).
- Reenvio: as pranchetas com o mesmo prefixo são apagadas e recriadas a partir do mesmo topo.
- Conferência: cada prancheta exportada é comparada com a prévia pelo mesmo critério do espelho (`paper-sync/CONVERSOR.md`).

## Checagens da prévia

| Onde | Erro (bloqueia) | Aviso |
|---|---|---|
| texto do HTML | margin, grid, `<table>`, `display: inline`, script/style/link, raiz sem width/height em px | cor literal (hex, rgb, oklch…) em color, background, border, fill ou stroke |
| tela desenhada | — | texto vazando da caixa, fonte ou peso que a marca não carrega, elemento fora da prancheta |

Os pesos aceitos são os que o app carrega de fato (`document.fonts`), não uma lista fixa.

## Código compartilhado

`explorar.mjs` importa de `.claude/skills/paper-sync/scripts/`:

- `paper.mjs`: cliente MCP, arquivo, páginas, tokens e o desempilhar das pranchetas no Paper;
- `prumo.mjs`: caminhos, `.env`, tokens do `globals.css`, login, rotas e a tela em repouso (`abrirEmRepouso`, a mesma do gabarito do espelho);
- `comparar.mjs`: conferência por blocos.

Mudar um desses módulos afeta as duas skills: rode a prévia de cada uma depois de mexer. O próprio `explorar.mjs` também serve à `paper-states`: depois de mexer nele, rode a prévia de uma exploração e a de um conjunto de estados.
