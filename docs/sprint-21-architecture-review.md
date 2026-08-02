# Sprint 21 - Revisao Arquitetural

Data: 2026-07-30

Status: aguardando aprovacao antes de implementar codigo funcional.

## 1. Contexto Atual

A plataforma ja possui Publication Domain, Durable Outbox, Dispatch, Reconciliation, Credential Domain, Governance, Audit, Compliance, Multi-Provider Sandbox, Webhooks, Status Synchronization e Provider Event Store.

O codigo atual tambem possui um agendamento simples legado dentro de Publication:

- `PublicationPlan.scheduledAt` e `PublicationPlan.timezone`
- `PublicationSchedule` em `src/domain/publication/publication.model.ts`
- metodos de schedule em `PublicationRepositoryPort`
- `schedulePublication()` e `runDueSchedules()` em `publication-orchestrator.ts`
- rotas `/v1/publications/schedules`, `/v1/publications/:id/reschedule` e `/v1/publications/operate/run-due`

Esse modelo e insuficiente para a Sprint 21 porque mistura agenda editorial com Publication, nao materializa ocorrencias recorrentes, nao possui fila temporal duravel propria, nao modela conflito, missed occurrence, claim por ocorrencia, dead letter especifica nem timezone com IANA como invariante forte.

## 2. Decisao Arquitetural Principal

Criar um dominio independente `Scheduling`.

Scheduling nao deve publicar diretamente, nao deve chamar providers, nao deve criar receipts e nao deve mutar Publication fora de uma porta explicita de bridge.

Responsabilidade de Scheduling:

- representar schedules editoriais;
- gerar ocorrencias;
- decidir quando uma ocorrencia esta apta;
- fazer claim/lease/fencing de ocorrencias;
- reavaliar policy, credencial e provider health antes de dispatch;
- chamar uma porta de dispatch para entrar no fluxo de Publication/Outbox;
- registrar historico, conflitos, dead letters e metricas operacionais.

Responsabilidade de Publication:

- manter plano, candidato, target, approval, outbox, attempt, receipt, reconciliation e eventos de publicacao;
- continuar bloqueando production;
- continuar isolado de timezone, recorrencia e calendario editorial.

## 3. Fronteiras de Dominio

Novo dominio:

- `src/domain/scheduling/scheduling.model.ts`

Nova camada de aplicacao:

- `src/application/scheduling/schedule-use-cases.ts`
- `src/application/scheduling/schedule-occurrence-generator.ts`
- `src/application/scheduling/temporal-queue.ts`
- `src/application/scheduling/schedule-reschedule-service.ts`
- `src/application/scheduling/schedule-conflict-detector.ts`
- `src/application/scheduling/scheduling-recovery-service.ts`
- `src/application/scheduling/scheduling-health-service.ts`
- `src/application/scheduling/scheduling-publication-dispatcher.ts`

Novas portas:

- `SchedulingRepositoryPort`
- `ClockPort`
- `ScheduledPublicationDispatcherPort`
- opcionalmente `SchedulingMetricsPort`

Adapters:

- `InMemorySchedulingRepository`
- `PostgresSchedulingRepository`
- `SystemClock`
- `FixedClock`
- `MutableTestClock`

## 4. Entidades e Estados

Entidades minimas:

- `PublicationSchedule`
- `ScheduleOccurrence`
- `ScheduleRule`
- `ScheduleWindow`
- `ScheduleTimezone`
- `ScheduleConflict`
- `ScheduleExecutionReference`
- `ScheduleAuditReference`
- `ScheduleDeadLetter`
- `TemporalQueueItem`
- `TemporalClaim`
- `TemporalLease`
- `TemporalFencingToken`

Estados de `PublicationSchedule`:

- `draft`
- `scheduled`
- `paused`
- `due`
- `dispatching`
- `completed`
- `cancelled`
- `expired`
- `failed`

Estados de `ScheduleOccurrence`:

- `pending`
- `claimed`
- `dispatched`
- `completed`
- `cancelled`
- `missed`
- `failed`
- `dead_lettered`

Invariantes:

- ocorrencia concluida nao pode ser alterada;
- ocorrencia ja enviada ao outbox nao pode ser apagada;
- cancelamento preserva historico;
- retry preserva idempotency key;
- mutacao depois de claim valida fencing token;
- timezone e sempre IANA;
- instante de execucao e persistido em UTC;
- timezone original e preservado;
- recorrencia nunca e infinita sem policy explicita.

## 5. Relacao com Publication

O bridge deve ser uma porta:

`ScheduledPublicationDispatcherPort`

Implementacao:

`SchedulingPublicationDispatcher`

Fluxo proposto:

1. `TemporalDispatcher` seleciona ocorrencia due.
2. `SchedulingRepositoryPort.claimDueOccurrences()` faz claim atomico.
3. `SchedulingPublicationDispatcher` reavalia governance, credencial e health.
4. Dispatcher chama Publication por portas existentes, preferencialmente criando/enfileirando outbox via `ensurePublicationOutboxIntents()`.
5. Scheduling marca ocorrencia como `dispatched` apenas se a criacao/entrada no outbox for confirmada.
6. Receipts seguem sendo criados por Publication Dispatch, Webhooks ou Reconciliation.

Scheduling deve guardar uma referencia operacional para o resultado, por exemplo:

- `publicationId`
- `targetId`
- `outboxMessageId`
- `attemptId`
- `fencingToken`
- `dispatchRequestedAt`

## 6. Temporal Queue

A fila temporal deve ser duravel e baseada em `schedule_occurrences`, nao na fila em memoria atual de Publication.

Selecao de itens:

- `due_at <= now`
- `status = 'pending'`
- schedule pai ativo;
- policy valida;
- credencial valida;
- provider disponivel ou aceito pela policy;
- ocorrencia nao cancelada;
- idempotency key unica.

Postgres deve usar:

- `for update skip locked`;
- `lease_until`;
- `claimed_by`;
- `claimed_at`;
- `fencing_token`;
- `attempt_count`;
- unique constraint de idempotencia.

O adapter em memoria deve simular o mesmo contrato para testes, inclusive fencing.

## 7. Idempotencia

Idempotency key conceitual:

`scheduleId:occurrenceId:publicationCandidateId:providerId:targetId`

Essa key deve ser gravada em:

- `schedule_occurrences.idempotency_key`;
- referencia de dispatch;
- entrada de Publication/Outbox quando aplicavel.

Reprocessamento administrativo de dead letter deve reaproveitar a mesma key quando for retry da mesma ocorrencia. Se houver nova versao por reagendamento pos-claim, a nova ocorrencia deve ter novo id/versao e manter referencia historica para a anterior.

## 8. Recorrencia e Geracao de Ocorrencias

`ScheduleOccurrenceGenerator` deve materializar somente uma janela futura limitada, por padrao 30 dias.

Tipos iniciais:

- `daily`
- `weekly`
- `monthly`
- `custom_interval`

Regras:

- `startAt` obrigatorio;
- `endAt` ou `count` obrigatorio, salvo policy explicita para recorrencia aberta;
- `timezone` IANA obrigatorio;
- `interval` positivo e limitado;
- `daysOfWeek` valido para semanal;
- `dayOfMonth` valido para mensal;
- geracao idempotente com unique por schedule/version/local occurrence key.

Risco especifico: JavaScript sem biblioteca dedicada tende a errar DST e calendario civil. Recomendacao: usar APIs nativas com `Intl` apenas para validacao/exibicao e encapsular calculo civil em funcoes testadas; se permitido pelo projeto, adicionar uma dependencia pequena e madura para timezone civil. Como o prompt exige DST, o calculo nao deve ser feito por offset fixo.

## 9. Timezone, DST e Clock

`ScheduleTimezone` deve aceitar somente identificadores IANA validos, validados via `Intl.DateTimeFormat`.

Persistencia:

- `due_at_utc`
- `local_time`
- `timezone`
- opcional `timezone_offset_at_generation` apenas para auditoria, nunca para calculo futuro.

`ClockPort` deve ser introduzido antes dos services de Scheduling:

- `SystemClock`
- `FixedClock`
- `MutableTestClock`

Nenhum arquivo de Scheduling deve chamar `Date.now()` ou `new Date()` diretamente. A borda API pode converter input bruto, mas a decisao temporal fica no service com ClockPort.

## 10. Reagendamento

Regras recomendadas:

- antes do claim: atualizar `dueAtUtc`, gerar evento e recalcular conflitos;
- apos claim: rejeitar por padrao com erro `SCHEDULE_OCCURRENCE_ALREADY_CLAIMED`;
- alternativa futura: criar nova versao de ocorrencia e cancelar a anterior, mantendo historico;
- ocorrencia concluida/dispatched/dead_lettered nao pode ser alterada;
- alteracao de timezone deve exigir campo explicito `timezoneChangeReason`.

## 11. Cancelamento, Pausa e Retomada

Cancelamento:

- schedule completo: marca schedule como `cancelled` e ocorrencias futuras como `cancelled`;
- ocorrencia individual: marca somente aquela ocorrencia se ainda nao dispatched/completed;
- futuras ocorrencias: cancela `pending/missed` futuras e preserva historico;
- recorrencia: encerra rule e impede geracao futura.

Pausa:

- schedule vira `paused`;
- gerador ignora schedules pausados;
- dispatcher nao claim ocorrencias de schedule pausado;
- ocorrencias ja due devem virar `missed` ou ficar pendentes conforme policy, mas padrao deve ser `manual_review`.

Retomada:

- schedule volta para `scheduled`;
- recalcula apenas futuras;
- nao dispara automaticamente atrasadas;
- aplica missed occurrence policy.

## 12. Missed Occurrence Policy

Valores:

- `skip`
- `dispatch_immediately`
- `reschedule_next_window`
- `manual_review`

Default: `manual_review`.

Regra de seguranca: nenhuma publicacao atrasada deve ser enviada automaticamente sem policy explicita salva no schedule e revalidada no dispatch.

## 13. Conflitos

`ScheduleConflictDetector` deve classificar:

- `info`
- `warning`
- `blocking`

Conflitos a detectar:

- mesmo target na mesma janela;
- mesmo provider na mesma janela;
- mesma campanha;
- limite operacional por workspace/provider;
- credencial ausente/invalida;
- governance incompatavel;
- duplicacao de conteudo por checksum;
- recorrencia gerando ocorrencias equivalentes.

Conflito bloqueante deve impedir claim/dispatch, mas nao precisa impedir sempre a criacao de schedule. O calendario deve exibir conflitos pendentes.

## 14. Governance, Credential e Provider Health

A autorizacao na criacao do schedule nao basta.

No dispatch, reavaliar:

- tenant;
- workspace;
- provider;
- environment;
- canary;
- credential;
- approval;
- RBAC operacional;
- provider health;
- schedule policy.

Credential validation deve verificar:

- credencial existe;
- binding provider/workspace confere;
- status permite uso;
- token nao expirou;
- scopes suficientes;
- environment sandbox;
- production bloqueada.

Provider health:

- `healthy`: permitir;
- `degraded`: permitir somente se policy aceitar;
- `unavailable`: nao dispatch; reagendar/revisao;
- `rate_limited`: usar `retryAfter`;
- `authentication_required`: bloquear e pedir acao administrativa.

## 15. Recovery e Dead Letter

`SchedulingRecoveryService` deve:

- liberar leases expirados;
- marcar ocorrencias atrasadas conforme missed policy;
- recuperar ocorrencias claimed por worker morto;
- detectar falha entre claim e outbox;
- nao duplicar outbox;
- criar dead letter quando tentativas excederem policy ou erro for nao retentavel.

`ScheduleDeadLetter` deve guardar:

- `scheduleId`
- `occurrenceId`
- `failureCode`
- `failureCategory`
- `attemptCount`
- `lastError`
- `nextAction`
- `createdAt`

Reprocessamento administrativo deve exigir RBAC, registrar auditoria e validar fencing/idempotencia.

## 16. Persistencia

Nova migration sugerida:

`0047_scheduling_editorial_calendar.sql`

Tabelas:

- `publication_schedules`
- `schedule_rules`
- `schedule_occurrences`
- `schedule_conflicts`
- `schedule_claims`
- `schedule_dead_letters`
- `schedule_events`

Observacao: ja existe tabela `publication_schedules` na migration de Publication. Ha duas opcoes:

1. renomear a tabela nova para `scheduling_publication_schedules` para evitar conflito e preservar compatibilidade;
2. migrar/expandir a tabela existente com muito cuidado.

Recomendacao: usar prefixo `scheduling_` nas tabelas novas para evitar colisao com o legado de Publication e permitir migracao controlada depois.

Indices obrigatorios:

- `tenant_id, workspace_id`
- `status`
- `due_at_utc`
- `schedule_id`
- `provider_id`
- `target_id`
- `lease_until`
- `created_at`
- `idempotency_key`

Unique constraints:

- `schedule_occurrences(idempotency_key)`
- opcional `schedule_id, occurrence_key, version`

## 17. API e RBAC

Novas rotas sob `/v1`:

- `GET /schedules`
- `POST /schedules`
- `GET /schedules/:id`
- `PATCH /schedules/:id`
- `POST /schedules/:id/pause`
- `POST /schedules/:id/resume`
- `POST /schedules/:id/cancel`
- `POST /schedules/:id/reschedule`
- `GET /schedules/:id/occurrences`
- `POST /schedule-occurrences/:id/cancel`
- `POST /schedule-occurrences/:id/reprocess`
- `GET /calendar`
- `GET /scheduling/health`
- `GET /scheduling/dead-letters`
- `POST /scheduling/dead-letters/:id/reprocess`
- opcional `POST /scheduling/operate/run-due`
- opcional `POST /scheduling/operate/recover`

Permissoes a adicionar:

- `schedule:read`
- `schedule:create`
- `schedule:update`
- `schedule:cancel`
- `schedule:pause`
- `schedule:resume`
- `schedule:reprocess`
- `calendar:read`
- `scheduling:operate`
- `scheduling:dead_letter:read`
- `scheduling:dead_letter:reprocess`

Mapeamento recomendado:

- viewer: `schedule:read`, `calendar:read`
- editor: viewer + `schedule:create`, `schedule:update`
- admin/owner: todas as permissoes de Scheduling

Todas as rotas administrativas devem registrar auditoria operacional append-only.

## 18. Frontend

Novo modulo:

- `web/features/scheduling/*`
- `web/app/workspaces/[workspaceId]/calendar/page.tsx`

Observacao: ja existe `web/features/calendar` com dados/componentes estaticos. A Sprint 21 deve substituir ou adaptar esse modulo para API real, evitando dois calendarios divergentes.

Tela deve suportar:

- mes/semana/dia;
- criacao de schedule;
- edicao;
- reagendamento;
- pausa/retomada;
- cancelamento;
- recorrencia;
- conflitos;
- timezone;
- filtros por provider/status;
- detalhe de ocorrencia;
- dead letters;
- historico de auditoria;
- nenhuma exibicao de tokens/secrets.

## 19. Riscos Identificados

Duplicacao:

- risco de manter schedule legado em Publication e novo Scheduling em paralelo;
- mitigacao: novo modulo deve ser source of truth; rotas antigas devem ser deprecated ou adaptadas para ler Scheduling.

Timezone:

- risco de usar offset fixo e errar DST;
- mitigacao: IANA obrigatorio, UTC persistido, testes em transicoes de DST.

Concorrencia:

- risco de dois workers claimarem mesma ocorrencia;
- mitigacao: `for update skip locked`, fencing token e unique idempotency.

Clock drift:

- risco de workers com relogios diferentes;
- mitigacao: ClockPort, health de drift e preferencia por `now()` do banco em Postgres para claim.

Execucao atrasada:

- risco de publicar conteudo antigo automaticamente;
- mitigacao: missed policy default `manual_review`.

Recorrencia:

- risco de geracao infinita ou duplicada;
- mitigacao: janela limitada, count/endAt obrigatorio, unique key por ocorrencia.

Cancelamento concorrente:

- risco de cancelar depois de claim e ainda dispatch ocorrer;
- mitigacao: dispatch valida fencing e status atual antes de criar outbox.

Restart durante disparo:

- risco de duplicar outbox depois de crash;
- mitigacao: idempotency key estavel, referencia de execution e recovery idempotente.

Falha entre claim e outbox:

- risco de ocorrencia ficar claimed para sempre;
- mitigacao: lease expiravel + recovery.

Falha entre outbox e dispatch:

- ja existe mitigacao em Publication Outbox/Reconciliation; Scheduling deve nao tentar substituir esse mecanismo.

Provider production:

- risco de rota nova burlar policy;
- mitigacao: dispatcher usa PublicationGovernancePolicy e PublicationProviderPolicy existentes e verifica `productionEnabled=false`.

## 20. Plano de Implementacao Apos Aprovacao

1. Criar dominio Scheduling, ClockPort e tipos.
2. Criar SchedulingRepositoryPort e stores memory/Postgres.
3. Criar migration `0047_scheduling_editorial_calendar.sql`.
4. Implementar gerador de ocorrencias com janela limitada e idempotencia.
5. Implementar temporal queue com claim/lease/fencing.
6. Implementar conflict detector.
7. Implementar dispatcher bridge para Publication Outbox.
8. Implementar reschedule/cancel/pause/resume/missed/recovery/dead letter.
9. Integrar DI, RBAC e rotas `/v1/schedules`, `/v1/calendar`, `/v1/scheduling/*`.
10. Implementar frontend de Calendario Editorial.
11. Adicionar testes unitarios, integracao, concorrencia e restart.
12. Executar validacoes obrigatorias e criar `docs/sprint-21-final-report.md`.

## 21. Itens Fora de Escopo

- publicacao em producao;
- novos providers;
- analytics;
- billing;
- campanhas pagas;
- calendario externo;
- Google Calendar;
- Microsoft Calendar;
- geracao automatica de conteudo;
- aprovacao automatica por IA;
- rollback remoto;
- edicao remota de publicacao;
- exclusao remota de publicacao;
- secret manager de producao.

## 22. Parecer

A implementacao e viavel, mas deve substituir o agendamento simples atual por um modulo Scheduling independente. Expandir `PublicationSchedule` dentro de Publication criaria acoplamento indevido, duplicaria responsabilidades com Outbox e aumentaria o risco de publicacao duplicada em cenarios de recorrencia, restart e concorrencia.

Recomendacao: aprovar a arquitetura proposta e implementar Sprint 21 com Scheduling como source of truth para calendario editorial e ocorrencias temporais, mantendo Production bloqueada.
