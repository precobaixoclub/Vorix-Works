# Vorix → Plataforma de Marketing + Atendimento Omnichannel + CRM — Auditoria Técnica

Documento de auditoria e proposta de arquitetura, conforme pedido. **Nenhum código foi escrito
ainda.** Cobre os 18 pontos pedidos, na mesma numeração, específico para o estado real deste
repositório (não uma arquitetura genérica). Aguarda aprovação antes de iniciar a Fase 1.

Metodologia: 5 agentes de investigação (read-only) cobriram Instagram DM, Usuários/RBAC/Equipes,
Kanban/Proposta/Marketing (existência), AI Gateway, e Analytics/Billing/Auditoria — todos os
achados abaixo têm `arquivo:linha` real.

---

## 1. Fotografia da arquitetura atual

- **Hexagonal por camada**: `src/domain/<contexto>/`, `src/application/<contexto>/`,
  `src/infrastructure/`, `src/interfaces/api|worker/`. Isolamento entre bounded contexts é
  verificado em CI por scripts `check-<x>-isolation.mjs` (ex.:
  `scripts/check-inbox-conversation-isolation.mjs`, `scripts/check-ai-stack-isolation.mjs`).
  Qualquer contexto novo (CRM) precisa do seu próprio script de isolamento — é o padrão, não
  exceção.
- **Multi-tenant**: `tenantId` + `workspaceId` em toda tabela, guard
  `mustBelongToTenantAndWorkspace` replicado por módulo (Inbox tem sua própria versão). Hierarquia
  real: `User` (global) → `TenantMembership` (papel por tenant, um user pode ter memberships em
  vários tenants) → `Tenant` "tem" 1:N `Workspace`. **RBAC hoje é 100% escopado a Tenant, nunca a
  Workspace** — não existe conceito de permissão por workspace, e por isso "Equipes" (escopo menor
  que o tenant) é um conceito de RBAC genuinamente novo, não uma extensão trivial.
- **Módulo Conversas (Inbox)**: 7 fases já entregues e aprovadas (WhatsApp via WuzAPI). Domínio
  rico: `MessagingConnection` (sessão/QR/status), `InboxContact`, `InboxConversation` (status
  open/pending/resolved/archived, `assignedUserId`, `aiEnabled`/`aiPausedReason`), `InboxMessage`
  (status queued→sent→delivered→read→failed, retry/attempt tracking). RabbitMQ + worker dedicado.
  Feature-flag global `CONVERSATIONS_MODULE_ENABLED` (hoje `true` em produção, mas worker/gateway
  reais ainda não conectados de ponta a ponta — ver runbooks em `docs/conversas-*`).
- **Instagram DM**: módulo à parte, mais fino — sem pipeline de status, sem entidade de contato
  própria (participante inline na conversa), sem tracking de entrega, provider **stateless**
  (reusa token OAuth de publicação via `PublicationSecretStoragePort`, sem sessão/QR). Tem uma
  engine de automação por palavra-chave (`instagram_dm_automation_rules`) que o Inbox não tem.
- **AI Gateway** (`src/application/ai-gateway/`): stack real, multi-tenant, RBAC-aware,
  provider Anthropic. Contrato `AiRequest{operation, tenantId, workspaceId, input, outputSchema,
  policy, metadata}` → `AiResponse` **sempre validado estruturalmente (Zod) e semanticamente**
  antes de retornar (nunca texto livre cru). Credit-gated via `CreditAccountingService` com chave
  de idempotência (mesmo mecanismo que endureci na Fase 7 do Conversas). **Deliberadamente isolado**
  de um segundo stack de IA mais antigo, Icaro (`IcaroBrainPort`, usado só pelos 11 Skills de
  criação de conteúdo, sem garantias multi-tenant) — isolamento verificado por
  `scripts/check-ai-stack-isolation.mjs`.
- **Analytics**: pipeline de métricas/agregação (`AnalyticsEvent`, `eventType` fechado em ~28
  valores de publicação/execução/agendamento), snapshots, alert rules, insights. **Não é um log de
  eventos genérico** — filtra por janela de tempo, não por entidade.
- **Billing/Planos**: **dois sistemas paralelos, um cosmético e um real.**
  `platform-billing/platform-plan-catalog.ts` tem `features: readonly string[]` mas são strings de
  marketing nunca lidas como gate. O gate de verdade vive em `src/application/tenancy/` (Valentina):
  `TenantLimitCheckRequest{capability?, feature?, integration?, expectedConsumption?}` →
  `ValentinaTenantManager.checkLimits`, com `TenantPlanLimits` reais (cotas de IA, publicação,
  integrações). **Isto precisa ser resolvido antes de criar um terceiro sistema de entitlements
  pro CRM** (ver Riscos, item 17).
- **Auditoria**: três formatos distintos coexistem — `AuditLogPort` (login/logout, minimalista),
  `OperationalAuditRepositoryPort`/`AuditEvent` (o mais genérico: ator/recurso/contexto/resultado,
  já reusado por Credential Governance e Analytics export), e `inbox_conversation_events` (bespoke,
  só conversas). Nenhum é uma "tabela de timeline" de propósito geral.

## 2. Funcionalidades existentes que serão reutilizadas

| Reusar como está | Onde |
|---|---|
| `Permission`/`ROLE_PERMISSIONS`/`requirePermission` | `src/domain/identity/identity.model.ts` |
| `TenantMembership` (join user↔tenant) | idem — só precisa de `update`/`delete` novos no port |
| AI Gateway completo (`AiRequest`/credit-gating/idempotência) | `src/application/ai-gateway/` |
| Padrão de extração estruturada "texto → objeto tipado com evidência/confiança" | `briefing-field-extraction-result.v1.ts` — molde exato pro Copiloto Comercial |
| `ValentinaTenantManager.checkLimits`/`TenantPlanLimits` | `src/application/tenancy/` — vira a base de entitlements, não recriar |
| `OperationalAuditRepositoryPort`/`AuditEvent` | shape a generalizar pra auditoria de mudança de estágio/proposta |
| Padrão CAS (compare-and-set) pra concorrência | usado em toda parte do Inbox — reusar pra "mover card no Kanban"/"assumir negócio" |
| `MessagingProvider` port (contrato de canal) | base pra Instagram/Facebook via variante "stateless" |
| `DashboardKit`/`StatsGrid`/`ListCard`/`PageSubnav`/`HubPage` (design system) | `web/components/` — toda tela nova usa isso, nunca componente ad hoc |
| Padrão de migration numerada + checksum | `db/migrations/`, runner em `src/infrastructure/storage/postgres/migration-runner.ts` |

## 3. Gaps encontrados

- **RBAC não tem escopo de Team** (só Tenant) — bloqueador pra "Equipes" reais.
- **Zero fluxo de convite/remoção/troca de papel** — só signup e listagem read-only existem hoje.
- **Zero entidade de negócio/lead/oportunidade** em qualquer lugar do domínio.
- **Zero timeline genérica** — Analytics é métrica agregada, Inbox tem timeline só de conversa.
- **Zero camada de entitlements unificada** — dois sistemas paralelos (cosmético vs. real).
- **Zero mecanismo de sugestão-com-confirmação genérico** — só o padrão de campo-com-confiança do
  briefing, que precisa virar uma entidade persistente nova (`CommercialSuggestion`).
- **TikTok não tem confirmação de API pública de DM pra contas de negócio** — achado em
  investigação anterior, mantido como risco não resolvido.

## 4. Modelo de domínio recomendado

Novo bounded context `src/domain/crm/` (nome de pasta: `crm`), com isolamento próprio
(`scripts/check-crm-isolation.mjs`, nunca importa `inbox`/`instagram-dm` diretamente — comunicação
só via IDs referenciados e eventos, mesmo padrão do ADR-0004 já usado pelo resto do repo).

**Princípio de não-duplicação de Contato** (resolve a exigência da seção 4 do pedido sem quebrar
o Inbox): `inbox_contacts` (WhatsApp) **nunca é alterado nem tem sua FK de `inbox_conversations`
redirecionada** — zero risco de regressão em Conversas. Em cima disso, dois níveis novos e
puramente aditivos:

```
contacts                    (NOVO — a "pessoa" 360°: nome, empresa, tags, responsável,
                              equipe, origem, campos personalizados, criado_em, última_interação)
contact_identities           (NOVO — join: contact_id, channel, external_id, connection_id?)
inbox_contacts.contact_id    (NOVA coluna, nullable, aditiva — aponta pra cima, opcional)
```

Todo contato NOVO (a partir da Fase 1) nasce em `contacts` primeiro, e ganha uma
`contact_identities` ao ser identificado num canal. Contatos EXISTENTES do WhatsApp recebem uma
migration de backfill 1:1 (uma linha em `contacts` + uma em `contact_identities` por
`inbox_contacts` existente — nunca uma fusão de duas linhas diferentes sem sinal de confiança,
conforme pedido explicitamente).

## 5. Entidades/tabelas necessárias

| Entidade | Escopo | Campos-chave |
|---|---|---|
| `contacts` | tenant+workspace | nome, empresa, cpf_cnpj?, origem, responsável, equipe_id, tags[], campos_personalizados jsonb, criado_em, última_interação_em |
| `contact_identities` | tenant+workspace | contact_id, channel (whatsapp\|instagram\|facebook\|tiktok), external_id, connection_id? |
| `teams` | tenant+workspace | nome |
| `team_memberships` | — | team_id, user_id, papel |
| `tenant_member_invites` | tenant | e-mail, papel, token, status, expira_em |
| `pipelines` | tenant+workspace | nome, é_padrão |
| `pipeline_stages` | — | pipeline_id, nome, ordem, tipo (normal\|ganho\|perdido) |
| `deals` | tenant+workspace | pipeline_id, stage_id, contact_id, título, valor_cents, moeda, responsável, equipe_id, origem, probabilidade, previsão_fechamento, próxima_atividade_em, status, motivo_perda |
| `deal_stage_events` | — | deal_id, from_stage/to_stage, actor_type, actor_id, ocorrido_em (audit — reusa shape de `OperationalAuditRepositoryPort`) |
| `products` | tenant+workspace | nome, descrição, preço_padrão_cents, unidade, ativo, código? |
| `proposals` | tenant+workspace | deal_id, itens jsonb (produto/qtd/preço/desconto), subtotal, total, validade, condições, status, public_token, enviada_em, visualizada_em, respondida_em |
| `tasks` | tenant+workspace | contact_id?, deal_id?, tipo, responsável, equipe_id?, prazo, prioridade, status, observação |
| `timeline_events` | tenant+workspace | entity_type, entity_id, event_type, actor_type (user\|ai\|automation\|system), actor_id?, payload jsonb, ocorrido_em — índice em (entity_type, entity_id, ocorrido_em) |
| `commercial_suggestions` | tenant+workspace | source_conversation_id, tipo, payload jsonb, evidência, confiança, status (pending\|accepted\|dismissed) |
| `automation_rules` (CRM) | tenant+workspace | trigger, conditions jsonb, actions jsonb, ativo |
| `lead_scores` | 1:1 com contacts ou deals | score numérico, faixa (frio\|morno\|quente), fatores jsonb (nunca só o número) |

## 6. Relações entre Contact, Conversation, Deal, Proposal, Task e User

```
User ──< TeamMembership >── Team
  │                            │
  │ responsável/equipe_id      │ responsável/equipe_id
  ▼                            ▼
Contact ──< ContactIdentity (channel=whatsapp) ──> InboxContact ──< InboxConversation (existente, intocado)
  │
  ├──< Deal (contact_id) ──< Proposal (deal_id) ──< items (Product)
  │        │
  │        └──< DealStageEvent (audit)
  │
  ├──< Task (contact_id | deal_id)
  │
  └──< TimelineEvent (entity_type='contact'|'deal'|'conversation'|'proposal'|'task', entity_id)
```

`Conversation.status` (Inbox) e `Deal.stage_id` (CRM) são **independentes de propósito** — nenhum
gatilho automático fecha um a partir do outro sem passar por uma regra de automação explícita
(seção 6 do pedido, respeitado).

## 7. Eventos necessários

`timeline_events` recebe (nunca duplicando o payload inteiro, só referência + resumo):
`contact_created`, `identity_linked`, `conversation_started`, `ai_qualified`, `human_took_over`
(já existe em `inbox_conversation_events`, replicado aqui como referência), `deal_created`,
`deal_stage_changed`, `proposal_sent`, `proposal_viewed`, `proposal_accepted`/`_rejected`,
`task_created`/`_completed`, `suggestion_created`/`_accepted`/`_dismissed`, `automation_executed`.

## 8. APIs necessárias (novas, `/v1/crm/*` + extensões)

`/v1/contacts` (list/get/update/merge-manual), `/v1/pipelines` (CRUD), `/v1/deals` (CRUD +
`:id/move-stage`), `/v1/proposals` (CRUD + `:id/send`), `GET/POST /p/:token` (**pública, sem
auth** — visualizar/aceitar/recusar), `/v1/tasks` (CRUD), `/v1/products` (CRUD), `/v1/teams`
(CRUD), `/v1/tenant-members` (invite/update-role/remove), `/v1/contacts/:id/timeline` (GET),
`/v1/crm/suggestions` (list/accept/dismiss), `/v1/inbox/conversations/:id/crm-actions` (extensão
do Inbox: criar negócio/tarefa/proposta a partir da conversa — seção 11 do pedido).

## 9. Alterações de RBAC

Novas permissões no enum existente (nunca um segundo vocabulário): `contact:manage`,
`deal:manage`, `proposal:manage`, `task:manage`, `team:manage`, `tenant_member:manage`,
`automation:manage`, `product:manage`. Nova camada de **"perfil simples"** (seção 3 do pedido) —
um mapa `SIMPLE_PROFILE_TO_PERMISSIONS` (Administrador/Gestor/Atendimento/Comercial/Marketing →
conjunto de `Permission`s), usado só na UI de convite/atribuição — o RBAC granular interno
continua sendo a fonte de verdade, nunca substituído.

## 10. Estrutura de navegação proposta

Segue a estrutura que você já detalhou na seção 24, com um ajuste: o "painel agregador" da seção
22/23 vira parte do cockpit da Home (seção 14) em vez de um item de nav à parte — evita uma
terceira noção de "visão geral" competindo com Início e Resultados.

```
INÍCIO           — cockpit (seção 14: "o que precisa da sua atenção")
CONVERSAS        — Inbox (unificado), Contatos
COMERCIAL        — Negócios (Kanban), Tarefas, Propostas
MARKETING        — Criar, Produção, Conteúdos, Calendário, Publicar, Anúncios
RESULTADOS       — Analytics (atendimento + comercial + marketing, seções 20-23)
CONFIGURAÇÃO     — Marca, Conexões, Equipes, Usuários, Configurações
```

## 11. Wireframe textual das telas principais

- **Início (cockpit)**: lista de insights acionáveis (seção 14), cada um com botão
  "Resolver agora" levando direto ao contexto — nunca só um número.
- **Comercial → Negócios**: `PageHeader` (filtros: usuário/equipe/origem/período/pipeline/busca) →
  Kanban (colunas = stages do pipeline ativo) → card enxuto (contato, título, valor, responsável,
  próxima ação) → `DetailModal` ao abrir um negócio (seções: resumo, timeline, tarefas, propostas).
- **Inbox → dentro da conversa**: painel lateral hoje mostra Atendimento/IA (Fase 4-7) — ganha uma
  nova seção "Comercial" com as ações contextuais da seção 11 (Ver contato, Criar negócio, Gerar
  proposta, Adicionar tag) — nunca obriga sair da tela.
- **Proposta pública (`/p/:token`)**: página própria fora do shell autenticado, sóbria, com os
  itens/total/condições e botões Aceitar/Recusar.

## 12. Impacto no módulo Conversas existente

**Estrutural: zero.** `inbox_contacts`/`inbox_conversations`/`inbox_messages` não mudam de forma
nem de FK. Único acréscimo é a coluna nullable `contact_id` em `inbox_contacts` (aditiva) e um novo
painel/seção na UI da conversa (Fase 4 do roadmap). O worker, RabbitMQ, WuzAPI — nada disso é
tocado. A Fase 7 (aprovada, encerrada) permanece intacta.

## 13. Impacto no Marketing existente

Nenhuma lógica de Criar/Produção/Publicar muda — só a etiqueta de navegação ("Marketing" passa a
agrupar visualmente o que já existia). O agente João continua um passo de pipeline interno; nada
aqui expõe João como tela nova (isso ficaria pra uma decisão de produto separada, fora deste
escopo).

## 14. Estratégia para não quebrar código já aprovado

Toda mudança em tabela existente é **aditiva** (coluna nullable, nunca remove/renomeia — mesma
regra já seguida em todas as migrations do Conversas). Nenhuma FK existente é redirecionada.
`check-crm-isolation.mjs` novo garante que CRM nunca importa Inbox/Instagram DM diretamente.
Suite de testes de cada fase roda **antes** de mexer na fase seguinte — mesmo padrão de
verificação já usado nas 7 fases do Conversas.

## 15. Migrations previstas (numeração contínua a partir de 0089)

`0089_teams.sql` → `0090_tenant_member_invites.sql` → `0091_contacts.sql` →
`0092_contact_identities_and_inbox_backfill.sql` → `0093_pipelines_stages.sql` →
`0094_deals_and_stage_events.sql` → `0095_products.sql` → `0096_proposals.sql` →
`0097_tasks.sql` → `0098_timeline_events.sql` → `0099_commercial_suggestions.sql` →
`0100_crm_automation_rules.sql` → `0101_lead_scores.sql`.

## 16. Plano das fases 1 a 7

Adoto a ordem que você já definiu na seção 31 — bate com a análise técnica. Cada fase recebe seu
próprio plano detalhado (mesmo padrão do Conversas) antes do código começar; nenhuma fase começa
sem a anterior fechada e testada.

1. Fundação Comercial (Usuários/Equipes, Contact/ContactIdentity, Timeline, base de origem)
2. CRM (pipelines, stages, negócios, Kanban, motivos de perda)
3. Execução Comercial (tarefas, catálogo, propostas)
4. Integração com Conversas (ações contextuais na Inbox)
5. Inteligência (lead scoring, Copiloto Comercial sobre AI Gateway, Home cockpit)
6. Automação (triggers/conditions/actions, roteamento)
7. Resultados (métricas, atribuição, dashboard unificado)

## 17. Riscos técnicos

- **Dois sistemas de plano/limite paralelos hoje** (platform-billing cosmético vs. Valentina real)
  — decidir qual é canônico ANTES de estender entitlements pro CRM, senão vira um terceiro sistema.
- **TikTok DM**: sem confirmação de API pública de mensageria pra contas de negócio — não prometer
  prazo até validar na documentação oficial.
- **Fase 1 é a de maior risco de schema** — tudo depende de Contact/ContactIdentity estar certo;
  merece revisão extra antes de avançar pra Fase 2.
- **Analytics não deve virar Timeline** — são propósitos diferentes (métrica agregada vs. narrativa
  por entidade); documentar isso claramente evita confusão futura entre os dois logs de evento.
- **Icaro vs. AI Gateway**: o Copiloto Comercial só pode usar AI Gateway — isolamento já é
  verificado em CI, mas vale reforçar no code review da Fase 5.

## 18. O que NÃO construir agora

Sem financeiro/estoque/RH/emissão fiscal (explícito). Sem assinatura eletrônica. Sem editor de
automação tipo Zapier (v1 = regras guiadas simples). Sem interpretação de linguagem natural pra
automação (só preparar arquitetura, seção 17 do pedido). Sem TikTok DM até confirmação de API. Sem
merge automático agressivo de contato. Sem acoplar nome comercial de plano no código (usar
entitlements). Sem visão consolidada multiworkspace. Sem playbooks por segmento hardcoded.

---

Aguardando aprovação para iniciar a Fase 1.
