# CanteiroCheck

SaaS B2B para conferir a execução de obra contra o projeto **antes** da etapa que não tem volta (concretagem, fechamento de drywall, piso, forro). Spec do MVP: [docs/prompt-gabarito-mvp.md](docs/prompt-gabarito-mvp.md) · Arquitetura: [docs/arquitetura.md](docs/arquitetura.md).

**Estado:**

- **Etapa 1 (fundação):** monorepo, banco com isolamento por construtora (RLS), login por magic link, cadastro de obras, locais, equipe e usuários, log de auditoria.
- **Etapas 4 e 5 (WhatsApp e Flows):**
  - webhook e endpoint de Flows com a assinatura e a criptografia da Meta;
  - anúncio da execução e checklist dinâmico (medir → refazer → causa + foto → bloqueio);
  - alerta ao engenheiro, que libera ou recusa com justificativa, e aviso ao encarregado;
  - regra da janela de 24h com template;
  - fotos decifradas e guardadas no S3;
  - contador de custo por obra.
- **Etapa 2 (ingestão de DWG):**
  - upload de DWG ou PDF por obra, com revisões;
  - extrator isolado (`services/dwg-extractor`, GPL-3.0, só HTTP);
  - interpretação nossa (`packages/extracao`): textos limpos, camadas, blocos, ambientes com área, cotas de nível, carimbo e notas, com pré-filtro de pendência;
  - tela de extração.
- **Etapa 3 (pendências e pontos com IA):**
  - notas que passam no pré-filtro ("a definir", "aguardando"…) são classificadas por um modelo pequeno em pendência, com a etapa que bloqueia e o risco;
  - o modelo principal sugere pontos de controle, com ênfase em interfaces e sempre citando `trecho_origem`;
  - cada sugestão é conferida contra o texto real do projeto: trecho inventado, valor ilegível ou tolerância negativa são descartados;
  - nada entra no checklist sem a aprovação do engenheiro;
  - fallback conversacional: texto ou áudio do encarregado → medida e ponto prováveis → "Confirma?" → verificação não estruturada, e a comparação continua no `core`;
  - o custo de tokens e de transcrição vai para a obra.
- **Etapa 6 (liberação e relatório):**
  - painel da obra com o que aguarda decisão e o custo acumulado;
  - linha do tempo;
  - tela da execução, com medidas e fotos de cada rodada e os botões Liberar/Recusar;
  - pontos de controle manuais com aprovação do engenheiro;
  - tolerâncias padrão;
  - PDF por execução, gerado a cada decisão, e PDF da obra, servidos por URL assinada.
- **Etapa 7 (endurecimento):**
  - varredura a cada 2 min devolve à fila mensagens, fotos e extrações paradas (outbox);
  - timeouts no banco (`statement_timeout` 15 s) e nas chamadas externas;
  - limite de tamanho no webhook e no Flow;
  - isolamento testado pelos casos de uso;
  - idempotência do Flow e do envio;
  - logs JSON, latência do endpoint do Flow e métricas por etapa (`/api/metricas`, Prometheus, com token);
  - aba **Indicadores** por obra;
  - testes ponta a ponta com Playwright (simulador + painel).
- **Sem conta na Meta:** um simulador em `/dev/whatsapp` faz o papel do WhatsApp.

## Rodar localmente

Pré-requisitos: Node 22, pnpm 10, Docker.

```bash
cp .env.example .env                       # e troque BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm install
pnpm infra:up                              # Postgres 18, Redis, S3 local (RustFS), Mailpit e o extrator de DWG
pnpm db:migrate
pnpm db:seed                               # cenário da §10 do prompt (Construtora Exemplo, Edifício Teste)
pnpm dev                                   # painel (https://canteirocheck.localhost) + worker das filas
```

O `pnpm dev` roda atrás do [portless](https://github.com/vercel-labs/portless): em vez de uma porta fixa, cada checkout ganha uma URL estável, e o comando imprime a dele. No checkout principal é `https://canteirocheck.localhost`; numa worktree, `https://<worktree>.canteirocheck.localhost`. Assim várias worktrees rodam ao mesmo tempo sem disputar porta nem cookie. Se o proxy do portless usa outra porta na sua máquina, ela aparece na URL (`:1355`, por exemplo). Na primeira vez o portless sobe o proxy e pede para confiar no certificado local dele.

- Os scripts que rodam fora do `pnpm dev` (e2e, skills do Paper) leem a URL do `.env`: ponha em `APP_URL` e `BETTER_AUTH_URL` a saída de `pnpm --filter @canteirocheck/web exec portless get canteirocheck`. Nas worktrees do Orca o `orca.yaml` já faz isso.
- Sem portless: `PORTLESS=0 pnpm dev` sobe em <http://localhost:3000>, com essas duas variáveis apontando para lá.

Entre com **admin@exemplo.test** (admin) ou **ana@exemplo.test** (engenheira). O link de acesso chega no Mailpit: <http://localhost:8025>.

Para gerar a chave do endpoint de Flows no seu `.env` (o `.env.example` vem sem):

```bash
pnpm --filter @canteirocheck/whatsapp gerar-chave >> .env
```

### Testar o WhatsApp sem a Meta

Com `WHATSAPP_MODO=simulado` (o padrão), abra `/dev/whatsapp` na URL do `pnpm dev`. A lateral tem o celular do **João** (encarregado, +55 11 90000-0003) e o da **Eng. Ana** (+55 11 90000-0002).

O simulador chama o webhook e o endpoint do Flow de verdade, assinados e cifrados como a Meta faz. As respostas vêm do worker.

Cenário da §10 do prompt:

1. **No celular do João**, mande "oi" → toque em **Anunciar execução** → no formulário, escolha *Concretagem*, *L4*, *Amanhã*.
2. **Ainda no João:** **Conferir L4** → **Começar**. A interface vem primeiro:
   - lado executado `6,000`, lado novo `6,040`, mesma RN *Sim*, com foto → ❌;
   - meça de novo `6,040` → escolha a causa e anexe a foto;
   - eixo A `6,005` ✅, eixo B `6,000` ✅;
   - **Enviar conferência** → a execução fica **BLOQUEADA**.
3. **No celular da Ana**, chega o template de aviso (a janela de 24h dela está fechada) → toque em **Ver** → resumo 🔴 → **Recusar** → escreva a justificativa.
4. **No celular do João**, chega "RECUSADA… reenvie a conferência" com o botão para conferir de novo.

O mesmo roteiro roda sozinho contra o sistema no ar: `pnpm --filter @canteirocheck/whatsapp fumaca`.

Nova construtora de verdade (onboarding manual, sem cadastro aberto):

```bash
pnpm criar-tenant --nome "Construtora X" --cnpj 12.345.678/0001-90 \
  --admin-nome "Fulana" --admin-email fulana@x.com.br --admin-whatsapp "+5511999999999"
```

## Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | Next em modo dev |
| `pnpm build` / `pnpm --filter @canteirocheck/web start` | build `standalone` e servidor de produção local |
| `pnpm test` | testes de integração contra Postgres real (banco `canteirocheck_test`, zerado a cada rodada) |
| `pnpm typecheck` · `pnpm lint` · `pnpm format` | TypeScript, Biome (check) e Biome (corrige) |
| `pnpm db:generate` | gera migration SQL a partir do schema (revise o SQL antes de commitar) |
| `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:reset` | aplica migrations · seed idempotente · zera + migra + seed (só localhost) |
| `pnpm infra:up` · `pnpm infra:down` | sobe/derruba Postgres, Redis, S3 local e Mailpit |
| `pnpm --filter @canteirocheck/whatsapp fumaca` | cenário L3/L4 contra o sistema rodando (`pnpm dev`), pelo webhook e pelo Flow |
| `pnpm --filter @canteirocheck/web e2e` | Playwright: cenário da §10 no simulador e decisão no painel. Usa o Google Chrome instalado; rode com `pnpm dev` no ar, logo após `pnpm db:reset`, e com `BASE_URL` na URL do `pnpm dev` |
| `pnpm --filter @canteirocheck/whatsapp gerar-chave` | gera a chave RSA do endpoint de Flows (linha para o `.env`) |

## Estrutura

```
apps/web            Next.js 16 — painel, /api/auth, /api/whatsapp/{webhook,flow}, /api/health, simulador /dev/whatsapp
apps/worker         filas BullMQ: entrada/saída do WhatsApp, mídia, notificações, anúncio diário (cron por obra)
packages/core       regras puras: tolerância, interface, máquina de estados da execução, motor do checklist
packages/db         schema Drizzle, migrations, withTenant(), funções de sistema, seed, testes de RLS
packages/servicos   casos de uso (obras, execuções, conferência, liberação, WhatsApp) com zod e auditoria
packages/whatsapp   Cloud API, assinatura, cripto do Flow e da mídia, Flow JSON, templates, simulador
packages/queue      catálogo de filas e jobs (payloads zod) · packages/storage: S3 com URL assinada
packages/reports    PDFs (@react-pdf/renderer): execução (medidas, fotos, decisão) e obra
packages/ai         LLM com saída estruturada (zod) atrás de uma interface, prompts versionados, transcrição; IA falsa para testes
packages/extracao   interpretação do DWG: MTEXT limpo, ambientes + área, níveis, carimbo, notas (código nosso, sem GPL)
services/dwg-extractor  leitura do DWG com libredwg-web (GPL-3.0, container próprio, fora do workspace pnpm)
packages/config     tsconfig base
infra/              docker-compose e script de papéis/bancos do Postgres
docs/               spec, arquitetura e rascunhos revisados
```

## Banco: isolamento e papéis

Toda tabela de cliente tem `tenant_id` e uma política RLS. O app nunca vê dados de outra construtora, mesmo que uma consulta esqueça o filtro.

| Usuário/papel | Uso |
|---|---|
| `canteiro_owner` | dono das tabelas; só migrations, seed e CLI (`DATABASE_URL_MIGRATOR`) |
| `canteiro_runtime` → herda `canteiro_app` | web e worker (`DATABASE_URL`); sujeito a RLS |
| `canteiro_sistema` (BYPASSRLS) | só via `SET LOCAL ROLE` dentro de `packages/db/src/sistema.ts` (ex.: sessão → tenant) |

Regras para quem mexe no banco:

- **Toda leitura/escrita de dado de cliente passa por `withTenant(tenantId, tx => …)`.** Fora dele, a consulta volta vazia.
- **Tabela nova de cliente** precisa de `colunaTenantId()` + `isolamentoTenant()`. O teste `isolamento.test.ts` falha se alguma tabela ficar sem RLS.
- **`audit_log`, `liberacao`, `verificacao` e `divergencia` são append-only** (sem grant de UPDATE/DELETE + trigger). Correção é uma linha nova.
- Medidas são `numeric` (string no TypeScript). Nunca `float`.
- Tabelas do Better Auth (`auth_*`) são geradas pelo CLI: `cd apps/web && npx auth generate --output ../../packages/db/src/schema/auth.ts`.

## DWG

`pnpm infra:up` sobe o extrator na porta 58090 (`DWG_EXTRACTOR_URL`).

O fluxo:
1. Em **Obra › Projetos**, envie o DWG.
2. O worker manda o arquivo ao extrator e interpreta a resposta.
3. O resultado aparece na tela do projeto.

**Aceite com ressalva:** ainda não há DWG real. A amostra (`services/dwg-extractor/test/fixtures`) foi escrita à mão em DXF e convertida para DWG R2000. Confirmar com um DWG de interiores de verdade (R2004 ou mais novo) antes de fechar a etapa. Limitações conhecidas no README do extrator.

**Licença:** o `libredwg-web` é GPL-3.0. O extrator roda isolado, como serviço próprio que só fala HTTP. Valide com o jurídico antes de produção; a alternativa comercial é o ODA SDK.

## IA

Coloque `ANTHROPIC_API_KEY` no `.env` (e `OPENAI_API_KEY`, para áudio). Sem chave tudo funciona, com dois limites:
- as pendências vêm só do pré-filtro, marcadas "revisão humana";
- não há pontos sugeridos; o engenheiro cadastra à mão.

| Tarefa | Modelo padrão | Esforço |
|---|---|---|
| Sugerir pontos de controle | `claude-opus-5-5` (fallback de recusa no servidor) | alto |
| Classificar notas e mensagens | `claude-haiku-5-5` | baixo |

Os prompts e schemas estão em `packages/ai/src/tarefas.ts`, versionados (`pontos-v1` etc.), e a versão fica gravada em cada resultado.

**Garantias:**
- A saída é validada por zod. Se falhar, há 1 nova tentativa; se falhar de novo, vai para revisão humana.
- A IA nunca decide tolerância: a comparação é do `core`.

## WhatsApp: de simulado para a Meta

| | `simulado` (padrão) | `cloud` |
|---|---|---|
| Envio | caixa do simulador (Redis) | Graph API (`POST /{phone-number-id}/messages`) |
| Webhook e Flow | o simulador chama as rotas | a Meta chama as rotas (precisa de HTTPS público) |
| Credenciais | App Secret, verify token e chave do Flow locais | + `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID` |

Para ligar na Meta:

1. Crie um app **Business** e adicione o produto WhatsApp. O token deve ser de um **System User**, porque o temporário expira em 24 h.
2. Cadastre o webhook em `https://SEU_HOST/api/whatsapp/webhook`, com o `WHATSAPP_VERIFY_TOKEN`, no campo `messages`. Para testar local: `PORTLESS=0 pnpm dev` (porta 3000 fixa) e `cloudflared tunnel --url http://localhost:3000`.
3. Suba a chave pública do Flow: `pnpm --filter @canteirocheck/whatsapp publicar -- --chave`.
4. Crie os 3 Flows em DRAFT: `pnpm --filter @canteirocheck/whatsapp publicar`.
   - O endpoint vai como `APP_URL/api/whatsapp/flow` e o app como `WHATSAPP_APP_ID`.
   - O script mostra os erros de validação da Meta e o link de preview.
   - Para testar no celular antes de publicar, use `WHATSAPP_FLOWS_RASCUNHO=1`. Depois: `pnpm --filter @canteirocheck/whatsapp publicar -- --publicar`.
   - Sem conta ainda: `publicar -- --exportar` grava os JSON em `packages/whatsapp/flows-json/`, para colar no Flow Builder.
5. Peça a aprovação dos templates UTILITY de `packages/whatsapp/src/templates.ts`: `canteiro_aviso` e `canteiro_anuncio_diario`.

Detalhes e fontes em [docs/referencia-meta-whatsapp.md](docs/referencia-meta-whatsapp.md).

**Custo:**
- Cada mensagem cobrada vira um `evento_custo` da obra quando o webhook de status traz `pricing.type = regular`.
- Os preços são estimados: ajuste em `WHATSAPP_PRECOS_USD`.
- Desde out/2026, utility dentro da janela também é cobrada, e mensagens de serviço são cobradas a partir da 1.001ª do mês.

## Observabilidade

- **Logs:** JSON, uma linha por evento (`job.ok`, `job.falhou`, `flow.lento`, `varredura.reenfileirou`…).
- **Métricas:** com `METRICAS_TOKEN` definido, `GET /api/metricas` responde no formato Prometheus (`Authorization: Bearer …`), com:
  - execuções por etapa e status;
  - divergências por etapa;
  - horas até a liberação (p50/p90);
  - histograma de latência do endpoint do Flow;
  - contadores do webhook.
- **Nenhuma construtora é identificada nas métricas.**

**Dica de desenvolvimento:** não rode `next build` com o `pnpm dev` no ar. O hash do HMR fica divergente e o navegador entra em loop de recarga. Se acontecer, pare o dev, apague `apps/web/.next` e suba de novo.

## Versões fixadas e por quê

- **TypeScript 5.9** — o `latest` no npm já é o 7.0 (reescrita em Go); o Next e as ferramentas ainda dependem da API JS do 5.x.
- **Drizzle 0.45 / drizzle-kit 0.31** — o 1.0 está em RC. Só usamos o query builder estilo SQL, que não muda no 1.0.
- **Postgres 18** — `uuidv7()` nativo nas chaves primárias.
- **S3 local = RustFS** — as imagens do MinIO saíram do Docker Hub em 2025; o RustFS fala a mesma API S3 (produção: AWS S3 ou compatível).
- **Flow JSON 7.3 + data API 3.0** — a criptografia está documentada para a 3.0; sessões de até 9 pontos (limite de 10 ramos por tela).
