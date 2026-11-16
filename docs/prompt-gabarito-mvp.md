# Prompt — MVP "Gabarito": conferência de execução de obra antes do ponto sem volta

> Cole este prompt inteiro numa IA de programação. Nome do produto provisório: **Gabarito**. Troque se definir outro.

---

## 1. Papel e objetivo

Você é um engenheiro de software sênior. Vai construir comigo o MVP de um SaaS B2B para construtoras e empresas de engenharia no Brasil.

**Problema:** erros de execução em obra (ex.: duas lajes que se encontram concretadas com níveis desalinhados, gerando R$ 200 mil de retrabalho) acontecem porque ninguém confere a execução contra o projeto **antes** da etapa que não tem volta (concretagem, fechamento de drywall, assentamento de piso, fechamento de forro). Checklists atuais (FVS) são caixinhas marcadas sem medição.

**Solução:** a partir dos projetos da obra (DWG), o sistema gera **pontos de controle** com valor esperado e tolerância. Antes de cada etapa crítica, o encarregado responde um **checklist dinâmico pelo WhatsApp (WhatsApp Flows)** com medidas e fotos. O sistema compara medido × projetado, bloqueia a etapa se houver divergência e pede a liberação do engenheiro responsável.

**Princípios inegociáveis:**
- A IA **sugere**, o engenheiro **decide**. Nenhuma etapa é liberada sem aprovação humana registrada. A responsabilidade técnica (ART) é do engenheiro; o software é ferramenta de apoio.
- Comparação medido × projetado é **código determinístico**, nunca IA.
- Perguntas são **geradas e revisadas antes**; durante o preenchimento o endpoint só **escolhe** a próxima pergunta (resposta rápida).
- O encarregado não instala nada: tudo pelo WhatsApp.
- Todo registro é auditável: quem, quando, onde, com qual evidência.

---

## 2. Usuários e papéis

| Papel | Canal | O que faz |
|---|---|---|
| Admin da empresa | Painel web | Cadastra obras, usuários, envia projetos |
| Engenheiro responsável | Painel web + WhatsApp | Revisa pontos gerados, define tolerâncias, libera/recusa etapas |
| Encarregado / mestre de obras | Só WhatsApp | Informa o que será executado, responde checklists, envia medidas e fotos |

Multi-tenant: cada empresa (tenant) vê só os próprios dados.

---

## 3. Escopo do MVP

### Dentro
1. Cadastro de empresa, obras, usuários e papéis.
2. Upload de projetos DWG (e PDF como anexo de referência) por obra, com versão/revisão.
3. **Extração do DWG:** textos, notas, camadas, blocos, cotas de nível, nomes de ambientes.
4. **Geração de pontos de controle com IA** a partir do material extraído, revisados e editáveis pelo engenheiro.
5. **Detecção de pendências no projeto:** frases como "a definir", "aguardando projeto", "verificar", "conferir no local" viram alertas classificados por etapa e risco.
6. **Estado da obra:** etapas (forma, armação, concretagem, drywall 1ª face, drywall fechamento, contrapiso, piso, forro, marcenaria), com status por local (pavimento/laje/ambiente).
7. **Pergunta diária ao encarregado** (template utility): "O que vai ser executado amanhã?" → escolhe etapa(s) e local(is).
8. **Checklist dinâmico via WhatsApp Flows** com endpoint: lista de pontos da etapa → tela por ponto (valor esperado, tolerância, campo de medida, foto, observação) → resultado imediato.
9. **Ramificação:** fora da tolerância → refazer medida → se confirmar, pedir causa provável + foto e bloquear a etapa.
10. **Liberação pelo engenheiro:** resumo verde/vermelho no WhatsApp (botões Liberar / Recusar + justificativa) e no painel.
11. **Fallback conversacional:** se o Flow falhar (sinal fraco) o encarregado manda foto/áudio/texto na conversa; a IA transcreve, extrai o valor e associa ao ponto, marcando como "não estruturado — revisar".
12. **Relatório por etapa** (PDF): pontos, medidas, fotos, quem liberou e quando.
13. Log de auditoria imutável.

### Fora do MVP
- Leitura de geometria fina do DWG (associar cada cota a coordenadas exatas). No MVP, local é texto (pavimento, eixo, ambiente).
- Medição por foto/LiDAR. A medida vem de instrumento (nível laser, trena, topografia) e é digitada.
- Integração com cronograma (MS Project/Prevision). Fica para a fase 2.
- App mobile próprio. Só WhatsApp + painel web.
- Pagamento in-app. Cobrança fora do sistema no início.

---

## 4. Stack sugerida (pode ajustar justificando)

- **Linguagem:** TypeScript em tudo.
- **Backend:** Node.js 20+ com Fastify (ou NestJS), Postgres, Prisma, fila com BullMQ + Redis para jobs (extração, IA, envios).
- **Painel web:** Next.js (App Router), Tailwind, shadcn/ui.
- **Storage:** S3 compatível para DWG, fotos e PDFs (URLs assinadas).
- **WhatsApp:** **Cloud API oficial da Meta** (obrigatório para Flows; Z-API/QR não serve). Webhooks + endpoint de Flows com a criptografia exigida pela Meta (troca de chave RSA/AES do data_exchange).
- **Leitura de DWG:** `@mlightcad/libredwg-web` (WASM, roda em Node) para converter DWG em entidades/textos. Atenção: licença **GPL-3.0** — rodar isolado num worker/serviço separado e validar a licença com jurídico antes de produção; alternativa comercial: ODA Drawings SDK.
- **IA:**
  - LLM (ex.: Claude) para gerar pontos de controle e extrair valores de texto/áudio transcrito/foto.
  - Modelo de decisão tipado (ex.: Jev, da TypeSafe AI) **opcional** para classificações rápidas: tipo de mensagem, etapa bloqueada por uma nota, nível de risco. Esconder atrás de uma interface `Classifier` para poder trocar por LLM com saída estruturada.
  - Transcrição de áudio (ex.: Whisper).
- **Auth:** e-mail + magic link no painel; no WhatsApp, o usuário é identificado pelo número cadastrado.

---

## 5. Modelo de dados (mínimo)

```
Tenant(id, nome, cnpj, plano, criado_em)
User(id, tenant_id, nome, email?, whatsapp_e164, papel[admin|engenheiro|encarregado], ativo)
Obra(id, tenant_id, nome, endereco, area_m2, status, engenheiro_responsavel_id)
ObraMembro(obra_id, user_id, papel)
Projeto(id, obra_id, disciplina[arquitetura|estrutura|instalacoes|interiores], titulo, codigo, revisao, arquivo_url, status_extracao)
ExtracaoProjeto(id, projeto_id, textos_json, camadas_json, blocos_json, cotas_nivel_json, ambientes_json, criado_em)
Pendencia(id, obra_id, projeto_id, texto_original, etapa_bloqueada, risco[alto|medio|baixo], status[aberta|resolvida], resolvida_por, resolvida_em)
Local(id, obra_id, tipo[pavimento|laje|ambiente|eixo], nome, pai_id?)
Etapa(id, codigo, nome, ordem)            -- catálogo: forma, armacao, concretagem, drywall_1a_face, drywall_fechamento, contrapiso, piso, forro, marcenaria
PontoControle(id, obra_id, etapa_id, local_id, descricao, grandeza[nivel|distancia|prumo|esquadro|existencia], valor_esperado, unidade, tolerancia_mais, tolerancia_menos, eh_interface, referencia_nivel?, exige_foto, origem[ia|manual], status_revisao[sugerido|aprovado|descartado], projeto_id, trecho_origem)
ExecucaoEtapa(id, obra_id, etapa_id, local_id, data_prevista, anunciada_por, status[anunciada|em_conferencia|bloqueada|aguardando_liberacao|liberada|recusada])
Verificacao(id, execucao_id, ponto_id, valor_medido, unidade, dentro_tolerancia, tentativa, foto_urls[], observacao, causa_provavel?, canal[flow|conversa], estruturada, user_id, criado_em, geo?)
Liberacao(id, execucao_id, decisao[liberada|recusada], justificativa, engenheiro_id, criado_em)
MensagemWhatsApp(id, tenant_id, user_id, direcao, tipo, payload_json, classificacao?, ponto_id?, criado_em)
AuditLog(id, tenant_id, ator_id, acao, entidade, entidade_id, antes_json, depois_json, criado_em)  -- append-only
```

---

## 6. Pipelines

### 6.1 Ingestão de projeto
1. Upload do DWG → job `extrair_dwg`.
2. Converter com libredwg-web; coletar: textos (TEXT/MTEXT/ATTRIB, inclusive dentro de blocos), nomes de camadas e contagem por camada, blocos inseridos, camadas de cota de nível, nomes de ambientes e áreas, carimbo (cliente, fase, revisão, data).
3. Limpar códigos de formatação de MTEXT (`\P`, `\A1;`, `{}` etc.).
4. Salvar `ExtracaoProjeto`.
5. Job `detectar_pendencias`: para cada nota, classificar (é pendência? qual etapa bloqueia? risco?). Saída tipada.
6. Job `gerar_pontos`: LLM recebe a extração + catálogo de etapas e devolve **JSON validado por schema** com pontos de controle. Cada ponto cita `trecho_origem` (o texto/camada de onde veio). Ênfase em **interfaces** (encontro entre lajes, entre pisos de materiais diferentes, trilhos embutidos piso/forro, vãos alinhados com marcenaria).
7. Pontos ficam `sugerido` até o engenheiro aprovar no painel. Sem aprovação, não entram em checklist.

### 6.2 Anúncio diário
- Cron por obra (horário configurável, padrão 16h): template utility para os encarregados → Flow "O que vai ser executado amanhã?" com etapas e locais possíveis (do estado da obra).
- Cria `ExecucaoEtapa` com status `anunciada`.
- Se houver `Pendencia` aberta que bloqueia aquela etapa, avisar o engenheiro na hora.

### 6.3 Checklist dinâmico (endpoint do Flow)
- Flow genérico `checklist_liberacao`. O endpoint recebe `{execucao_id, tela_atual, respostas}` e devolve a próxima tela.
- Ordem dos pontos: interfaces primeiro, depois pontos que já falharam nesta obra/equipe, depois o resto.
- No máximo 10 opções por tela; se houver mais de ~8 pontos, agrupar por região ("Laje L4 — eixos A a D").
- Tela por ponto: descrição, valor esperado ± tolerância, `TextInput` numérico, `PhotoPicker` (1 foto, obrigatório se `exige_foto`), observação.
- Ao concluir cada ponto: comparar com código → mostrar ✅ ou ❌.
- ❌ na 1ª tentativa → pedir nova medida. ❌ confirmado → pedir causa provável (opções + outro) e foto do ajuste/situação; marcar execução `bloqueada`.
- Interface: exigir medida dos dois lados **e** confirmar a mesma referência de nível; calcular a diferença.
- Fim: se tudo ✅ → `aguardando_liberacao`; enviar resumo ao engenheiro.
- Respeitar limites da Meta: endpoint rápido (nada de LLM síncrono aqui), máx. 100 telas por Flow, tarefa < 5 min, fotos enviadas na ação de conclusão (não passar valor de PhotoPicker em `navigate`).

### 6.4 Liberação
- Mensagem ao engenheiro com resumo (pontos ok/divergentes, fotos) + botões interativos Liberar / Recusar.
- Recusa exige justificativa. Tudo vai para `Liberacao` + `AuditLog`.
- Notificar o encarregado do resultado.

### 6.5 Fallback conversacional
- Mensagens livres (texto, foto, áudio) do encarregado: transcrever áudio; classificar (medida, ocorrência, pergunta, outro); extrair valor + ponto provável; registrar `Verificacao` com `estruturada=false` e pedir confirmação ("Entendi: fundo da laje L4 eixo B = 3,04 m. Confirma?").

---

## 7. Painel web (telas)

1. **Obras:** lista com status e alertas abertos.
2. **Obra › Projetos:** upload, revisão, status da extração, pendências detectadas.
3. **Obra › Pontos de controle:** tabela por etapa/local; aprovar, editar, descartar, criar manual; ver `trecho_origem`.
4. **Obra › Linha do tempo:** execuções anunciadas, em conferência, bloqueadas, liberadas.
5. **Execução:** cada verificação com medida, foto, tentativa, quem; botões Liberar/Recusar.
6. **Relatórios:** PDF por execução e por obra.
7. **Configurações:** usuários, horários, tolerâncias padrão por grandeza.

Interface em português, simples, pensada para engenheiro com pouco tempo.

---

## 8. Segurança, LGPD e confiabilidade
- Isolamento por tenant em todas as queries (teste automatizado disso).
- Fotos e projetos em bucket privado, URLs assinadas de curta duração.
- Validação de assinatura dos webhooks da Meta; endpoint de Flow com criptografia oficial.
- Idempotência no processamento de webhooks.
- `AuditLog` append-only; nenhuma liberação editável depois de feita (só nova decisão).
- Projetos de clientes podem ter direitos autorais: nunca expor arquivos fora do tenant.
- Saídas de IA sempre validadas por schema (zod); falha de validação → retry → marcar para revisão humana.

---

## 9. Entregas em etapas (faça nesta ordem, com testes em cada uma)

1. **Fundação:** monorepo, Postgres/Prisma, auth, tenants, obras, usuários, AuditLog.
2. **Ingestão DWG:** upload, worker de extração, tela de extração. *Aceite:* um DWG de interiores devolve textos limpos, camadas, ambientes com área e notas do projeto.
3. **Pendências + pontos com IA:** jobs, schema, tela de revisão. *Aceite:* notas com "a definir"/"aguardando" viram pendências com etapa e risco; pontos de interface aparecem com `trecho_origem`.
4. **WhatsApp:** Cloud API, webhooks, templates, identificação por número, fallback conversacional.
5. **Flows:** anúncio diário + checklist dinâmico + ramificação. *Aceite:* cenário das duas lajes (L3 concretada, L4 com forma 4 cm acima) bloqueia a execução e notifica o engenheiro.
6. **Liberação + relatório PDF.**
7. **Endurecimento:** testes de isolamento, idempotência, timeouts, observabilidade (logs estruturados + métricas por etapa).

---

## 10. Cenário de teste obrigatório (seed)

- Empresa "Construtora Exemplo", obra "Edifício Teste", engenheiro "Eng. Ana", encarregado "João".
- Pontos aprovados para concretagem da **Laje L4**: (1) nível do fundo da forma eixo A = 6,00 m ± 1 cm; (2) idem eixo B; (3) **interface L3/L4** — borda L3 já concretada = 6,00 m, forma L4 no mesmo ponto deve ser 6,00 m ± 0,5 cm, mesma referência de nível.
- João anuncia "Concretagem Laje L4 amanhã".
- Responde: ponto 1 = 6,005 ✅; ponto 2 = 6,000 ✅; interface: L3 = 6,000, L4 = 6,040, mesma RN = sim → ❌ → refaz → 6,040 → causa "forma montada fora do nível" + foto → execução **bloqueada** → Eng. Ana recebe alerta → recusa com justificativa → João recebe "Ajustar forma e reenviar conferência".
- Tudo isso aparece na linha do tempo e no relatório PDF.

---

## 11. Como trabalhar comigo
- Antes de codar, me devolva: arquitetura final, estrutura de pastas, schema Prisma e lista de jobs/rotas. Espere meu ok.
- Depois, entregue por etapa (seção 9), com testes e instruções para rodar localmente (docker-compose).
- Quando algo da API da Meta ou de um modelo de IA não estiver claro, consulte a documentação oficial atual em vez de supor.
- Sinalize decisões com impacto em custo (mensagens WhatsApp, tokens de IA) e mantenha um contador de custo por obra.
