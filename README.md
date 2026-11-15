# CanteiroCheck

SaaS B2B para conferir a execução de obra contra o projeto **antes** da etapa que não tem volta (concretagem, fechamento de drywall, piso, forro). Spec do MVP: [docs/prompt-gabarito-mvp.md](docs/prompt-gabarito-mvp.md) · Arquitetura: [docs/arquitetura.md](docs/arquitetura.md).

**Estado:** etapa 1 (fundação) — monorepo, banco com isolamento por construtora (RLS), login por magic link, cadastro de obras, locais, equipe e usuários, log de auditoria.

## Rodar localmente

Pré-requisitos: Node 22, pnpm 10, Docker.

```bash
cp .env.example .env                       # e troque BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm install
pnpm infra:up                              # Postgres 18 (porta 54329) + Mailpit (1025/8025)
pnpm db:migrate
pnpm db:seed                               # cenário da §10 do prompt (Construtora Exemplo, Edifício Teste)
pnpm dev                                   # http://localhost:3000
```

Entre com **admin@exemplo.test** (admin) ou **ana@exemplo.test** (engenheira). O link de acesso chega no Mailpit: <http://localhost:8025>.

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
| `pnpm infra:up` · `pnpm infra:down` | sobe/derruba Postgres e Mailpit |

## Estrutura

```
apps/web            Next.js 16 — painel, /api/auth (Better Auth). Webhooks e Flow entram na etapa 4–5.
packages/db         schema Drizzle, migrations, withTenant(), funções de sistema, seed, testes de RLS
packages/servicos   casos de uso (obras, locais, equipe, usuários) com validação zod e auditoria
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

## Versões fixadas e por quê

- **TypeScript 5.9** — o `latest` no npm já é o 7.0 (reescrita em Go); o Next e as ferramentas ainda dependem da API JS do 5.x.
- **Drizzle 0.45 / drizzle-kit 0.31** — o 1.0 está em RC. Só usamos o query builder estilo SQL, que não muda no 1.0.
- **Postgres 18** — `uuidv7()` nativo nas chaves primárias.
