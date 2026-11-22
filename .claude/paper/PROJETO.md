# Prumo no Paper

O que é do Prumo nas skills do Paper (paper-sync, paper-explorer, paper-states, paper-critique): o que precisa estar no ar, a marca, onde mora o código e o domínio. O adaptador em código é o `projeto.mjs`, ao lado. As pastas `exploracoes/` e `estados/` guardam o trabalho até a aprovação, fora do git.

## No ar

- Infra: `pnpm infra:up` (Postgres e Mailpit).
- App: `pnpm dev` respondendo no `APP_URL` do `.env`.
- Login: o `entrar` acha no banco o primeiro admin ativo com login e entra por magic link, lido no Mailpit. Sem admin, rode `pnpm db:seed`. `PAPER_EMAIL=<email>` entra com outro usuário (é assim que se vê outro papel); `MAILPIT_URL` troca o Mailpit.
- Paper Desktop aberto e logado no time Prumo; o arquivo é "Prumo — espelho do app".

_Pronto quando_ `curl -sf "$APP_URL/login"` responde e o Paper está aberto no time Prumo.

## Marca

- Tokens do `apps/web/src/app/globals.css`: `--color-surface`, `--color-surface-raised`, `--color-line`, `--color-ink`, `--color-ink-muted`, `--color-prumo`, `--color-on-prumo`, `--color-prumo-text`, `--color-divergencia`, `--color-nivel`, `--color-liquido`… O tema escuro usa os mesmos nomes com o sufixo `-escuro`.
- Texto em `--color-ink`, texto secundário em `--color-ink-muted`. Selo sobre fundo tingido escurece o texto com `--color-prumo-text`.
- O laranja `--color-prumo` é só para ação. Estado se sinaliza com `--color-divergencia`, `--color-nivel` ou neutros.
- Fontes e pesos carregados:
  - Archivo 700/800 nos títulos;
  - IBM Plex Sans 400/600 no texto;
  - IBM Plex Mono 500 em números e medidas.
- Raios: `rounded-sm`, `rounded-md`, `rounded-2xl`.
- O app não tem alternância global de tema: o escuro do espelho é a classe `dark` no `<html>`, e mostra o que os tokens `.dark` produzem. Seções com `.claro` e `.dark` próprios continuam como no código.
- Foco: o `:focus-visible` global do `globals.css` só some quando alguém escreve `outline-none`.

## Código

- O app é `apps/web`: componentes de `components/ui` (shadcn) e `components/`, com as classes dos tokens.
- Achar a linha de um achado: grep pelo texto, pelo `data-slot` ou pela classe em `apps/web/src`.
- Lint e tipos: `pnpm exec biome check <arquivos>` e `pnpm exec tsc --noEmit -p apps/web`.

## Domínio

- Vocabulário da obra: conferência, execução, tolerância, ponto de controle, etapa, local.
- Papéis: o enum `papel` (admin, engenheiro). O encarregado não entra no painel; o mundo dele é o WhatsApp.
- Status: os `pgEnum` de `packages/db/src/schema/comum.ts` (obra, execução, extração do projeto, revisão do ponto de controle, pendência, etapa no local). Cada valor que a tela pode mostrar é um estado; leia o enum na hora do inventário.
- As famílias de estados, no Prumo: a construtora que acabou de entrar e ainda não tem obra, ponto ou projeto; cem obras, quinhentos pontos; nome de obra, de local ou de etapa que não cabe; sem foto, sem projeto, sem tolerância cadastrada; extração do DWG e geração do PDF ao fundo; o encarregado que mediu enquanto o engenheiro olhava.
- Estados que só o domínio tem:
  - **Medida:** dentro e fora da tolerância, e exatamente no limite.
  - **WhatsApp:** mensagem não entregue, encarregado sem número cadastrado, resposta fora do esperado.
