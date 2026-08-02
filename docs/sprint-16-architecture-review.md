# Sprint 16 — Publication Orchestrator, Scheduling e Execução Assíncrona

Sprint 16 implementada sem alterar a arquitetura de Execution. `Execution` continua produzindo
apenas `ExecutionArtifact`; `Publication` consome artifacts por ids explícitos na borda de API/use
case e governa aprovação operacional, fila, worker, receipts e observabilidade própria.

## Arquitetura

Fluxo operacional:

`ExecutionRun -> ExecutionArtifacts -> PublicationPlan -> Approval -> Queue/Schedule -> Worker -> PublicationEngine -> Provider -> PublicationReceipt -> Completed`

`PublicationEngine` continua transacional e síncrono no nível de regra de negócio. O novo
`PublicationOrchestrator` coordena scheduling, fila, recovery e worker sem mover regra de negócio
para o worker.

## Pontos Síncronos

- criação do `PublicationPlan`;
- aprovação operacional;
- publicação direta via `POST /v1/publications/:id/publish`;
- persistência de attempts, receipts, events e failures;
- validação de policy, approval, idempotência e provider.

## Pontos Assíncronos

- enqueue explícito por `publish async`;
- schedules vencidos encaminhados para fila;
- worker consome jobs da fila;
- recovery reenfileira publicações interrompidas ou cria dead letter;
- retry automático permanece governado pelo engine.

## Riscos De Concorrência Tratados

- lock por `publicationId` impede dois workers na mesma publicação;
- receipts usam idempotência por `publicationId + targetId + provider + idempotencyKey`;
- workers ignoram jobs de publicações já `published` ou `cancelled`;
- filas em memória deduplicam jobs pelo id;
- optimistic locking existe no plano via `version`.

## Pontos De Recuperação

- publicações em `publishing` podem ser reenfileiradas;
- publicações `failed` com última falha retentável podem ser reenfileiradas;
- falhas não retentáveis ou limite excedido geram `PublicationDeadLetter`;
- dead letters não são descartadas automaticamente.

## Riscos De Publicação Duplicada

Duplicação é controlada em três camadas:

1. `PublicationLock` antes de executar o job.
2. `PublicationReceipt` append-only com chave lógica de idempotência.
3. Provider sintético mantém idempotência interna por chave.

## Dependências Externas

Nenhuma dependência externa foi integrada. A Sprint 16 usa apenas:

- `DryRunPublicationProvider`;
- `FakePublicationProvider`;
- `InMemoryPublicationQueue`;
- `PostgresPublicationRepository` para persistência quando o driver é Postgres.

Não há Redis, Kafka, RabbitMQ, SDK social, Meta, scheduling real externo, analytics, rollback ou
compensação distribuída.

## API Operacional

Endpoints básicos de Publication:

- `GET /v1/publications`
- `GET /v1/publications/:id`
- `POST /v1/publications`
- `POST /v1/publications/:id/approve`
- `POST /v1/publications/:id/publish`
- `POST /v1/publications/:id/cancel`
- `GET /v1/publications/:id/receipts`

Endpoints operacionais:

- `GET /v1/publications/schedules`
- `GET /v1/publications/queue`
- `GET /v1/publications/dead-letters`
- `GET /v1/publications/health`
- `GET /v1/publications/metrics`
- `POST /v1/publications/:id/retry`
- `POST /v1/publications/:id/reschedule`
- `POST /v1/publications/operate/run-due`
- `POST /v1/publications/operate/work`
- `POST /v1/publications/operate/recover`

## RBAC

- `publication:read`: viewer, editor, admin, owner.
- `publication:create`: editor, admin, owner.
- `publication:approve`: admin, owner.
- `publication:publish`: admin, owner.
- `publication:cancel`: admin, owner.

## Observabilidade

Eventos fechados registram criação, aprovação, início, conclusão, falha, receipt, retry,
cancelamento, schedule, enqueue, worker, recovery, dead letter e lock contention.

Métricas separadas de Execution:

- queue size;
- queue latency;
- worker utilization;
- publication throughput;
- dead letters;
- recoveries;
- scheduler delay;
- lock contention.

## Isolamento

Guarda arquitetural dedicada valida:

- domínio Publication não importa Execution;
- application Publication não importa Helena, Skills, AI Gateway, SDKs externos ou provider real;
- Execution não importa Publication;
- providers reais não entram no caminho da Sprint 16.

## Dívidas

- fila e worker ainda são in-process;
- limites por provider/tenant estão modelados na policy de concorrência, mas não há scheduler
  distribuído;
- `FutureQueueAdapter` é contrato, não implementação;
- não há publicação real nem reconciliação externa;
- rollback real permanece fora de escopo.

## Recomendações Para Sprint 17

1. Persistir fila operacional ou integrar adapter externo opcional.
2. Implementar leases/heartbeats de worker.
3. Materializar métricas em tabela ou backend de telemetry.
4. Adicionar reconciliação externa de receipts.
5. Introduzir providers reais atrás de feature flags e allowlist por tenant.
6. Manter Publication independente de Execution e Skills.
