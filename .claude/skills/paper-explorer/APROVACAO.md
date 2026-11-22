# Aprovação e executivo

O usuário volta de três jeitos: aprova, pede ajuste, ou diz que comentou no Paper. Ele volta a uma exploração de estudos (`.claude/skills/paper-explorer/exploracoes/<nome>/`) ou a um conjunto de estados da `paper-states` (`.claude/skills/paper-states/estados/<nome>/`).

1. **Ler a resposta.** Quando a mensagem do chat nomeia o que foi aprovado ("gostei do A", "os estados estão ok"), ela basta. Leia os comentários quando o usuário disser que comentou, ou quando falar do Paper sem dizer o que aprovou: `explorar.mjs comentarios <pasta>`. Ele lista os comentários abertos da página, com a prancheta de cada um quando dá para saber, e o comentário inteiro em JSON.
   Classifique cada resposta e cada comentário como aprovação, ajuste (pede mudança) ou pergunta.
   _Pronto quando_ cada resposta e cada comentário aberto desta pasta tem classe.

2. **Ajuste e pergunta.**
   - No ajuste, redesenhe a tela e refaça a prévia e a crítica (passo 5 do [SKILL.md](SKILL.md)). Depois rode `enviar`, que substitui as pranchetas no mesmo lugar, e apresente de novo.
   - A pergunta se responde no chat.
   - Marque no Paper o comentário atendido: `explorar.mjs resolver <pasta> <threadId>...`.

   _Pronto quando_ todo comentário atendido está resolvido e, se houve ajuste, a nova rodada foi apresentada.

3. **Aprovar.** Rode `explorar.mjs aprovar <pasta> <id>` para um estudo, ou `aprovar <pasta> todos` para um conjunto de estados. Grava `aprovado` no `exploracao.json` e, no Paper:
   - **Modo projeto** (a rota já está no espelho): a exploração **sai do projeto**. Na tela cheia, antes disso a variação aprovada **toma o lugar da prancheta da rota** no espelho Claro — um mock, até o executivo re-sincronizar a tela real (o Escuro espera o executivo). Num elemento, só a limpeza: o executivo implementa o elemento.
   - **Explorações/Estados**: marca as pranchetas aprovadas com ✓.

   Se a aprovação veio num comentário, resolva-o.
   _Pronto quando_ o comando imprimiu `aprovado:`.

4. **Estados.** O estudo aprovado é o caminho feliz, um estado entre vinte. Antes do executivo, siga a skill `paper-states` com o estudo como base: a lista dos estados em palavras, aprovada, e depois os estados desenhados e aprovados. Num conjunto de estados já aprovado, este passo está feito.
   _Pronto quando_ o conjunto de estados do estudo tem `aprovado: todos`.

5. **Executivo.** Implemente o que foi aprovado em `apps/web`, com os componentes de `components/ui` e `components/` e as classes dos tokens: o estudo e os estados dele juntos, ou só os estados quando a tela já existe. O conteúdo é o das telas aprovadas. O **dado novo** entra só se o usuário o confirmou; senão fica de fora e vai para o relato. Teste no navegador o que a tela parada não mostra: movimento, estados de controle e a tela no celular.
   Depois, prove:
   - `explorar.mjs conferir <pasta>` fotografa a `rota` em repouso e compara com o estudo aprovado. Num elemento, a foto começa na `ancora`.
   - Num conjunto de estados, prove cada estado com `conferir <pasta> <id>`. Antes, ponha o app nele: a `rota` do estado, um registro no banco, outro papel com `PAPER_EMAIL=<email>`, um erro forçado. O estado que não dá para reproduzir se prova pelo código (`arquivo:linha`) e vai para o relato.
   - A crítica da rota viva: `node .claude/skills/criticar-tela/scripts/medir.mjs --rota '<rota>'`, e também com `--largura 390` se a rota é pública (landing, login).
   - Lint e tipos: `pnpm exec biome check <arquivos>` e `pnpm exec tsc --noEmit -p apps/web`.
   - O espelho: `node .claude/skills/paper-sync/scripts/sync.mjs --rotas '<rota>'`.

   Commit só se o usuário pedir.
   _Pronto quando_:
   - o `conferir` do estudo e de cada estado reproduzível sai `à risca`, ou cada bloco divergente tem causa nomeada (dado novo deixado de fora, conteúdo de exemplo, artefato da conversão herdado do atual);
   - todo estado aprovado está implementado, e o que não deu para reproduzir tem a prova pelo código;
   - a crítica não tem achado novo na região que mudou;
   - lint e tipos passam;
   - o espelho da rota sai `à risca`.

6. **Relato.** No chat:
   - o que mudou, com os arquivos;
   - as provas, com o resultado de cada uma, estado por estado;
   - o que ficou de fora (dado novo, estado que não deu para reproduzir);
   - as chamadas ao Paper gastas.
