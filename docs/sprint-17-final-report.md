# Sprint 17 - Relatorio Final

Status: concluida no escopo fake/dry-run. Sprint 18 nao foi iniciada.

## 1. Revisao Arquitetural

Registrada em `docs/sprint-17-architecture-review.md`. A aprovacao posterior permitiu implementar as fases funcionais mantendo a restricao: nenhum provider real, OAuth real ou secret manager real.

## 2. Provider Registry

`PublicationProviderRegistry` registra, lista, resolve, valida capabilities e expoe health por provider sem quebrar quando o provider esta desabilitado. Dispatch continua bloqueando provider desconhecido ou desabilitado via `resolve`.

## 3. Provider Descriptor

`PublicationProviderDescriptor` declara metadata operacional: versao, display name, canais, content types, suporte a idempotency/status/delete/update/scheduling/receipt verification e limites de payload/assets. O dominio nao importa SDK externo.

## 4. Credential Reference

`PublicationCredentialReference` persiste somente referencia operacional por tenant/workspace/provider/status/timestamps. Nao ha campo para token, senha, client secret, refresh token ou segredo bruto.

## 5. Secret Resolver

`PublicationSecretResolverPort`, `InMemoryPublicationSecretResolver` e `FakePublicationSecretResolver` permanecem restritos a fake/dry-run. O dispatch valida credential reference ativa quando uma referencia e informada e exige referencia para provider nao sintetico.

## 6. Durable Outbox

`PublicationOutboxMessage` e `publication_outbox` sao a fonte duravel de dispatch. A fila em memoria e apenas gatilho reconstruivel.

## 7. Atomicidade

`createAttemptWithOutbox` persiste `PublicationAttempt + PayloadReference + Outbox + Event` em transacao no Postgres. Finalizacao de outbox, falha e unknown outcome tambem foram endurecidos com transacoes locais.

## 8. Dispatch Service

`PublicationDispatchService` faz claim, valida payload/capabilities/credential reference, resolve secret, chama adapter, persiste resultado, reagenda retry, dead-letter ou cria unknown outcome com reconciliation.

## 9. Lease e Fencing Token

Claims carregam `claimedBy`, `claimedAt`, `leaseExpiresAt` e `fencingToken`. Commits validam worker, lease, token e attempt ativa. Claims Postgres usam `FOR UPDATE SKIP LOCKED`.

## 10. Provider Result

`PublicationProviderCallResult` tem variantes: `published`, `rejected`, `transient_failure`, `permanent_failure`, `authentication_failure`, `rate_limited`, `unknown_outcome`, com ids, status code, safe message, retryAfter e raw response reference.

## 11. Unknown Outcome

`unknown_outcome` nao e retryado cegamente. Outbox com `lastFailureCode = UNKNOWN_OUTCOME` nao e reclamada por `claimOutbox` nem reconstruida pela recovery queue comum.

## 12. Reconciliation

`PublicationReconciliationService` consulta `getStatus`, confirma published, marca not published ou inconclusive. Confirmacoes conclusivas usam metodos transacionais no repositorio.

## 13. Receipt Verification

`PublicationReceiptVerification` cria novo registro imutavel de verificacao (`verified`, `mismatch`, `not_supported`, `unverified`) sem alterar receipts.

## 14. Idempotencia Externa

Fake/dry-run suportam idempotency key. A semantica formal e at-least-once dispatch + deduplicacao local + reconciliacao externa; exatamente uma vez nao e prometido.

## 15. Payload Reference

Outbox referencia `PublicationPayloadReference`; payload grande nao e duplicado na mensagem. Dispatch valida checksum, target/provider, tamanho e assets antes de chamar adapter.

## 16. Provider Adapter Contract

`PublicationProviderAdapterPort` expoe `publish`, `getStatus`, `verifyReceipt`, `capabilities` e `health`. Fake e DryRun foram adaptados.

## 17. Retry Duravel

Retry duravel usa `attemptCount`, `availableAt`, `retryAfter`, `lastFailureCode` e backoff com jitter. Transient/rate limited voltam para pending; unknown outcome nao volta sem reconciliacao.

## 18. Dead Letter

Dead letter persiste outbox/publication/target/provider/failure/attempts/safe message/recovery status. Reprocessamento administrativo reabre outbox explicitamente e marca `reprocessed`.

## 19. Process Recovery

`rebuildPublicationQueueFromOutbox` libera leases expiradas e reconstrui fila em memoria a partir da outbox elegivel, excluindo unknown outcome.

## 20. Shutdown Seguro

`PublicationWorker.shutdown()` impede novos ciclos. Chamadas ja iniciadas continuam dependentes da lease e do commit fencing. Drain completo de processo real segue como divida antes de provider externo real.

## 21. Observabilidade

Metricas incluem fila, outbox pending/claimed/age, dispatch success/failure, unknown outcomes, reconciliation, mismatch, leases expiradas, fencing rejected, dead letters e credential failures. Sem payloads ou secrets.

## 22. Health e Readiness

API expõe health por provider e health operacional de Publication. Provider indisponivel aparece isoladamente; dispatch para ele continua bloqueado.

## 23. API

Endpoints administrativos disponiveis: providers, provider health, outbox, reconciliation, attempts, receipt verifications, dead-letter reprocess e reconcile. `POST /publish` agora sempre passa pela outbox; modo sync executa um worker local apos enqueue.

## 24. Frontend

Painel de Publication mostra registry, outbox, leases, fencing, attempts, unknown outcomes, reconciliation, receipt verification e dead letters, sem expor payload sensivel.

## 25. Persistencia

Migration `0043_publication_provider_reliability.sql` cria descriptors, credential references, payload references, outbox, reconciliations e receipt verifications, com indices relevantes.

## 26. Testes

Novas coberturas incluem publish sync via outbox, capabilities explicitas, unknown sem retry cego e dead-letter reprocess.

## 27. Evidencia de fluxo normal

`test:publication` cobre: publication aprovada, attempt/event/payload/outbox criados, worker faz claim, lease/fencing aplicados, fake provider chamado, receipt persistido, outbox dispatched e publication completed.

## 28. Evidencia de fencing

Teste cobre worker A perdendo lease, worker B assumindo com novo fencing token e commit tardio do worker A rejeitado.

## 29. Evidencia de unknown outcome

Teste cobre provider retornando unknown, sem retry cego, reconciliation criada, status externo confirmado, receipt criado e publication completed.

## 30. Evidencia de restart recovery

Teste cobre fila em memoria vazia, reconstruida da outbox, dispatch retomado e segunda execucao sem duplicar receipt.

## 31. Evidencia de isolamento arquitetural

`npm run architecture:check` passou, incluindo `check-publication-isolation`: Publication permanece isolado de Execution/Helena/Skills/AI/providers reais.

## 32. Riscos e Dividas Tecnicas

- Shutdown ainda nao tem drain real de chamadas externas em processo.
- Descriptors em banco existem, mas registry ainda e construido em composition root e nao sincroniza automaticamente a tabela.
- PayloadReference ainda guarda payload jsonb local; storage imutavel externo fica para sprint futura.
- Sem provider real, health/readiness de rede externa continua sintetico.

## 33. Recomendacoes para Sprint 18

Antes de qualquer provider real: implementar secret manager real, lifecycle worker/scheduler de processo, drain de shutdown, provider descriptor sync, testes Postgres concorrentes dedicados e adapter real atras de feature flag fail-closed.

## Verificacoes Executadas

- `npm run typecheck`
- `cd web && npm run typecheck`
- `npm run architecture:check`
- `npm run test:execution`
- `npm run test:publication`
- `npm test`
