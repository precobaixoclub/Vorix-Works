# Sprint 21 - Relatorio Final

Data: 2026-07-30

Status: implementado e validado em ambiente local. Publicacao em production permanece bloqueada. Sprint 22 nao foi iniciada.

## 1. Resumo executivo

A Sprint 21 criou um dominio independente de Scheduling para agenda editorial, recorrencia, fila temporal duravel, calendario operacional e despacho controlado para o fluxo existente de Publication/Outbox.

O agendamento deixou de depender do modelo simples legado de `PublicationPlan.scheduledAt` como unica fonte operacional. A nova camada materializa ocorrencias, controla claim/lease/fencing, detecta conflitos, lida com ocorrencias perdidas, gera dead letters e so entra em Publication por uma bridge explicita.

## 2. Revisao arquitetural

A revisao previa esta registrada em `docs/sprint-21-architecture-review.md`.

Decisao central: Scheduling e um bounded context proprio. Ele nao chama providers diretamente, nao cria receipts e nao reimplementa outbox. A integracao com publicacao passa por `ScheduledPublicationDispatcherPort`, que reusa governanca, credenciais, provider health, outbox e worker de Publication.

## 3. Scheduling Domain

Modelo criado em `src/domain/scheduling/scheduling.model.ts`.

Principais entidades:

- `PublicationSchedule`
- `ScheduleRule`
- `ScheduleOccurrence`
- `ScheduleConflict`
- `ScheduleDeadLetter`
- `ScheduleEvent`
- `CalendarEntry`
- metricas e health de scheduling

O dominio inclui tenant/workspace isolation, provider/target binding, timezone IANA, recorrencia, historico e referencias de auditoria/execucao.

## 4. Estados e invariantes

Estados de schedule:

- `draft`
- `scheduled`
- `paused`
- `due`
- `dispatching`
- `completed`
- `cancelled`
- `expired`
- `failed`

Estados de occurrence:

- `pending`
- `claimed`
- `dispatched`
- `completed`
- `cancelled`
- `missed`
- `failed`
- `dead_lettered`

Invariantes principais:

- ocorrencia cancelada, completada, missed ou dead-lettered nao e publicada automaticamente;
- claim exige ocorrencia pendente e sem conflito bloqueante;
- claim recebe lease e fencing token;
- complete/fail validam fencing token;
- agenda pausada nao gera claim;
- dispatch revalida Publication, target, approval/governance, credencial e provider health antes de entrar no Outbox.

## 5. Agendamento unico

Schedules `once` geram uma unica occurrence com chave idempotente estavel. A geracao permite materializar ocorrencias ja devidas quando ainda estao dentro da janela operacional, evitando perda no primeiro processamento.

## 6. Recorrencia

O gerador suporta:

- `daily`
- `weekly`
- `monthly`
- `custom_interval`

As regras incluem limite por contagem, limite por data final, dias da semana, dia do mes, intervalo customizado e janela maxima de materializacao.

## 7. Geracao de ocorrencias

`ScheduleOccurrenceGenerator` materializa ocorrencias de forma limitada por janela e quantidade maxima. Cada occurrence recebe:

- `id` deterministico
- `idempotencyKey`
- horario local planejado
- horario UTC calculado
- numero sequencial

Isso permite reprocessar a geracao sem duplicar ocorrencias.

## 8. Temporal Queue

`TemporalQueue` e `TemporalDispatcher` selecionam ocorrencias vencidas e aptas para despacho. A fila temporal usa o repositorio de Scheduling como fonte duravel e nao depende de timers em memoria para garantir execucao.

## 9. Claim, Lease e Fencing

O repositorio in-memory simula claim atomico. O repositorio Postgres usa `FOR UPDATE SKIP LOCKED` em `claimDueOccurrences`, com lease e fencing token por occurrence.

Isso evita que dois workers despachem a mesma occurrence e impede que um worker com lease antigo finalize uma execucao que ja foi reclamada por outro.

## 10. Publication Bridge

`SchedulingPublicationDispatcher` e a unica ponte para Publication.

Ele:

- carrega o detalhe da publicacao;
- valida target e provider;
- respeita policy de production bloqueada/fallback dry-run;
- resolve credencial quando exigida;
- reusa `PublicationGovernancePolicy`;
- consulta health do provider;
- garante intents no Outbox;
- enfileira e executa Publication Worker para sandbox;
- retorna referencias de execucao para Scheduling.

## 11. Idempotencia

Idempotencia foi aplicada em duas camadas:

- geracao de occurrences por id/chave deterministica;
- dispatch por idempotency key herdada da occurrence e registrada no fluxo de Publication/Outbox.

Reprocessamento de dead letter reseta a occurrence sem criar uma nova occurrence paralela.

## 12. Reagendamento

API e use case permitem reagendar uma occurrence pendente/missed/failed/dead-lettered. O reagendamento registra evento append-only e recalcula o horario UTC a partir do timezone da schedule.

## 13. Cancelamento

Cancelamento existe em dois niveis:

- schedule inteiro, cancelando ocorrencias pendentes;
- occurrence individual, sem afetar a regra recorrente.

Ambos registram auditoria/evento de scheduling.

## 14. Pausa e retomada

Schedules podem ser pausadas e retomadas por API. Uma agenda pausada deixa de ser elegivel para claim temporal, mas preserva suas occurrences e historico.

## 15. Missed Occurrence Policy

O modelo suporta politicas:

- `skip`
- `dispatch_immediately`
- `reschedule_next_window`
- `manual_review`

A operacao local implementa o comportamento defensivo padrao: occurrences vencidas alem do grace period sao marcadas como `missed` com revisao manual, impedindo publicacao automatica tardia. `skip` tambem e suportado pelo recovery; as politicas de despacho imediato e proxima janela estao modeladas para evolucao controlada.

## 16. Conflitos

`ScheduleConflictDetector` identifica:

- conflito bloqueante no mesmo target/provider dentro da janela configurada;
- aviso para mesmo provider em janela proxima;
- aviso para mesma campanha;
- aviso para conteudo duplicado;
- bloqueio quando provider externo exige credencial e o target nao tem referencia de credencial.

Claims ignoram occurrences com conflito bloqueante.

## 17. Timezone e DST

Timezone IANA e validado por `Intl.DateTimeFormat`.

A conversao local/UTC fica em `src/application/scheduling/timezone.ts`, com testes cobrindo America/New_York no dia de transicao DST de 2026-03-08 e America/Sao_Paulo no fluxo de API.

## 18. Clock Abstraction

`ClockPort` foi criado com:

- `SystemClock`
- `FixedClock`
- `MutableTestClock`

Os use cases e workers de scheduling usam clock injetavel para evitar dependencia direta de tempo real nos testes criticos.

## 19. Recovery

`SchedulingRecoveryService` libera leases expirados e marca occurrences pendentes antigas como missed, conforme janela de grace configurada.

O objetivo e recuperar restart/crash sem disparar publicacoes atrasadas sem revisao.

## 20. Dead Letter

Falhas nao retryable no dispatcher criam `ScheduleDeadLetter`, registram evento e colocam a occurrence em `dead_lettered`.

A API operacional permite listar dead letters e reprocessar, voltando a occurrence para `pending`.

## 21. Governance

Antes de despachar, a bridge reusa a governanca de Publication:

- approval state;
- production block;
- provider policy;
- provider health;
- credential status;
- audit de negacao.

Scheduling nao bypassa regras ja existentes de publicacao.

## 22. Credential Validation

Para providers externos, a bridge exige credencial valida quando o target declara `credentialReference`. Credencial ausente, revogada ou expirada bloqueia o dispatch e gera auditoria.

## 23. Provider Health

O health do provider e consultado antes do dispatch. Provider indisponivel retorna falha retryable, mantendo a occurrence elegivel para nova tentativa conforme lease/recovery.

## 24. API

Rotas adicionadas em `src/interfaces/api/routes/v1/scheduling.route.ts`:

- `GET /v1/schedules`
- `POST /v1/schedules`
- `GET /v1/schedules/:id`
- `PATCH /v1/schedules/:id`
- `POST /v1/schedules/:id/pause`
- `POST /v1/schedules/:id/resume`
- `POST /v1/schedules/:id/cancel`
- `POST /v1/schedules/:id/reschedule`
- `GET /v1/schedules/:id/occurrences`
- `POST /v1/schedule-occurrences/:id/cancel`
- `POST /v1/schedule-occurrences/:id/reprocess`
- `GET /v1/calendar`
- `GET /v1/scheduling/health`
- `GET /v1/scheduling/dead-letters`
- `POST /v1/scheduling/dead-letters/:id/reprocess`
- `POST /v1/scheduling/operate/run-due`
- `POST /v1/scheduling/operate/recover`

## 25. RBAC

Permissoes adicionadas ao modelo de identidade:

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

Viewer recebe leitura de schedule/calendar; editor recebe leitura/criacao/atualizacao; admin e owner recebem operacao completa.

## 26. Auditoria

Scheduling registra eventos append-only em `scheduling_schedule_events` e usa referencias de audit para actions relevantes:

- schedule criado/alterado;
- pause/resume/cancel;
- occurrence rescheduled/cancelled/reprocessed;
- dispatch;
- policy denied;
- credential invalid;
- dead letter.

## 27. Observabilidade

Metricas de scheduling incluem:

- total de schedules;
- occurrences por estado;
- due count;
- late count;
- active leases;
- expired leases;
- dead letters abertas;
- conflitos bloqueantes.

## 28. Health

`SchedulingHealthService` avalia:

- repositorio/database;
- atraso da fila temporal;
- leases;
- bridge para outbox/publication;
- dead letters;
- clock drift.

O endpoint retorna estado `healthy`, `degraded` ou `unhealthy`.

## 29. Persistencia

Migration criada em `db/migrations/0047_scheduling_editorial_calendar.sql`.

Tabelas:

- `scheduling_publication_schedules`
- `scheduling_schedule_rules`
- `scheduling_schedule_occurrences`
- `scheduling_schedule_conflicts`
- `scheduling_schedule_claims`
- `scheduling_schedule_dead_letters`
- `scheduling_schedule_events`

Tambem foram criados indices e constraints para tenant/workspace, due time, status, provider/target, idempotencia e claim operacional.

## 30. Frontend

O calendario em `web/app/workspaces/[workspaceId]/calendar/page.tsx` foi conectado as novas APIs.

Funcionalidades expostas:

- mes, semana e dia;
- filtros por provider e status;
- criacao de schedule;
- recorrencia basica;
- pause/resume/cancel;
- reagendamento;
- run due;
- recovery;
- health;
- dead letters e reprocessamento.

## 31. Testes unitarios

`tests/scheduling.test.mjs` cobre geracao recorrente, timezone/DST, claim/lease/fencing/idempotencia, conflito bloqueante e dead letter.

## 32. Testes de integracao

O fluxo integrado cria credencial/provider sandbox, publica em LinkedIn sandbox, agenda uma occurrence em America/Sao_Paulo, roda due dispatch, entra em Publication Outbox, registra receipt, sincroniza webhook assinado, valida auditoria, calendario e health.

## 33. Testes de concorrencia

O teste de claim valida que a mesma occurrence nao e reclamada duas vezes e que fencing token antigo nao finaliza uma occurrence ja protegida por outro claim.

## 34. Testes de restart

O recovery foi testado com occurrence antiga pendente: ela vira `missed` e `run-due` nao publica automaticamente.

## 35. Evidencias operacionais

Validacoes executadas:

- `npm run typecheck` - passou
- `npm run test:scheduling` - 6 testes passaram
- `npm run test:publication` - 30 testes passaram
- `npm run architecture:check` - passou
- `cd web && npm run typecheck` - passou
- `cd web && npm test` - 11 testes passaram
- `npm run test:persistence` - 48 testes passaram
- `npm test` - 1739 testes passaram

## 36. Riscos residuais

Production continua bloqueado por design.

As politicas `dispatch_immediately` e `reschedule_next_window` estao modeladas, mas o comportamento operacional padrao validado e conservador: missed antigo exige revisao/manual ou recovery controlado. Antes de liberar producao, essas politicas devem receber testes dedicados e criterios de negocio por canal.

## 37. Dividas tecnicas

Dividas restantes:

- definir SLAs reais por provider/canal para janela de conflito;
- adicionar job scheduler externo/cron para chamar `run-due` e `recover`;
- expandir testes de carga para alto volume de occurrences recorrentes;
- adicionar dashboards persistentes para metricas historicas;
- documentar runbooks de dead letter por provider.

## 38. Recomendacoes para Sprint 22

Recomendacoes:

- implementar scheduler operacional externo com heartbeat e alertas;
- ampliar policies de missed occurrence por canal;
- adicionar canary de Scheduling por workspace/provider;
- criar dashboards de SLO para atraso, dead letters, lease expirado e provider health;
- preparar criterios de readiness antes de qualquer desbloqueio de production.
