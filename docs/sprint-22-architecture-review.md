# Sprint 22 - Revisao Arquitetural

Data: 2026-07-30

Status: aguardando aprovacao antes de implementar codigo funcional.

## 1. Contexto Atual

A plataforma ja possui a cadeia:

Conversation -> Briefing -> Planning -> Runtime -> Execution -> Publication -> Durable Outbox -> Dispatch -> Reconciliation -> Credential Domain -> Governance -> Audit -> Compliance -> Multi-Provider Sandbox -> Webhooks -> Status Synchronization -> Provider Event Store -> Scheduling -> Temporal Queue -> Editorial Calendar -> Recovery -> Dead Letter.

Providers sandbox existentes:

- `meta_pages_sandbox`
- `linkedin_sandbox`
- `x_sandbox`

Production permanece bloqueado por design.

## 2. Decisao Arquitetural Principal

Criar um dominio independente `Analytics`.

Analytics deve consolidar eventos normalizados, metricas, snapshots, consultas, comparacoes, insights determiniscos, alertas internos, exportacoes e qualidade de dados.

Analytics nao deve:

- depender diretamente de adapters de providers;
- chamar APIs externas de analytics;
- executar publicacoes;
- alterar receipts;
- alterar schedules ou occurrences;
- reabrir fluxo de production;
- armazenar tokens, secrets, payload OAuth, headers sensiveis, conteudo integral desnecessario ou PII sem necessidade.

Fonte primaria de verdade analitica: `AnalyticsEvent` append-only.

Snapshots e agregacoes sao materializacoes reconstruiveis. Elas aceleram consultas, mas nao substituem os eventos.

## 3. Fronteiras de Dominio

Novo dominio:

- `src/domain/analytics/analytics.model.ts`

Nova camada de aplicacao:

- `src/application/analytics/analytics-event-ingestion-service.ts`
- `src/application/analytics/analytics-event-consumer.ts`
- `src/application/analytics/analytics-event-validator.ts`
- `src/application/analytics/analytics-event-deduplicator.ts`
- `src/application/analytics/analytics-dead-letter-service.ts`
- `src/application/analytics/analytics-metric-registry.ts`
- `src/application/analytics/analytics-aggregation-service.ts`
- `src/application/analytics/analytics-snapshot-builder.ts`
- `src/application/analytics/analytics-snapshot-rebuilder.ts`
- `src/application/analytics/analytics-query-service.ts`
- `src/application/analytics/analytics-query-validator.ts`
- `src/application/analytics/analytics-query-planner.ts`
- `src/application/analytics/analytics-data-quality-service.ts`
- `src/application/analytics/analytics-insight-engine.ts`
- `src/application/analytics/analytics-alert-service.ts`
- `src/application/analytics/analytics-export-service.ts`
- `src/application/analytics/analytics-retention-service.ts`
- `src/application/analytics/analytics-health-service.ts`

Novas portas:

- `AnalyticsRepositoryPort`
- `AnalyticsSnapshotRepositoryPort`
- `AnalyticsExportRepositoryPort`
- `AnalyticsClockPort` nao e necessario se o `ClockPort` existente for reutilizado.

Adapters:

- `InMemoryAnalyticsRepository`
- `PostgresAnalyticsRepository`

## 4. Fontes de Dados Disponiveis

### Publication

Arquivos principais:

- `src/domain/publication/publication.model.ts`
- `src/application/ports/publication-repository.port.ts`
- migrations `0042`, `0043`, `0044`

Fontes:

- `PublicationPlan`
- `PublicationTarget`
- `PublicationAttempt`
- `PublicationReceipt`
- `PublicationReceiptVerification`
- `PublicationReconciliation`
- `PublicationOutboxMessage`
- `PublicationDeadLetter`
- `PublicationEvent`
- `PublicationFailure`

Eventos ja existentes incluem publicacao criada, aprovada, iniciada, concluida, falha, receipt criado/verificado, outbox criado/reclamado/despachado/falhou, reconciliation e sincronizacao por provider.

### Scheduling

Arquivos principais:

- `src/domain/scheduling/scheduling.model.ts`
- `src/application/ports/scheduling-repository.port.ts`
- migration `0047`

Fontes:

- `PublicationSchedule`
- `ScheduleRule`
- `ScheduleOccurrence`
- `ScheduleConflict`
- `ScheduleDeadLetter`
- `ScheduleEvent`
- metricas operacionais de scheduling

Eventos e estados ja suportam created, generated, due, dispatched, missed, failed, cancelled, dead letter e reprocessamento.

### Webhook e Provider Event Store

Arquivos principais:

- `src/domain/webhook/webhook.model.ts`
- `src/application/ports/webhook-event-repository.port.ts`
- migration `0046`

Fontes:

- `WebhookEvent`
- `WebhookVerification`
- `ProviderEvent`
- `NormalizedProviderEvent`
- `SynchronizationEvent`

Risco importante: `WebhookEvent.headers` e `WebhookEvent.payload` sao dados brutos. Analytics deve consumir apenas eventos sanitizados/normalizados ou metadados seguros.

### Execution

Arquivos principais:

- `src/domain/execution/execution.model.ts`
- `src/application/ports/execution-repository.port.ts`
- migrations `0038`, `0039`, `0040`, `0041`

Fontes:

- `ExecutionRun`
- `ExecutionTaskRun`
- `ExecutionAttempt`
- `ExecutionArtifact`
- `ExecutionEvent`
- `ExecutionTrace`
- `HandlerResolutionEvent`

Execution possui duracoes em `ExecutionTrace.durationMs`, tentativas, retry, artifacts e failures. Custo ainda nao aparece como valor consolidado de dominio; Sprint 22 deve modelar `execution_cost_total` como derivavel somente quando houver fonte confiavel, nunca inventado.

### Planning

Arquivos principais:

- `src/domain/planning/planning.model.ts`
- `src/application/ports/planning-repository.port.ts`
- migrations `0024` a `0029`

Fontes:

- `Planning`
- `ExecutionTask`
- `PlanningArtifact`
- `PlanningDecision`

Planning nao possui eventos append-only proprios alem das entidades persistidas. Analytics deve gerar eventos de ingestao a partir de estado atual e historico disponivel, com cuidado para replay idempotente.

### Credential, Governance, Audit e Compliance

Arquivos principais:

- `src/domain/credential/credential.model.ts`
- `src/application/ports/credential-repository.port.ts`
- `src/application/ports/operational-audit-repository.port.ts`
- migration `0045`

Fontes:

- `Credential`
- `CredentialReference`
- `CredentialHealth`
- `AuditEvent`
- `ComplianceReport`

Analytics pode contar falhas de credencial, credential status e governance denied. Nao deve copiar secrets, tokens, scopes completos quando nao forem necessarios, payloads de OAuth ou headers.

### Workspace, Tenant e RBAC

Arquivos principais:

- `src/domain/workspace/workspace.model.ts`
- `src/domain/identity/identity.model.ts`

Fontes:

- `tenantId`
- `workspaceId`
- papel do principal autenticado
- permissoes existentes

Sprint 22 precisa adicionar permissoes analiticas no enum de identidade e validar todas as rotas no backend.

## 5. Eventos Incompletos e Lacunas

Lacunas identificadas:

- Planning nao emite `planning_created`/`planning_completed` como evento append-only dedicado; deve ser normalizado a partir de `Planning.status`.
- Execution possui eventos internos, mas nem todo evento minimo do prompt tem equivalencia direta de nome; precisa de mapeamento.
- Publication possui eventos ricos, mas estados e outbox podem gerar dupla contagem se `publication_completed`, `receipt_created` e `receipt_verified` forem todos tratados como publicacao concluida.
- Scheduling registra eventos, mas metricas como `schedule_occurrence_success_rate` exigem regra clara para denominator.
- Webhook bruto pode nao ter `tenantId`/`workspaceId`; evento analitico so deve ser aceito para metricas de workspace quando a normalizacao resolver o escopo.
- `execution_cost_total` so deve ser calculado quando houver custos persistidos ou metadata segura confiavel. Caso contrario, deve aparecer como dado indisponivel, nao zero.
- Metricas externas reais nao existem; Sprint 22 deve aceitar apenas snapshots simulados dos providers sandbox.

## 6. Riscos de Dupla Contagem

Riscos principais:

- A mesma publicacao pode aparecer em `PublicationEvent`, `PublicationAttempt`, `PublicationReceipt`, `PublicationOutboxMessage`, `PublicationReconciliation` e `NormalizedProviderEvent`.
- Replays de eventos podem reingerir o mesmo `eventId`.
- Webhooks podem chegar duplicados, com `externalEventId` repetido ou sem ele.
- Reconciliation pode confirmar uma publicacao que ja tinha receipt.
- Schedule occurrence pode ser reprocessada depois de dead letter.
- Snapshot rebuild pode somar dados ja materializados se usar snapshots como fonte.

Decisoes propostas:

- `AnalyticsEvent` e a unica entrada para agregacoes.
- unique constraint: `(tenant_id, event_id)`.
- Eventos compensatorios usam novo `eventId` e `causationId` apontando para o evento corrigido.
- Aggregation service ignora duplicatas e nunca calcula a partir de tabelas de snapshot.
- Cada metrica tera uma regra explicita de fonte canonica.

## 7. Riscos de Eventual Consistency

Riscos:

- Receipt pode chegar antes de `publication_completed`.
- Webhook pode chegar antes da tentativa ser finalizada.
- Occurrence pode ser marcada `dispatched` antes do receipt.
- Reconciliation pode resolver outcome dias depois.
- Eventos atrasados podem alterar agregacoes historicas.

Decisoes propostas:

- `occurredAt` define o periodo analitico.
- `ingestedAt` define lag operacional.
- Eventos fora de ordem sao aceitos se schema e referencias minimas forem validas.
- Snapshots devem ter `isStale`/`rebuiltAt` e podem ser reconstruidos por periodo.
- Query deve informar `dataFreshness` e `partialData` quando houver lag/dead letters.

## 8. Diferencas Entre Providers

Providers sandbox possuem capacidades diferentes:

- `meta_pages_sandbox`
- `linkedin_sandbox`
- `x_sandbox`

PublicationProviderDescriptor ja declara `capabilities.analytics`, `supportsStatusLookup`, `supportsReceiptVerification`, `supportsScheduling`, `supportsIdempotencyKey`, limites de payload e canais.

Analytics deve distinguir:

- `internal`
- `provider_reported`
- `estimated`
- `simulated`

Nenhuma metrica externa deve ser inferida quando o provider nao forneceu snapshot simulado.

## 9. Metricas Internas vs Externas

Metricas internas:

- eventos de workflow;
- fila/outbox;
- attempts;
- receipts;
- schedule occurrences;
- audit/governance;
- execution traces;
- data quality.

Metricas externas:

- `ProviderMetricSnapshot`;
- inicialmente apenas simuladas;
- nao podem ser derivadas de curtidas/impressions inexistentes;
- precisam carregar `isEstimated`, `isFinal`, `capturedAt` e `sourceTimestamp`.

## 10. Timezone e DST

Scheduling ja possui utilitarios de timezone IANA em `src/application/scheduling/timezone.ts`.

Decisoes propostas:

- Reutilizar validacao IANA.
- Persistir eventos e snapshots primarios em UTC.
- Query aceita timezone IANA e agrupa por dia/semana/mes local.
- Periodos `today`, `yesterday`, `current_week`, `previous_week`, `current_month` e `previous_month` devem ser calculados no timezone da consulta.
- Timezone invalido deve ser erro de validacao.
- Nunca agrupar por offset fixo.

## 11. Cardinalidade, Retencao e Performance

Riscos:

- `dimensions` arbitrarias podem explodir cardinalidade.
- Payloads brutos de webhooks/publication podem crescer muito.
- Eventos por leitura comum podem gerar cardinalidade excessiva.
- Snapshots diarios/mensais podem ficar inconsistentes apos replay.
- Exportacoes podem virar vazamento de dados se forem permanentes.

Decisoes propostas:

- `AnalyticsMetricRegistry` e `AnalyticsDimensionRegistry` devem bloquear metricas/dimensoes nao registradas.
- `dimensions` do evento so aceita chaves registradas.
- Limite configuravel para janela de query e export.
- Export artifact temporario, auditado e sujeito a retencao.
- Retencao separada para eventos, snapshots, aggregations, exports, dead letters e metricas externas.
- Leitura comum de dashboard nao deve gerar audit detalhado por padrao; consultas administrativas, export, rebuild e reprocessamento devem gerar audit.

## 12. Dados Sensiveis Proibidos no Analytics

Nao armazenar:

- tokens;
- secrets;
- senhas ou hashes de senha;
- payload OAuth;
- headers sensiveis;
- cookies;
- Authorization;
- raw webhook payload;
- conteudo integral de post/caption quando checksum ou tipo bastar;
- dados pessoais sem finalidade analitica explicita;
- payloads de execution artifacts quando apenas tipo/checksum/contagem sao necessarios.

Analytics pode armazenar metadata segura, como:

- status;
- providerId;
- channel;
- contentType;
- environment;
- ids internos;
- checksums;
- duracoes;
- contagens;
- flags `simulated`/`estimated`/`final`.

## 13. Contrato AnalyticsEvent

Contrato proposto:

- `eventId`
- `eventType`
- `eventVersion`
- `occurredAt`
- `ingestedAt`
- `tenantId`
- `workspaceId`
- `campaignId?`
- `planningId?`
- `executionRunId?`
- `publicationId?`
- `publicationReceiptId?`
- `scheduleId?`
- `occurrenceId?`
- `providerId?`
- `targetId?`
- `correlationId`
- `causationId?`
- `dimensions`
- `measurements`
- `source`
- `schemaVersion`

Campos adicionais recomendados:

- `environment`
- `dataSourceType`: `internal` | `provider_reported` | `estimated` | `simulated`
- `compensatesEventId?`
- `metadata`

Eventos sao append-only. Correcoes sao novos eventos compensatorios.

## 14. Eventos Minimos e Mapeamento

Mapeamento inicial:

- `planning_created`: `Planning` criado.
- `planning_completed`: `Planning.status = ready`.
- `execution_started`: `ExecutionEvent.run_started` ou `ExecutionRun.startedAt`.
- `execution_completed`: `ExecutionEvent.run_completed` ou `ExecutionRun.state = completed`.
- `execution_failed`: `ExecutionEvent.run_failed` ou `ExecutionRun.state = failed`.
- `publication_requested`: `publication_created`.
- `publication_queued`: `publication_enqueued` ou outbox `pending`.
- `publication_dispatched`: `outbox_dispatched`, `publication_started` ou attempt started, conforme regra canonica.
- `publication_completed`: `publication_completed` e/ou receipt canonico.
- `publication_failed`: `publication_failed` ou outbox permanent failure.
- `publication_unknown_outcome`: `unknown_outcome`.
- `publication_reconciled`: `reconciliation_completed`.
- `receipt_created`: `receipt_created`.
- `receipt_verified`: `receipt_verified`.
- `schedule_created`: `ScheduleEvent` de criacao.
- `schedule_occurrence_generated`: occurrence criada por gerador.
- `schedule_occurrence_due`: occurrence pendente vencida.
- `schedule_occurrence_dispatched`: occurrence `dispatched`.
- `schedule_occurrence_missed`: occurrence `missed`.
- `schedule_occurrence_failed`: occurrence `failed`/`dead_lettered`.
- `webhook_received`: `WebhookEvent.received`.
- `provider_status_updated`: `NormalizedProviderEvent`.
- `credential_failure`: audit/governance/credential health.
- `governance_denied`: audit de policy denied.

## 15. Metricas e Fonte Canonica

Cada metrica deve declarar fonte canonica no registry.

Exemplos:

- `publication_completed_total`: receipt canonico ou evento `publication_completed`, nao ambos.
- `publication_dispatch_latency_ms`: difference entre queued/outbox available e dispatched.
- `publication_completion_latency_ms`: difference entre requested e receipt/published.
- `publication_reconciliation_rate`: reconciliations completed / unknown outcomes.
- `schedule_on_time_rate`: occurrences dispatched dentro do threshold / dispatched total.
- `execution_duration_ms`: `ExecutionRun.finishedAt - startedAt` ou `ExecutionTrace` agregado, com regra explicita.
- `execution_cost_total`: indisponivel ate existir fonte persistida confiavel.

## 16. Modelo de Persistencia Proposto

Nova migration `0048_analytics_domain.sql`.

Tabelas propostas:

- `analytics_events`
- `analytics_metric_registry`
- `analytics_metrics`
- `analytics_snapshots`
- `analytics_aggregations`
- `analytics_provider_metric_snapshots`
- `analytics_insights`
- `analytics_alert_rules`
- `analytics_alert_occurrences`
- `analytics_exports`
- `analytics_dead_letters`
- `analytics_data_quality_reports`

Constraints:

- unique `(tenant_id, event_id)` em `analytics_events`.
- unique por snapshot `(tenant_id, workspace_id, snapshot_period, period_start_utc, metric_id, dimensions_hash)`.
- `metric_id` deve existir no registry.
- `dimension` deve ser registrada.

Indices:

- `tenant_id`
- `workspace_id`
- `event_type`
- `occurred_at`
- `provider_id`
- `campaign_id`
- `publication_id`
- `schedule_id`
- `metric_id`
- `snapshot_period`
- `created_at`
- `status`

## 17. API Proposta

Rotas:

- `GET /v1/analytics/overview`
- `POST /v1/analytics/query`
- `GET /v1/analytics/metrics`
- `GET /v1/analytics/providers`
- `GET /v1/analytics/campaigns`
- `GET /v1/analytics/scheduling`
- `GET /v1/analytics/publication`
- `GET /v1/analytics/execution`
- `GET /v1/analytics/funnel`
- `GET /v1/analytics/insights`
- `GET /v1/analytics/alerts`
- `POST /v1/analytics/alerts/:id/acknowledge`
- `POST /v1/analytics/alerts/:id/resolve`
- `GET /v1/analytics/data-quality`
- `POST /v1/analytics/exports`
- `GET /v1/analytics/exports/:id`
- `GET /v1/analytics/health`
- `POST /v1/analytics/admin/rebuild`
- `POST /v1/analytics/admin/reprocess/:eventId`

Regras:

- RBAC em todas as rotas.
- tenant/workspace isolation pelo principal autenticado.
- payload validation.
- query limits.
- nenhuma query SQL fornecida pelo cliente.
- audit para operacoes administrativas/export/reprocess/rebuild/alert update.

## 18. RBAC

Adicionar permissoes:

- `analytics:read`
- `analytics:query`
- `analytics:export`
- `analytics:operate`
- `analytics:rebuild`
- `analytics:data_quality:read`
- `analytics:alerts:read`
- `analytics:alerts:update`
- `analytics:admin`

Distribuicao proposta:

- `viewer`: leitura, query, insights/alerts/data quality leitura.
- `editor`: igual viewer, sem operacao administrativa.
- `admin` e `owner`: leitura, query, export, operate, rebuild, alert update e admin.

## 19. Frontend

Novo modulo:

- `web/features/analytics/`

Nova pagina:

- `web/app/workspaces/[workspaceId]/analytics/page.tsx`

Abas:

- Visao Geral
- Publicacoes
- Calendario
- Campanhas
- Providers
- Execution
- Funil
- Insights
- Alertas
- Qualidade dos Dados
- Exports

Design deve seguir o padrao atual do dashboard: interface operacional, densa, sem landing page, com filtros claros e estados de dado indisponivel distintos de zero real.

Graficos devem ser feitos sem biblioteca nova se o stack atual permitir HTML/CSS/React simples.

## 20. Estados de Interface

Cobrir:

- loading
- empty
- partial data
- stale data
- error
- permission denied
- data quality warning
- dado zero real
- dado pendente
- dado indisponivel

Dashboards nunca devem exibir zero quando a fonte esta indisponivel.

## 21. Insights e Alertas

`AnalyticsInsightEngine` deve usar apenas regras deterministicas.

Exemplos:

- aumento de falhas;
- atraso crescente no calendario;
- provider degradado;
- credential expiring;
- reconciliacao elevada;
- queda de sucesso;
- concentracao em provider;
- dead letters subindo;
- alto tempo Planning -> Publication;
- horarios com maior falha.

Alertas sao internos:

- `AnalyticsAlertRule`
- `AnalyticsAlertOccurrence`
- estados `active`, `acknowledged`, `resolved`, `dismissed`

Nao enviar email, SMS, push ou mensagens externas.

## 22. Exportacao

`AnalyticsExportService` deve criar jobs assincronos para:

- CSV
- JSON

Filtros:

- periodo
- metricas
- dimensoes
- provider
- campanha
- status

Exports devem ser temporarios, auditados, isolados por workspace, protegidos por RBAC e sujeitos a retencao.

## 23. Data Quality

`AnalyticsDataQualityService` deve verificar:

- eventos duplicados;
- eventos fora de ordem;
- eventos invalidos;
- campos ausentes;
- referencias quebradas;
- receipts sem publication;
- publications sem receipt;
- schedules sem occurrence;
- occurrences sem dispatch;
- metricas externas desatualizadas;
- snapshots inconsistentes.

Classificacao:

- `healthy`
- `warning`
- `critical`

## 24. Health e Observabilidade

Health deve verificar:

- ingestion;
- event lag;
- database;
- snapshot builder;
- query service;
- dead letters;
- data quality;
- export jobs;
- last successful aggregation;
- last successful snapshot.

Metricas internas:

- `analytics_events_ingested_total`
- `analytics_events_rejected_total`
- `analytics_events_duplicated_total`
- `analytics_events_dead_lettered_total`
- `analytics_ingestion_latency_ms`
- `analytics_query_total`
- `analytics_query_latency_ms`
- `analytics_query_failure_total`
- `analytics_snapshot_build_total`
- `analytics_snapshot_build_duration_ms`
- `analytics_snapshot_failure_total`
- `analytics_export_total`
- `analytics_export_failure_total`
- `analytics_data_quality_issue_total`
- `analytics_insight_generated_total`
- `analytics_alert_active_total`

## 25. Plano de Testes

Criar `tests/analytics.test.mjs` e script `npm run test:analytics`.

Cobrir:

- validacao de evento;
- deduplicacao por `(tenantId, eventId)`;
- replay idempotente;
- eventos fora de ordem;
- eventos atrasados;
- agregacoes count/sum/average/rate/percentage/percentile/distinct_count;
- timezone America/Sao_Paulo, America/New_York e DST;
- periodos relativos e custom;
- snapshots e rebuild;
- comparacoes de periodo/provider/campanha;
- funil editorial;
- data quality;
- insights deterministicos;
- alertas;
- export CSV/JSON;
- retencao;
- RBAC;
- tenant/workspace isolation.

Teste integrado obrigatorio:

Planning Event -> Execution Event -> Scheduling Event -> Publication Event -> Receipt Event -> Analytics Ingestion -> Deduplication -> Aggregation -> Snapshot -> Analytics Query -> Dashboard/API -> Insight -> Alert -> Audit.

Teste de performance controlado:

- 10 mil eventos obrigatorio.
- 100 mil eventos apenas se viavel no ambiente.
- consultas de 7 e 30 dias.
- rebuild de snapshots.
- exportacao.

## 26. Validacoes Obrigatorias Depois da Implementacao

Executar:

- `npm run typecheck`
- `npm run test:analytics`
- `npm run test:scheduling`
- `npm run test:publication`
- `npm run test:persistence`
- `npm run architecture:check`
- `cd web && npm run typecheck`
- `cd web && npm test`
- `npm test`

Todos devem passar antes do relatorio final.

## 27. Riscos Residenciais Antes da Implementacao

Riscos:

- Duplicidade entre eventos de Publication, Receipt, Reconciliation e Webhook.
- Campo `campaignId` e relacao Planning -> Campaign podem estar ausentes em alguns fluxos.
- `execution_cost_total` pode nao ter fonte confiavel.
- Webhook bruto contem payload/header sensivel e nao deve ser copiado.
- Alguns eventos fonte nao carregam tenant/workspace diretamente; normalizacao precisa resolver ou dead-letter.
- Snapshots podem ficar obsoletos apos eventos atrasados.
- Dashboards podem confundir zero real com dado indisponivel se o contrato de resposta nao for explicito.

Mitigacoes:

- contrato versionado de evento;
- registry fechado de metricas/dimensoes;
- deduplicacao por unique constraint;
- eventos compensatorios;
- dead letter analitica;
- data quality report;
- query result com metadata de disponibilidade/freshness;
- audit em operacoes administrativas.

## 28. Nao Escopo Confirmado

Nao implementar:

- publicacao em producao;
- novos providers;
- billing;
- analytics real de APIs externas;
- modelos preditivos;
- machine learning;
- recomendacao generativa;
- alteracao automatica de campanha;
- otimizacao automatica de horario;
- A/B testing;
- atribuicao de conversao;
- pixel de rastreamento;
- coleta de dados pessoais;
- data warehouse externo;
- BI externo;
- Google Analytics;
- Meta Insights real;
- LinkedIn Analytics real;
- X Analytics real.

## 29. Criterios de Aprovacao para Implementar

Implementacao pode iniciar apos aprovacao desta revisao.

Ordem recomendada:

1. Dominio, registry, portas e repositorios in-memory/Postgres.
2. Ingestion, validator, deduplicator e dead letter.
3. Aggregation, query, timezone e snapshots.
4. Data quality, insights, alertas, export e health.
5. API e RBAC.
6. Frontend Analytics.
7. Testes, validacoes obrigatorias e `docs/sprint-22-final-report.md`.

Production deve continuar bloqueado.

Sprint 23 nao deve ser iniciada.
