# Instalar as skills do Paper noutro projeto

As quatro skills andam juntas: paper-explorer e paper-critique importam `paper-sync/scripts/`, e paper-states usa o `explorar.mjs` da paper-explorer. O que é do projeto mora fora delas, em `.claude/paper/`, então trocar as skills por uma versão nova nunca apaga o adaptador.

```
.claude/skills/paper-sync/      paper-explorer/   paper-states/   paper-critique/   ← iguais em todo projeto
.claude/paper/projeto.mjs       adaptador: caminhos, tokens, rota base, arquivo do Paper, login
.claude/paper/PROJETO.md        o que o agente precisa saber: no ar, marca, código, domínio
.claude/paper/exploracoes/      estudos e estados (fora do git)
.claude/paper/estados/
```

## Passos

1. **Copiar as skills.** Copie as quatro pastas `.claude/skills/paper-*` de um projeto que já as usa (só os arquivos do git: o `git archive` ou um clone servem).

2. **Copiar o modelo.** Copie `paper-sync/modelo/` para `.claude/paper/`: `projeto.mjs`, `PROJETO.md` e `.gitignore`.

3. **Ajustar o adaptador.** Em `.claude/paper/projeto.mjs`, cada linha `mude:`. O padrão serve a um app Next (App Router) com Tailwind v4:
   - os tokens são lidos do CSS e **só cor em hex vira token**. Com `oklch` (o padrão do shadcn), o espelho fica sem tokens de cor e a crítica perde a cor de ação: passe as cores para hex ou exporte `lerTokens`;
   - fora do Next, exporte `descobrirRotas`; fora do Tailwind v4, `lerTokens`; com outro jeito de ligar o escuro, `abrirEmRepouso` (contratos no topo do modelo);
   - o `entrar` do modelo é o do Prumo (magic link pelo Mailpit). Escreva o deste app, ou apague-o se o app não tem login.

4. **Preencher o `PROJETO.md`.** Troque cada `<…>`: as quatro skills leem esse arquivo antes de trabalhar.

5. **Dependências.**
   - `@playwright/test` no `package.json` da `pastaApp`, e o Chrome instalado (`PW_CHANNEL` troca o canal);
   - o Paper Desktop com `~/.paper/bin/paper` (`PAPER_BIN` troca o caminho), logado no time do projeto;
   - o que o `entrar` usar (o do Prumo usa `pg` e o Mailpit).

6. **Provar.** Com o app no ar, rode da raiz:

   ```bash
   node .claude/skills/paper-sync/scripts/sync.mjs --previa --rotas '<paginaBase>' --temas claro
   ```

   A prévia não gasta cota do Paper. O `entrar` roda antes da primeira captura, mesmo numa rota pública: com login, ele precisa funcionar já aqui.
   _Pronto quando_ a linha da rota sai `à risca` com 0 blocos.

## Atualizar

Copie de novo as quatro pastas `.claude/skills/paper-*`; `.claude/paper/` fica como está. Se o `projeto.mjs` das skills ganhou um export novo, o modelo mostra o valor que ele espera.
