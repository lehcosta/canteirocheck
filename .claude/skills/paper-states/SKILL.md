---
name: paper-states
description: Estados de uma tela do app, listados em palavras e aprovados antes do desenho, depois desenhados no Paper e implementados. Use quando o usuário pedir os estados de uma tela (vazio, carregando, erro, sem permissão…), quando uma tela nova for desenhada, ou quando a paper-explorer aprovar um estudo.
---

# Paper states

Uma tela só está desenhada quando cada **estado** em que ela pode estar está desenhado. O caminho feliz é um estado entre vinte. Por isso a **lista** vem antes do desenho: os estados em palavras, aprovados pelo usuário, e só então o traço. Combinar a lista custa um minuto; descobrir no código um estado que faltou custa um dia.

Um estado é o que a tela mostra numa situação real, dito numa frase, mais o **quando**: o que leva a tela até ele.

As ferramentas são as da paper-explorer, `node .claude/skills/paper-explorer/scripts/explorar.mjs <comando> <pasta>`, com um manifesto de estados ([FORMATO.md](../paper-explorer/FORMATO.md#conjunto-de-estados)). O desenho segue o [dialeto do Paper](../paper-explorer/SKILL.md#dialeto-do-paper).

**O projeto** está em `.claude/paper/PROJETO.md`: a marca, o código e o domínio (papéis, status, os estados que só ele tem). Leia-o antes do passo 1.

## Passos

1. **Base.** A base é a tela no caminho feliz:
   - o estudo aprovado, quando a lista vem depois de uma aprovação na paper-explorer;
   - senão, a captura da rota: rode `node .claude/skills/paper-sync/scripts/sync.mjs --previa --rotas '<rota>' --temas claro` e copie o `<rota>-claro.html` da pasta impressa em `relatório:`.

   Crie a pasta `.claude/paper/estados/<nome>/` (fora do git) e ponha a base nela como `base.html`.
   _Pronto quando_ a base está na pasta e você leu o PNG dela.

2. **Inventário.** Levante os estados no código da tela e no domínio:
   - o `page.tsx` e o que ele lê: cada consulta, cada condição (`?:`, `&&`, `if`), cada lista que pode vir vazia, cada campo que pode vir nulo;
   - os vizinhos da rota: `loading.tsx`, `error.tsx`, `not-found.tsx`, `redirect`;
   - cada formulário e cada ação: enviando, erro de validação, falha do servidor, sucesso;
   - quem vê: cada papel de usuário e o que muda para ele;
   - as famílias de [ESTADOS.md](ESTADOS.md) e a seção "Domínio" do `PROJETO.md`.

   Para cada estado, anote o nome, o que a tela mostra, quando acontece e se o código já trata (`arquivo:linha`) ou não.
   _Pronto quando_ toda condição do código da tela virou estado ou foi descartada com motivo, e toda família de ESTADOS.md tem estado ou "não se aplica" com motivo.

3. **Lista para aprovação.** No chat, só em palavras: uma tabela com estado, o que a tela mostra, quando acontece e se o código já trata. Marque o **dado novo** (o que o app ainda não tem) e os estados que o código não trata hoje. Pergunte quais entram.
   A rodada termina na lista; o desenho começa com a lista aprovada.
   _Pronto quando_ o usuário sabe o que aprovar.

4. **Desenhar.** Com a lista aprovada, incluindo os cortes e acréscimos do usuário:
   - faça um `.html` por estado a partir da base, trocando só o que o estado muda;
   - escreva o `exploracao.json` de estados, com um item por estado. Quando o estado se abre por URL (`/login?erro=link`), ponha a `rota` dele;
   - rode `previa` e meça cada estado com a crítica (`node .claude/skills/paper-critique/scripts/medir.mjs --html <pasta>/<estado>.html`), como no passo 5 da [paper-explorer](../paper-explorer/SKILL.md).

   _Pronto quando_ todo estado aprovado tem tela, a prévia sai sem erro, nenhum estado tem quebra na crítica e cada PNG foi lido depois da última edição.

5. **Enviar e apresentar.** Rode `enviar`; os estados vão para a página "Estados" do Paper. No chat, entregue o link, a lista com o que cada estado mostra e como aprovar (no chat, ou comentando na prancheta).
   A rodada termina aqui; o executivo começa com os estados aprovados.
   _Pronto quando_ toda prancheta saiu `à risca` e o usuário sabe onde abrir e como aprovar.

## Cota do Paper

A `previa` e o `conferir` não gastam cota. O `enviar` gasta umas 3 chamadas por estado e mais umas 10 por envio: vinte estados custam umas 70, e cada rodada de ajuste repete o custo. No plano gratuito a cota é semanal. Por isso:

- itere na prévia e envie uma vez;
- quando a lista aprovada é longa, pergunte quais estados importam mais e envie esses primeiro.

## Quando o usuário volta

Siga o [APROVACAO.md da paper-explorer](../paper-explorer/APROVACAO.md). Num conjunto de estados, a aprovação é do conjunto inteiro, e o executivo implementa e prova estado por estado.
