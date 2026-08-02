# Catálogo de Eventos — Zuno (RC 1.0)

Produzido na Sprint 24 (Fase 5) como parte da certificação arquitetural do Release Candidate 1.0. Cobre a plataforma nova (Conversation → ... → Operations, Sprint 08+). O pipeline legado (Arthur/Caio/Helena/Skills) tem seu próprio vocabulário de eventos, documentado separadamente (`ZunoEventName`, `src/application/events/zuno-event.contract.ts`) e fora do escopo deste catálogo — os dois nunca se misturam (ver `docs/adr/0004-independent-domain-isolation.md`).

## Como ler este catálogo

Cada domínio possui seu **próprio** enum fechado de tipos de evento e sua **própria** tabela de persistência — não existe um barramento de eventos único nem uma tabela `events` compartilhada entre domínios. Isso é intencional: seguem o mesmo princípio de isolamento por domínio já usado no resto da arquitetura (cada domínio dono do seu vocabulário, nunca importando o enum de outro). A composição entre domínios acontece por **hooks explícitos** (ex.: Planning → Runtime, Briefing → Planning) ou por **leitura best-effort de outro domínio** (ex.: Operations lendo tipos de Publication/Analytics/Scheduling só para health) — nunca por um evento genérico despachado num broker central.

Para cada domínio: origem (quem grava), consumidores (quem lê), versionamento, forma do payload, idempotência e retenção.

---

## 1. Conversation Events

- **Tabela:** `conversation_events` · **Tipo:** `ConversationEventType` (`src/domain/conversation/conversation.model.ts:156-177`)
- **Valores (19):** `user_message`, `intent_classified`, `context_updated`, `decision_made`, `system_message`, `state_changed`, `briefing_started`, `briefing_field_collected`, `briefing_field_updated`, `briefing_field_ambiguous`, `briefing_question_created`, `briefing_question_answered`, `briefing_confirmation_requested`, `briefing_confirmed`, `briefing_cancelled`, `briefing_suspended`, `briefing_resumed`, `command_prepared`, `command_superseded`.
- **Origem:** `application/conversation/*` (Arthur Conversation Decision) e `application/briefing/*` (fluxo de Briefing), sempre através de `ConversationEventRepositoryPort.append`.
- **Consumidores:** `GET /v1/conversations/:id/events` (auditoria/replay no frontend, `ConversationList`/`TurnBubble`); é a fonte de verdade para reconstruir o histórico de turnos — nunca reprocessado por outro domínio.
- **Versionamento:** nenhum campo `version`/`schemaVersion` no evento em si — o enum fechado É o contrato; qualquer novo tipo é uma mudança aditiva (nunca renomeia/remove um existente).
- **Payload:** `Record<string, unknown>` livre por tipo (nunca reaproveita o texto completo de uma pergunta/resumo — só ids/chaves para auditoria, decisão da Sprint 07).
- **Idempotência:** append-only, sem deduplicação — cada chamada de caso de uso grava exatamente um evento; a idempotência de negócio vive uma camada acima (`PreparedCommand`/`Planning` por `(preparedCommandId, revision)`/`planningId`).
- **Retenção:** indefinida (nunca há purge/TTL implementado).

## 2. Execution Events

- **Tabela:** `execution_events` (via `db/migrations/0038_execution_dry_run.sql`) · **Tipo:** `ExecutionEventType` (`src/domain/execution/execution.model.ts:121-136`)
- **Valores (14):** `run_created`, `run_started`, `task_ready`, `task_started`, `task_completed`, `task_failed`, `artifact_produced`, `gate_created`, `gate_resolved`, `retry_scheduled`, `run_completed`, `run_failed`, `run_cancelled`, `side_effect_blocked`.
- **Origem:** `application/execution/execution-engine.ts` e os handlers reais/simulados (`src/infrastructure/execution/*`) — sempre carregando `correlationId`/`causationId`/`traceId`.
- **Consumidores:** `GET /v1/execution-runs/:id/events`; `execution-observability.ts` (agrega em `GET /v1/execution/metrics`); Analytics lê estados via seus próprios eventos (`execution_started`/`execution_completed`/`execution_failed`), não estes diretamente.
- **Versionamento:** `ExecutionRun`/`ExecutionTaskRun` carregam `version: number` (optimistic locking, incrementado a cada transição — ver `execution-error-translator.ts` mapeando `OPTIMISTIC_LOCK_CONFLICT`→409) — o evento em si não é versionado, mas toda transição que o gera é.
- **Payload:** `payload?: Record<string, unknown>`, mais os campos estruturais (`taskRunId?`, `gateId?`).
- **Idempotência:** o `ExecutionRun` pai é criado de forma idempotente por `idempotencyKey` (`POST /execution-runs`, único endpoint de escrita com chave de idempotência obrigatória); os eventos subsequentes de um mesmo run não são idempotentes individualmente (dependem do run já existir).
- **Retenção:** indefinida; `execution_traces` (migration `0040`) guarda lineage por handler/tentativa para diagnóstico.

## 3. Publication Events

- **Tabela:** `publication_events` (`db/migrations/0042_publication_domain.sql`) · **Tipo:** `PublicationEventType` (`src/domain/publication/publication.model.ts:35-64`)
- **Valores (28):** `publication_created`, `publication_approved`, `publication_started`, `publication_completed`, `publication_failed`, `receipt_created`, `retry`, `cancelled`, `publication_scheduled`, `publication_enqueued`, `worker_started`, `worker_completed`, `recovery_enqueued`, `dead_letter_created`, `lock_contended`, `outbox_created`, `outbox_claimed`, `outbox_dispatched`, `outbox_failed`, `fencing_rejected`, `unknown_outcome`, `reconciliation_created`, `reconciliation_completed`, `receipt_verified`, `receipt_mismatch`, `receipt_updated`, `provider_event_received`, `publication_sync_completed`.
- **Origem:** `application/publication/publication-orchestrator.ts`, `publication-dispatch-service.ts`, `publication-outbox-intent.ts`, `publication-reconciliation-service.ts` — todo evento herda `traceId`/`correlationId` do plano de execução de origem (propagação confirmada de `Execution` para `Publication`).
- **Consumidores:** `GET /v1/publications/:id/receipts`/`/attempts`; `AnalyticsAlertService` (deriva `publication_failure_rate`/`dead_letter` a partir destes); `WebhookPublicationSynchronizationService` cruza `provider_event_received` com o estado local para reconciliação.
- **Versionamento:** `PublicationPlan` carrega `version: number` (optimistic lock) e `schemaVersion: number`; `providerVersion: string` identifica a versão do adapter do provider.
- **Payload:** este é o único domínio com a "outbox pattern" completa (Durable Outbox → Dispatch → Reconciliation, exatamente como no mapa de domínios do PROMPT 24) — `outbox_created`→`outbox_claimed`→`outbox_dispatched`→(`outbox_failed`|sucesso), com `fencing_rejected` cobrindo o caso de dois workers disputando o mesmo lock (`publication_locks`, TTL por `expires_at`).
- **Idempotência:** `idempotency_key` em `publication_plans`, `publication_targets`, `publication_attempts` e `publication_receipts` (4 pontos distintos de dedupe ao longo do funil) — `POST /publications` exige `idempotencyKey` no body.
- **Retenção:** indefinida; `publication_failures`/`publication_dead_letters` acumulam sem purge automático (risco documentado na Seção "Riscos residuais" do relatório final).

## 4. Webhook Events (inbound, de providers externos)

- **Tabela:** `webhook_events` (`db/migrations/0046_webhook_provider_event_sync.sql`) · **Status:** `WebhookStatus` (`src/domain/webhook/webhook.model.ts:3`) — `received → verified|rejected → normalized → processed|failed`.
- **Origem:** `POST /webhooks/:provider` (rota **fora** de `/v1` — ver achado na certificação de API), único ponto de entrada externo não autenticado por principal (autenticado por assinatura HMAC-SHA256).
- **Consumidores:** `application/webhook/provider-event-normalizer.ts` (normaliza por provider) → `publication-synchronization-service.ts` (cruza com `publication_events`) → Analytics registra `webhook_received`.
- **Versionamento:** nenhum campo de versão explícito no modelo (`WebhookEvent`) — gap real, listado na certificação (Fase 3).
- **Payload:** bruto do provider é preservado (`rawPayload`) mas **redigido em logs** (`redactOperationalValue`, chaves como `token`/`secret`/`authorization`/`cookie`/`oauth`/`raw payload`/`credential` viram `[REDACTED]`).
- **Idempotência:** por **nonce** (replay protection — `webhook-signature-verifier.ts:38-39`, `hasNonce`/`rememberNonce`), não por um campo de negócio; um nonce repetido é rejeitado (`replay_detected`) antes de qualquer processamento.
- **Retenção:** indefinida; nenhuma política de expurgo de nonce encontrada (crescimento ilimitado da tabela de nonces é um risco de performance de longo prazo — ver Riscos residuais).

## 5. Scheduling — sem tabela de eventos própria

- Scheduling não tem um `scheduling_events`/`SchedulingEventType` dedicado — ele **produz leituras para Analytics** (`schedule_created`, `schedule_occurrence_generated/due/dispatched/completed/missed/failed/cancelled`, todos definidos no enum de Analytics, não no de Scheduling) e mantém seu próprio estado transacional (`schedules`, `schedule_occurrences`, migration `0047`). Isso é uma assimetria real em relação aos outros domínios — Scheduling é "produtor de eventos analíticos" sem ser "dono de um catálogo de eventos" no mesmo sentido que Execution/Publication/Conversation. Documentado como achado, não como defeito corrigível nesta sprint (não adiciona funcionalidade).

## 6. Analytics Events

- **Tabela:** `analytics_events` (`db/migrations/0048_analytics_domain.sql`) · **Tipo:** `AnalyticsEventType` (`src/domain/analytics/analytics.model.ts:3-32`)
- **Valores (28):** `planning_created`, `planning_completed`, `execution_started`, `execution_completed`, `execution_failed`, `publication_requested`, `publication_queued`, `publication_dispatched`, `publication_completed`, `publication_failed`, `publication_unknown_outcome`, `publication_reconciled`, `publication_cancelled`, `receipt_created`, `receipt_verified`, `schedule_created`, `schedule_occurrence_generated`, `schedule_occurrence_due`, `schedule_occurrence_dispatched`, `schedule_occurrence_completed`, `schedule_occurrence_missed`, `schedule_occurrence_failed`, `schedule_occurrence_cancelled`, `webhook_received`, `provider_status_updated`, `credential_failure`, `governance_denied`, `analytics_compensation`.
- **Origem:** é o único domínio cujo enum **espelha, por nome, eventos de outros 4 domínios** (Planning/Execution/Publication/Scheduling/Webhook/Credential/Governance) — Analytics é deliberadamente o "sumidouro" (sink) analítico de toda a plataforma, nunca a fonte de verdade operacional de nenhum deles.
- **Consumidores:** `GET /v1/analytics/*` (queries agregadas), `AnalyticsAlertService` (avalia regras contra estes eventos), painel `web/features/analytics`.
- **Versionamento:** `eventVersion: number`, `schemaVersion: number`, `version: number` — o domínio mais explicitamente versionado da plataforma nova.
- **Payload:** estruturado por `eventType`, com `analytics_compensation` cobrindo o caso de correção retroativa de um evento já contabilizado (nunca edita o evento original — só compensa, mantendo o log append-only).
- **Idempotência:** dedupe por identificadores de origem (ex.: `publication_completed` referenciando o `publicationId`/`attemptId` de origem) — não há uma chave de idempotência única e centralizada documentada no modelo; depende de cada gravador não duplicar a chamada.
- **Retenção:** indefinida; `analytics_dead_letters` existe para eventos que falharam ao processar (worker de Analytics), com endpoint de reprocessamento (`scheduling`-style dead-letter, ver Recovery Tests no relatório final).

## 7. Audit Log (Identity) — escopo restrito, por decisão

- **Tabela:** audit log de Identity (Sprint 05) · **Tipo:** `AuditEventType` (`src/application/ports/audit-log.port.ts:7-14`)
- **Valores (6):** `login_success`, `login_failed`, `logout`, `refresh_success`, `refresh_replay_detected`, `tenant_switch`.
- **Decisão documentada em código** (`audit-log.port.ts:1-5`): "apenas estrutura... grava o evento, não oferece consulta/dashboard/alerta (observabilidade completa é explicitamente fora de escopo)" — write-only por desenho original da Sprint 05.
- **Nota RC 1.0:** esse escopo restrito foi **superado** por um segundo mecanismo de auditoria mais rico, adicionado depois para Credential/Governance (`GET /v1/credentials/audit`, `GET /v1/credentials/compliance`, permissão `audit:read`, e `requireAuditedPermission` em `credentials.route.ts` que grava `rbac.denied` a cada negação de permissão). **Existem hoje dois sistemas de auditoria paralelos, não unificados** — um write-only (Identity, 6 tipos) e um consultável (Credential/Governance). Achado documentado, não corrigido nesta sprint.

---

## Resumo — matriz de propriedades por domínio

| Domínio | Tipos | Versionado? | Idempotência | Retenção/Purge |
|---|---|---|---|---|
| Conversation | 19 | Não (enum fechado = contrato) | Não (camada acima) | Indefinida |
| Execution | 14 | Sim (`version` no run/task) | Sim (`idempotencyKey` na criação do run) | Indefinida |
| Publication | 28 | Sim (`version`/`schemaVersion`/`providerVersion`) | Sim (4 pontos de `idempotency_key`) | Indefinida |
| Webhook | — (status, não tipo) | Não | Sim (nonce/replay) | Indefinida (nonces sem TTL) |
| Scheduling | — (produz para Analytics) | Parcial (`version` no modelo) | Não documentada centralmente | Indefinida |
| Analytics | 28 | Sim (o mais explícito) | Parcial (por chave de origem) | Indefinida (com dead-letter) |
| Audit (Identity) | 6 | Não | N/A (write-only) | Indefinida |
