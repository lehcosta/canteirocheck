# Arquitetura do MVP

> Documento de design pedido na seção 11 do prompt ([prompt-gabarito-mvp.md](./prompt-gabarito-mvp.md)): arquitetura, estrutura de pastas, schema do banco e lista de jobs e rotas. Aprovado; a **etapa 1 (fundação) está implementada** (ver README).
>
> Schema: [`packages/db/src/schema/`](../packages/db/src/schema/) · migrations (inclui papéis, grants e triggers): [`packages/db/drizzle/`](../packages/db/drizzle/) · papéis e bancos locais: [`infra/postgres/init.sql`](../infra/postgres/init.sql).
>
> **Ajustes feitos na implementação da etapa 1:** login do runtime é o usuário `canteiro_runtime` (herda `canteiro_app`; entra em `canteiro_sistema` só com `SET LOCAL ROLE`); CHECK `painel_exige_email` em `usuario`; tabelas do Better Auth com prefixo `auth_*`, geradas pelo CLI; TypeScript fixado em 5.9.

---

## 1. Decisões principais

| Tema | Decisão | Por quê |
|---|---|---|
| Framework | **Next.js 16 full-stack** (App Router). Painel, webhooks da Meta e endpoint do Flow ficam no mesmo app. Não haverá Fastify. | Pedido seu. Fica um deploy só para o que é HTTP. |
| Jobs | **Processo `worker` separado** (Node + BullMQ + Redis) | Next não roda job longo nem fila. Extração de DWG, IA, envios e PDF ficam no worker. |
| DWG | **Serviço `dwg-extractor` isolado** (container próprio, HTTP) com `@mlightcad/libredwg-web` | É GPL-3.0. Isolar num processo separado, que fala só por HTTP, mantém o resto do código fora da GPL. Validar com o jurídico antes de produção. |
| Regras de negócio | Pacote **`core` puro** (sem banco, sem IO): tolerância, interface, máquina de estados, motor do checklist | Comparação medido × projetado é determinística e 100% testável. Nenhuma IA nesse caminho. |
| ORM | **Drizzle** (decisão sua) | Schema em TypeScript sem geração de código, RLS e CHECKs declarados no próprio schema, migrations em SQL revisável. |
| Números | **`numeric`** no banco (o Drizzle devolve como string) e `decimal.js` no core. Nunca `float`. | 6,005 − 6,000 em float dá erro de arredondamento, e isso pode decidir uma liberação. |
| Multi-tenant | `tenant_id` em **todas** as tabelas do cliente + **RLS no Postgres desde a etapa 1** + teste automatizado | O isolamento fica no banco: mesmo uma consulta que esqueça o filtro não vê dado de outra construtora. |
| Auth | **Better Auth** + plugin magic link, sem cadastro aberto (`disableSignUp`). Só quem o admin cadastrou entra. | O Auth.js passou a ser mantido pelo Better Auth em set/2025, e o README do Auth.js indica Better Auth para projetos novos ([anúncio](https://better-auth.com/blog/authjs-joins-better-auth)). |
| Imutabilidade | `audit_log`, `liberacao`, `verificacao` e `divergencia` são **append-only**: sem permissão de UPDATE/DELETE para o app **e** trigger que bloqueia até o dono da tabela | O prompt pede registro auditável e nenhuma liberação editável. |
| Deploy | **Containers** (Next `output: standalone` + worker + dwg-extractor) com Postgres, Redis e S3 gerenciados | Endpoint do Flow precisa de latência baixa e estável. Sem cold start de serverless. Já há worker e Redis de qualquer forma. (Q4) |

### Mudanças em relação ao prompt

1. **Fastify → Route Handlers do Next.** O worker continua separado.
2. **Prisma → Drizzle**, e o RLS sobe da etapa 7 para a etapa 1.
3. **`foto_urls[]` → tabela `Midia`** com chave no bucket + `sha256`. URL assinada expira; para auditoria, guardamos a chave e o hash.
4. **`causa_provavel` sai de `Verificacao` e vai para a tabela `Divergencia`.** A causa chega depois da 2ª medida; numa tabela à parte, `Verificacao` não precisa de UPDATE.
5. **`Verificacao` ganha campos de interface:** `valor_referencia` (lado já executado), `mesma_referencia_nivel` e `diferenca`.
6. **Tabelas novas:** `FlowSessao` (flow_token → estado da sessão), `EstadoEtapaLocal` (o "estado da obra" que alimenta o anúncio), `ToleranciaPadrao`, `EventoCusto` (contador de custo por obra), `Relatorio`. Também `rodada` em verificação e liberação: depois de uma recusa, a mesma execução é reconferida numa nova rodada.
7. **Foto por ponto vai no `data_exchange`, não só no fim.** A doc da Meta permite o PhotoPicker no `data_exchange` e no `complete`, nunca no `navigate`. O endpoint só grava os metadados da mídia, e o worker baixa e descriptografa. Ver §7.
8. **Fallback conversacional:** a interpretação da IA fica em `MensagemWhatsApp.interpretacao`. A `Verificacao` (`estruturada=false`) só é criada depois que o encarregado confirma. Assim não há verificação "provisória" que precise de UPDATE.

---

## 2. Visão geral

```
                  ┌──────────────────────── Meta (WhatsApp Cloud API) ────────────────────────┐
                  │  webhooks (mensagens, status, nfm_reply)      endpoint de Flow (criptografado) │
                  └───────────────┬───────────────────────────────────────┬────────────────────┘
                                  │ POST (assinado)                       │ POST (RSA/AES-GCM)
┌─────────────────────────────────▼───────────────────────────────────────▼─────────────────────┐
│ apps/web — Next.js 16                                                                         │
│  painel (RSC + Server Actions)   /api/whatsapp/webhook   /api/whatsapp/flow   /api/auth/*      │
│  └─ packages/servicos (casos de uso) ── packages/core (regras puras) ── packages/db (Drizzle)  │
└───────────┬───────────────────────────────────────────────────────────────┬───────────────────┘
            │ enfileira (BullMQ)                                            │ SQL
       ┌────▼────┐                                                     ┌────▼─────┐
       │  Redis  │                                                     │ Postgres │
       └────┬────┘                                                     └────▲─────┘
┌───────────▼───────────────────────────────────────────────────────────────┴───────────────────┐
│ apps/worker — Node + BullMQ                                                                   │
│  dwg · ia (Claude, Whisper) · whatsapp-saida · whatsapp-entrada · midia · relatorios · agenda │
└───────┬───────────────────────────────┬───────────────────────────────┬───────────────────────┘
        │ HTTP                          │ S3                            │ HTTPS
┌───────▼──────────────┐        ┌───────▼──────┐               ┌────────▼────────────────────┐
│ services/dwg-extractor│        │ S3 / MinIO   │               │ Anthropic · OpenAI (Whisper) │
│ (GPL-3.0, isolado)    │        │ bucket privado│               │ Graph API da Meta            │
└──────────────────────┘        └──────────────┘               └─────────────────────────────┘
```

Regra de ouro: **nenhuma chamada a LLM dentro de request HTTP síncrono.** O webhook grava e enfileira. O endpoint do Flow só lê o banco e roda o `core`.

---

## 3. Stack e versões (conferidas no npm em 15/11/2026)

| Item | Versão | Observação |
|---|---|---|
| Node | 22 LTS | o prompt pede 20+ |
| pnpm + Turborepo | pnpm 10, turbo 2.11 | monorepo |
| TypeScript | 5.x strict | tudo em TS |
| Next.js | 16.4 | `proxy.ts` substitui `middleware.ts`; Turbopack padrão |
| Tailwind + shadcn/ui | Tailwind 4.3 | |
| Drizzle | **drizzle-orm 0.45.4 + drizzle-kit 0.31.11 (estáveis)** | o 1.0 está em RC (`1.0.0-rc.5`); **não usar ainda**. Consultas no estilo SQL (`select`/`insert`), que não mudam no 1.0. A API relacional (`db.query`) fica para depois do upgrade. Driver: `pg` (node-postgres). |
| Postgres | **18** | `uuidv7()` nativo como default das chaves (ordenável por tempo, bom para índice) |
| BullMQ + Redis | BullMQ 6.7, Redis 7 | Job Schedulers para o cron por obra |
| Zod | 4.6 | env, payloads de fila e saída de IA |
| Better Auth | 1.7 | magic link |
| DWG | `@mlightcad/libredwg-web` 0.9.0 (GPL-3.0) | só dentro do `dwg-extractor` |
| PDF | `@react-pdf/renderer` 4.9 | sem Chromium |
| IA | SDK da Anthropic; Whisper (OpenAI) para áudio | atrás das interfaces `Llm`, `Classifier` e `Transcriber` |
| Testes | Vitest (unit + integração com Postgres real); Playwright no painel (etapa 7) | |
| Lint/format | Biome | uma ferramenta só |
| Cronograma | MPXJ 16 (LGPL-2.1+) numa JVM | só dentro do `mpp-extractor`; lê `.mpp` e o XML do MS Project |
| Local | docker-compose: Postgres, Redis, MinIO, Mailpit, dwg-extractor, mpp-extractor | |

---

## 4. Estrutura de pastas

```
canteirocheck/
├─ apps/
│  ├─ web/                                # Next.js 16
│  │  ├─ proxy.ts                         # redireciona não autenticado para /login
│  │  └─ src/
│  │     ├─ app/
│  │     │  ├─ (auth)/login/
│  │     │  ├─ (painel)/obras/…           # telas da §5.1
│  │     │  ├─ (painel)/configuracoes/…
│  │     │  └─ api/                       # route handlers da §5.2
│  │     ├─ features/<feature>/           # actions.ts (Server Actions), queries.ts, components/
│  │     ├─ components/ui/                # shadcn
│  │     └─ lib/                          # auth.ts, sessao-tenant.ts
│  └─ worker/
│     └─ src/
│        ├─ index.ts                      # sobe os Workers do BullMQ
│        ├─ agendamentos.ts               # upsert dos Job Schedulers (anúncio diário por obra)
│        └─ jobs/<fila>/<job>.ts
├─ services/
│  ├─ dwg-extractor/                      # GPL-3.0 · POST /extrair {s3Key} → JSON · Dockerfile próprio
│  └─ mpp-extractor/                      # Java + MPXJ · POST /ler (bytes do .mpp/.xml) → tarefas em JSON
├─ packages/
│  ├─ core/        # PURO: tolerancia.ts, interface.ts, execucao-estado.ts, checklist-motor.ts,
│  │               #       ordenacao.ts, agrupamento.ts, unidades.ts — testes de propriedade
│  ├─ servicos/    # casos de uso com DB/fila (usados por web e worker): anunciarExecucao,
│  │               #   registrarVerificacao, liberarExecucao, aprovarPonto…
│  ├─ db/          # src/schema/*.ts (Drizzle), auth-schema.ts (Better Auth), drizzle/ (migrations SQL,
│  │               #   incl. papéis, grants e triggers), withTenant(), sistema.ts (BYPASSRLS),
│  │               #   seed (cenário da §10)
│  ├─ whatsapp/    # client da Cloud API, assinatura do webhook, cripto do Flow (RSA-OAEP + AES-GCM),
│  │               #   cripto de mídia do Flow (AES-CBC + HMAC), builders, flows/*.json + script de publicação
│  ├─ ai/          # Llm (Claude), Classifier, Transcriber, prompts versionados, schemas zod de saída
│  ├─ queue/       # nomes de filas e payloads (zod): produtor e consumidor tipados
│  ├─ storage/     # S3: presign PUT/GET (curta duração), chaves por tenant
│  ├─ reports/     # templates PDF
│  └─ config/      # tsconfig base, schema do env (zod), logger (pino)
├─ infra/
│  └─ docker-compose.yml
├─ docs/
├─ biome.json · turbo.json · pnpm-workspace.yaml
```

Dependências permitidas: `apps/*` → `servicos` → (`core`, `db`, `queue`, `storage`, `whatsapp`, `ai`). Exceção: os route handlers do webhook e do Flow importam direto de `whatsapp` a camada de transporte (assinatura e cripto). O `core` não depende de nada do projeto. Só o worker fala HTTP com o `dwg-extractor` e com o `mpp-extractor`.

---

## 5. Rotas

### 5.1 Painel (App Router)

| Rota | Tela (prompt §7) |
|---|---|
| `/login` | magic link |
| `/obras` | lista com status e alertas abertos |
| `/obras/nova` | cadastro |
| `/obras/[obraId]` | resumo: alertas, pendências abertas, execuções do dia, **custo acumulado** |
| `/obras/[obraId]/locais` | pavimentos/lajes/ambientes/eixos + estado das etapas por local |
| `/obras/[obraId]/projetos` | upload (presign direto para o S3), revisões, status da extração |
| `/obras/[obraId]/projetos/[projetoId]` | resultado da extração + pendências detectadas |
| `/obras/[obraId]/pontos` | tabela por etapa/local: aprovar, editar, descartar, criar manual, ver `trecho_origem` |
| `/obras/[obraId]/linha-do-tempo` | execuções anunciadas, em conferência, bloqueadas, liberadas |
| `/obras/[obraId]/execucoes/[execucaoId]` | verificações (medida, foto, tentativa, quem) + Liberar/Recusar |
| `/obras/[obraId]/relatorios` | PDFs por execução e por obra |
| `/configuracoes/usuarios` | usuários, papéis, WhatsApp |
| `/configuracoes/tolerancias` | tolerância padrão por grandeza |

Mutações usam **Server Actions**, que chamam `packages/servicos` com o contexto de tenant da sessão. Cada action valida a entrada com zod, confere o papel e grava no `AuditLog` na mesma transação.

### 5.2 Route Handlers (`runtime = 'nodejs'`)

| Método e rota | Função |
|---|---|
| `GET /api/whatsapp/webhook` | verificação do webhook (`hub.verify_token`) |
| `POST /api/whatsapp/webhook` | lê o body cru com `req.text()`, valida `X-Hub-Signature-256`, grava `MensagemWhatsApp` (único por `wa_message_id` = idempotência), enfileira e **responde 200 na hora** |
| `POST /api/whatsapp/flow` | endpoint dos Flows: valida a assinatura, descriptografa (RSA-OAEP-SHA256 → chave AES-128 → AES-GCM), trata `ping`, `INIT`, `data_exchange`, `BACK` e notificação de erro, e responde criptografado (IV invertido) |
| `GET/POST /api/auth/[...all]` | Better Auth |
| `GET /api/midias/[id]` | confere o tenant e redireciona para uma URL assinada de 5 min |
| `GET /api/relatorios/[id]` | idem para o PDF |
| `GET /api/health` | liveness/readiness (DB + Redis) |

---

## 6. Filas e jobs (BullMQ)

| Fila | Job | Gatilho | O que faz |
|---|---|---|---|
| `dwg` | `extrair_dwg` | upload de DWG | chama o `dwg-extractor`, limpa MTEXT, salva `ExtracaoProjeto`, enfileira os 2 jobs abaixo |
| `cronograma` | `ler_cronograma` | importação do MS Project | chama o `mpp-extractor`, grava as tarefas, numera a versão e a torna a vigente da obra (as anteriores ficam no histórico e podem ser restauradas) |
| `ia` | `detectar_pendencias` | fim da extração | classifica cada nota: é pendência? qual etapa bloqueia? risco? → `Pendencia` |
| `ia` | `gerar_pontos` | fim da extração | Claude + schema zod → `PontoControle` com `status=sugerido` e `trecho_origem`. Falha de schema → 1 retry → marca para revisão humana |
| `ia` | `transcrever_audio` | áudio recebido | Whisper → texto na mensagem |
| `ia` | `interpretar_mensagem` | texto/foto/áudio livre | classifica (medida/ocorrência/pergunta/outro), extrai valor e ponto provável, pede confirmação |
| `agenda` | `anuncio_diario` | Job Scheduler por obra (cron + fuso da obra) | template utility + Flow de anúncio para os encarregados |
| `whatsapp-entrada` | `processar_mensagem` | webhook | roteia: `nfm_reply` de Flow, botão Liberar/Recusar, mensagem livre → fallback. **Status de entrega** (sent/delivered/read/failed) atualiza o `statusEntrega` da mensagem de saída já existente, sem inserir linha nova |
| `whatsapp-saida` | `enviar_mensagem` | casos de uso | envia template/interativa/texto com rate limit e retry, registra `EventoCusto` |
| `midia` | `baixar_midia` | foto do Flow ou do chat | baixa (CDN do Flow ou Graph API), verifica hash/HMAC, descriptografa, sobe ao S3, grava `sha256` |
| `execucao` | `notificar_engenheiro` | execução `bloqueada` ou `aguardando_liberacao`, pendência que bloqueia etapa anunciada | resumo verde/vermelho + botões |
| `execucao` | `notificar_encarregado` | `Liberacao` criada | resultado + próximo passo |
| `relatorios` | `gerar_pdf` | liberação, ou pedido no painel | PDF → S3 → `Relatorio` |

Todos os payloads são tipados por zod em `packages/queue`. Os jobs são idempotentes (`jobId` derivado da entidade), com retries e backoff exponencial, e a fila `ia` tem rate limit.

---

## 7. Desenho do checklist no WhatsApp Flows

Restrições confirmadas na doc da Meta (Flow JSON e endpoint):

- o roteamento só anda para frente; **uma tela não pode ter ela mesma como rota**, mas pode ser "refrescada" para validação;
- no máximo 10 ramos por tela; o limite de ~100 telas por Flow vem de mensagem de erro citada por terceiros e precisa ser confirmado no spike;
- o PhotoPicker é permitido **só no `data_exchange` e no `complete`**, como valor de nível superior, nunca no `navigate`. É 1 PhotoPicker por tela, e o tamanho padrão de 25 MiB será reduzido para cerca de 8 MiB;
- no `data_exchange`, a foto chega como `cdn_url` + `encryption_metadata`. O arquivo fica até 20 dias no CDN e é cifrado com AES-256-CBC + HMAC-SHA256.

Por isso, **uma única tela reutilizada para N pontos não funciona.** Proposta:

```
INICIO ──► P01_MEDIR ──► P01_CAUSA ──► P02_MEDIR ──► P02_CAUSA ──► … ──► P10_MEDIR ──► P10_CAUSA
  │            │  └──────────────────────►│                                   │
  │            └──────────────────────────┴──────────────────────────────────►└──► RESUMO (terminal)
  └─ escolher região (se > 10 pontos)
```

- **Flow genérico `checklist_liberacao`** com 10 pares de telas por ponto, ou seja, 22 telas. Cada sessão cobre **até 10 pontos**. Acima disso, o endpoint agrupa por região ("Laje L4 — eixos A a D") e cada região vira uma sessão. Isso também respeita a recomendação de terminar em menos de 5 min.
- **`Pnn_MEDIR`**: descrição, "esperado 6,000 m ± 1 cm", `TextInput` numérico, PhotoPicker e observação. Para ponto de **interface**, os campos "lado já executado", "lado novo" e "mesma RN?" aparecem por `visible` ligado aos dados que o endpoint manda ao abrir a tela.
- **1ª medida fora** → o endpoint responde com **a mesma tela, refrescada**, com a mensagem "❌ fora da tolerância — meça de novo". É o uso que a doc chama de "refresh for validation".
- **2ª medida fora** → `Pnn_CAUSA` (causa provável em opções + "outro", e foto) → grava `Divergencia` e a execução vai para `bloqueada`. **O checklist continua** nos pontos restantes, para o engenheiro receber o quadro completo.
- Dentro da tolerância → pula direto para `P(n+1)_MEDIR`, ou para `RESUMO` quando acabam os pontos.
- `RESUMO` → `complete`. Se tudo deu ✅, a execução vai para `aguardando_liberacao` e o engenheiro é notificado.
- **Estado no banco (`FlowSessao`)**, indexado por um `flow_token` aleatório. O endpoint não guarda nada em memória.
- Ordem dos pontos (`core/ordenacao.ts`): interfaces → pontos que já falharam nesta obra/equipe → resto.
- Outros Flows: `anuncio_execucao` (etapa × local, a partir de `EstadoEtapaLocal`) e `recusa_justificativa` (texto obrigatório ao recusar).
- Os Flow JSON ficam versionados em `packages/whatsapp/flows/`, com um script que publica pela Graph API.

**Spike obrigatório no início da etapa 5**, com WABA real: confirmar (a) refresh da mesma tela com mensagem de erro, (b) `visible` dirigido pelos dados da tela, (c) PhotoPicker no `data_exchange` com download e descriptografia, (d) limite real de telas e latência do endpoint. **Plano B** se (a) ou (b) falharem: telas dedicadas `Pnn_REMEDIR` e `Pnn_INTERFACE`, com menos pontos por sessão.

---

## 8. Segurança, LGPD e isolamento

- **RLS desde a etapa 1.** Toda tabela de cliente tem a política `isolamento_tenant`: `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`. Sem tenant definido, a consulta não vê nada (falha fechada).
- **Três papéis no banco:**
  - `canteiro_app`: runtime do web e do worker, sujeito a RLS. Toda operação passa por `withTenant(tenantId, tx => …)`, que faz `set_config('app.tenant_id', …, true)` dentro da transação. É seguro com pool de conexões, porque o valor some no fim da transação.
  - `canteiro_sistema`: `BYPASSRLS`, usado **só** em `packages/db/src/sistema.ts`, com funções estreitas: resolver o tenant pelo telefone (webhook), pelo `flow_token` (endpoint do Flow) e pelo usuário logado (painel), e listar obras para os agendamentos. Nada de client genérico com bypass.
  - O dono das tabelas é o usuário de migração, que nunca roda em runtime.
- **Append-only em duas camadas:** o app não tem permissão de UPDATE/DELETE/TRUNCATE em `audit_log`, `liberacao`, `verificacao` e `divergencia`, e um trigger bloqueia essas operações até para o dono da tabela.
- **CHECKs no banco:** recusa exige justificativa; ponto gerado por IA exige `trecho_origem`; ponto de interface exige o local de referência; `valor_esperado` só é nulo para "existência"; tolerâncias não negativas; telefone em E.164; no máximo uma execução aberta por etapa × local.
- **Já testado** num Postgres 18 com o rascunho: sem tenant → 0 linhas; inserir dado de outra construtora → bloqueado pelo RLS; recusa sem justificativa → bloqueada; segunda execução aberta → bloqueada; UPDATE em liberação pelo app → sem permissão; UPDATE/DELETE/TRUNCATE pelo dono → bloqueado pelo trigger; papel de sistema vê as 2 construtoras.
- **Teste de isolamento no CI:** consulta o catálogo do Postgres e falha se alguma tabela fora da lista de exceções (`etapa`, tabelas do Better Auth) estiver sem RLS ou sem política; depois cria dados em 2 tenants e confirma que nenhuma leitura ou escrita cruza.
- **Bucket privado** com chaves `tenants/{tenantId}/obras/{obraId}/…`. URLs assinadas de 5 min, nunca guardadas no banco.
- **Webhook e Flow:** assinatura HMAC com o app secret em comparação de tempo constante. A chave RSA privada do Flow fica no secret manager, nunca no repo.
- **Saídas de IA:** schema zod → 1 retry → `revisao_humana`. Os pontos só entram em checklist depois de `aprovado` por um engenheiro.
- **Mídia vinda do WhatsApp é não confiável:** checa MIME e tamanho e reprocessa as imagens (sharp) antes de guardar.

---

## 9. Custo (o prompt pede para sinalizar)

Tudo que gera custo grava um `EventoCusto`, e o painel mostra o total por obra.

| Gerador | Volume esperado | Como conter |
|---|---|---|
| **Template utility diário** (anúncio) | 1 por encarregado, por obra, por dia útil | Mensagem dentro da janela de 24h aberta pelo encarregado não precisa de template. Na janela, mandar interativa. Dias e horário configuráveis por obra. |
| **Template para o engenheiro** (alerta/resumo) | 1 por execução que precisa de decisão | Agrupar quando várias execuções fecham no mesmo período (fase 2) |
| **`gerar_pontos` (LLM)** | 1 vez por revisão de projeto; é o maior gasto em tokens | Enviar só textos, camadas e cotas relevantes (pré-filtro por código) e reutilizar o resultado entre revisões quando o trecho não mudou |
| **`detectar_pendencias`** | por nota de projeto | Pré-filtro por regex ("a definir", "aguardando", "verificar"…). O modelo pequeno só classifica o que passou. |
| **Whisper** | por minuto de áudio do fallback | só no fallback |

Os preços não estão fixados no código: ficam numa tabela de configuração, porque Meta e provedores de IA mudam valores e faixas.

---

## 10. Riscos e spikes

| Risco | Mitigação | Quando |
|---|---|---|
| `libredwg-web` 0.9 não extrair ATTRIB dentro de blocos, camadas ou MTEXT de algum DWG real | **Spike com DWG seu** antes de fechar o aceite. Alternativa comercial: ODA SDK. | início da etapa 2 |
| Comportamento real dos Flows (refresh, `visible`, PhotoPicker, limite de telas) | spike da §7 com plano B | início da etapa 5 |
| **Provisionamento na Meta** (Business verificado, WABA, número, app, aprovação de templates) leva dias | começar já, em paralelo às etapas 1–3 | agora (Q2) |
| GPL-3.0 | serviço isolado + parecer jurídico antes de produção | antes do 1º cliente |
| Drizzle 1.0 sair durante o projeto e mudar APIs | usar só as consultas no estilo SQL, que não mudam; fazer o upgrade numa etapa própria | quando o 1.0 for estável |
| IA alucinar valor esperado | `trecho_origem` obrigatório; sem aprovação do engenheiro o ponto não vale | etapa 3 |

---

## 11. Entregas (ordem do prompt §9, com os spikes encaixados)

1. **Fundação:** monorepo, docker-compose (Postgres 18), Drizzle + migrations + papéis + RLS + triggers, `withTenant`, Better Auth (magic link), tenants, obras, locais, usuários, AuditLog, teste de isolamento, CI (lint, typecheck, testes).
2. **Ingestão DWG:** spike com DWG real → `dwg-extractor` → upload com presign → job `extrair_dwg` → tela de extração.
3. **Pendências + pontos com IA:** jobs, schemas, tela de revisão e aprovação de pontos.
4. **WhatsApp:** Cloud API, webhook idempotente, templates, identificação por número, mídia, fallback conversacional.
5. **Flows:** spike → anúncio diário → checklist dinâmico com ramificação. Aceite: cenário L3/L4 da §10 do prompt, rodado como **teste de integração** que chama o endpoint com payloads criptografados com chave de teste.
6. **Liberação** (WhatsApp + painel) **e relatório PDF.**
7. **Endurecimento:** timeouts, idempotência ponta a ponta, logs estruturados + métricas por etapa, Playwright no painel.

Cada etapa sai com testes e com o README de como rodar localmente (`docker compose up` + `pnpm dev`).

---

## 12. Perguntas em aberto

1. **Número de WhatsApp: um compartilhado (do SaaS) ou um por construtora?** Recomendo **um compartilhado** no MVP: uma WABA só e onboarding sem burocracia da Meta para cada cliente. Consequência: o número de celular é **único no sistema todo**, e uma pessoa que trabalhe para duas construtoras precisaria de tratamento especial (fica para a fase 2). Com número por construtora, o número passa a ser único por tenant e o webhook resolve o tenant pelo `phone_number_id`.
2. **Já existe conta Meta Business verificada, WABA, número e app?** Se não, vale começar agora, porque isso trava as etapas 4 e 5.
3. **Você tem um DWG real (de preferência de interiores, e um de estrutura com cotas de nível) para o spike da etapa 2?**
4. **Onde vai rodar em produção?** Recomendo containers (Railway, Fly, Render ou AWS ECS) com Postgres, Redis e S3 gerenciados.
5. **Nome:** "Gabarito" (prompt) ou "CanteiroCheck" (repo)? Uso `@canteirocheck/*` como escopo dos pacotes e deixo o nome exibido configurável, salvo outra preferência.
