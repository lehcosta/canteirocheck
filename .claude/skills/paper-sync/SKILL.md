---
name: paper-sync
description: Espelha no Paper, à risca, o design do app (tokens do CSS e uma prancheta por rota, nos temas claro e escuro) e prova a fidelidade de cada prancheta contra o gabarito.
disable-model-invocation: true
---

# Sincronizar o design com o Paper

O app é a fonte e o Paper é **espelho**. **À risca**: posição, tamanho, cor, fonte e quebra de linha saem do app renderizado no Chrome (`getComputedStyle`, `getBoundingClientRect`), nunca do olho nem do código-fonte lido à mão. O **gabarito** é a foto de cada tela no app; uma prancheta está pronta quando a exportação dela bate com o gabarito.

Aqui o Paper é espelho, não prancheta de criação: o brief, a paleta e a revisão de "qualidade de design" do guia do Paper ficam de fora. A única referência visual é o gabarito.

**O projeto** mora em `.claude/paper/`: o `PROJETO.md` diz o que precisa estar no ar, a marca e o domínio; o `projeto.mjs` é o adaptador que os scripts carregam. Leia o `PROJETO.md` antes do passo 1. Num repositório sem `.claude/paper/`, siga o [INSTALAR.md](INSTALAR.md).

O trabalho pesado é do `scripts/sync.mjs` (da raiz do repositório):

```bash
node .claude/skills/paper-sync/scripts/sync.mjs [--previa] [--rotas '/login,/obras/[obraId]'] [--temas claro,escuro]
```

Ele imprime uma linha por rota × tema (`à risca` ou `divergente`, blocos divergentes, % de pixels) e o caminho do `relatorio.json`, que traz para cada linha o `gabarito`, a `previa`/`paper`, o `diff` e os `primeirosBlocos` divergentes.

## Passos

1. **Pré-requisitos.** Os da seção "No ar" do `PROJETO.md`: o app respondendo no `APP_URL` do `.env`, o login do adaptador funcionando e o Paper Desktop aberto e logado no time do projeto. O arquivo do espelho é procurado e criado no time ativo; o script sobe `~/.paper/bin/paper mcp` sozinho, então o MCP do Paper não precisa estar na sessão.
   _Pronto quando_ o "Pronto quando" do `PROJETO.md` vale.

2. **Prévia.** Rode com `--previa`. Ela desenha a conversão no próprio Chrome e compara com o gabarito, sem nenhuma chamada ao Paper.
   _Pronto quando_ toda linha diz `à risca` com 0 blocos. Se alguma diz `divergente`, vá ao passo 4 antes do 3.

3. **Sincronizar.** Rode sem `--previa`. Grava os tokens e as pranchetas no arquivo do projeto no Paper (`arquivoPaper` do adaptador; páginas Claro e Escuro), exporta cada prancheta do Paper e compara com o gabarito. Cada prancheta no seu lugar: a rota nova entra no fim da fileira e, no fim de cada página, o script desempilha o que encosta em outra prancheta.
   _Pronto quando_ toda rota × tema do relatório está `à risca`, ou listada com a causa (passo 4), e cada página imprimiu `sem sobreposição` ou as pranchetas que desempilhou.

4. **Divergência.** Para cada linha `divergente`, abra o `diff` (vermelho é pixel divergente, quadrado é bloco reprovado) e recorte a mesma região do gabarito e da prévia ou exportação. Nomeie a causa e corrija em `scripts/conversor.mjs`, seguindo [CONVERSOR.md](CONVERSOR.md). Depois rode de novo só aquela rota com `--rotas`. A correção vai sempre no conversor: cada sincronização regrava a prancheta inteira, então um ajuste feito à mão no Paper some na próxima rodada.
   _Pronto quando_ a rota passa, ou a causa está nomeada como algo que o Paper não desenha.

5. **Relato.** Diga ao usuário quais rotas foram sincronizadas, quais ficaram de fora (por exemplo, `sem dados no banco para resolver os parâmetros`: falta registro para preencher um `[param]`), as divergências que sobraram com a causa de cada uma e quantas chamadas ao MCP do Paper foram gastas.

## Cota do Paper

No plano gratuito, o Paper limita as chamadas MCP por semana. A mensagem de erro é "Weekly MCP limit reached". Uma prancheta nova custa 3 chamadas e uma existente custa 2, mais 1 exportação por página (e 1 por prancheta que o lote deixar de fora) e umas 5 de abertura. A sincronização completa de 13 rotas × 2 temas gasta perto de 90 chamadas na primeira vez e uns 65 depois. Por isso:

- itere sempre na prévia, que custa 0 chamadas;
- rode o passo 3 uma vez, no fim;
- quando só algumas telas mudaram, use `--rotas`.

O script imprime as chamadas que gastou.

## Opções

- `--rotas`: templates como aparecem no relatório (`/obras/[obraId]/pontos`). Sem essa opção (e sem `--estado`), entram todas as rotas, e as pranchetas de rotas que sumiram do app são apagadas do Paper.
- `--temas`: `claro`, `escuro` ou os dois (padrão).
- `--estado '<rota> · <estado>=<url>'`, repetível: um **estado** da rota, que o registro de exemplo não mostra (porque já passou da etapa que se quer mostrar, por exemplo). Ele é fotografado na URL dada e vira a prancheta "<rota> · <estado>", abaixo da prancheta da rota; os estados de uma rota andam juntos quando o desempilhar os move. A URL aponta para um registro do banco desta worktree, então o estado é uma **foto**: a sincronização completa não o refaz nem o apaga (ele só sai junto com a rota). Para atualizar, rode de novo com o mesmo `--estado`. Com `--estado`, só entram as rotas de `--rotas`.
- Pranchetas sobrepostas vistas a qualquer hora (fora de uma sincronização): `node .claude/skills/paper-sync/scripts/desempilhar.mjs [--paginas Claro,Escuro] [--previa]`, 2 chamadas por página.
- Variáveis de ambiente: `APP_URL`, `PAPER_BIN`, `PAPER_ARQUIVO` (outro arquivo no Paper, para teste), `PAPER_PROJETO` (outro adaptador), `PW_CHANNEL` (canal do Chrome). As do login estão no `PROJETO.md`.
