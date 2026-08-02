# Sprint 17 - Revisao Arquitetural de Publication

Status: aprovada pelo usuario e usada como base para a implementacao da Sprint 17.

Esta revisao atende a Fase 1 do Prompt 17. Nenhuma integracao real com redes sociais, OAuth real, secret manager real, Redis, Kafka ou fila externa deve ser iniciada nesta sprint sem aprovacao explicita.

## Escopo Revisado

Arquivos e componentes revisados:

- `src/domain/publication/publication.model.ts`
- `src/application/publication/publication-engine.ts`
- `src/application/publication/publication-orchestrator.ts`
- `src/application/publication/publication-dispatch-service.ts`
- `src/application/publication/publication-outbox-intent.ts`
- `src/application/publication/publication-provider-registry.ts`
- `src/application/publication/publication-provider-adapter.port.ts`
- `src/application/publication/publication-provider.port.ts`
- `src/application/publication/publication-reconciliation-service.ts`
- `src/application/publication/publication-secret-resolver.ts`
- `src/application/publication/publication-queue.ts`
- `src/application/publication/publication-observability.ts`
- `src/application/ports/publication-repository.port.ts`
- `src/infrastructure/storage/in-memory-publication-repository.ts`
- `src/infrastructure/storage/postgres/postgres-publication-repository.ts`
- `src/interfaces/api/routes/v1/publications.route.ts`
- `db/migrations/0042_publication_domain.sql`
- `db/migrations/0043_publication_provider_reliability.sql`
- `tests/publication-engine.test.mjs`
- `tests/publication-api.test.mjs`
- `tests/publication-reliability.test.mjs`
- `scripts/check-publication-isolation.mjs`

## Leitura Arquitetural Atual

Publication ja tem um esqueleto relevante para confiabilidade: estados de `unknown_outcome`, descriptors de provider, referencias de credenciais, outbox, payload references, reconciliations, receipt verifications, fencing token e dead letters aparecem no dominio e na persistencia.

Tambem ja existe um caminho novo de dispatch: `ensurePublicationOutboxIntents` cria tentativa, evento, payload reference e outbox; `PublicationWorker` chama `PublicationDispatchService`; o dispatch faz claim, resolve provider/secret, chama adapter sintetico, grava resultado e encaminha unknown outcome para reconciliacao.

O ponto arquitetural mais sensivel e que ainda convivem dois caminhos de publicacao:

- caminho antigo: `publishPublication` chama diretamente `PublicationProviderPort`;
- caminho novo: outbox duravel + `PublicationProviderAdapterPort` + `PublicationDispatchService`.

Antes de providers reais, o caminho antigo precisa ser removido do fluxo de escrita externa ou bloqueado para modo real. Caso contrario, a API pode publicar sem outbox, sem lease/fencing, sem credential reference, sem unknown outcome formal e sem reconciliacao.

## Riscos de Perda de Jobs

- A fila em memoria (`PublicationQueuePort`) ainda existe como gatilho operacional. A outbox e duravel, mas a reconstrucao via `rebuildPublicationQueueFromOutbox` depende de chamada explicita; nao foi identificado hook de startup que garanta reconstrucao automatica.
- `PublicationWorker.runUntilIdle` depende de haver job na fila em memoria; mensagens `pending` na outbox nao sao necessariamente reclamadas se nenhum job foi reconstruido.
- `releaseExpiredOutbox` libera claims expirados, mas tambem depende de execucao explicita.
- Schedules vencidos dependem de `runDueSchedules`; nao ha evidencia de scheduler persistente com ciclo de vida completo integrado a startup/shutdown.

Conclusao: a outbox reduz perda duravel, mas o sistema ainda pode ficar parado apos restart se a rotina de recovery nao for acionada de forma confiavel.

## Riscos de Duplicacao

- O caminho sincrono `publishPublication` cria attempts e chama provider direto, fora da outbox. Isso permite duplicacao logica em relacao ao caminho async se ambos forem usados para a mesma publication.
- A deduplicacao local por receipt usa `(publicationId, targetId, provider, idempotencyKey)`, o que e bom, mas nao garante exatamente uma vez no provider quando o provider nao suporta idempotency key.
- O claim Postgres nao usa `FOR UPDATE SKIP LOCKED`; a atualizacao com subquery pode funcionar sob contencao simples, mas deve ser testada com concorrencia real para evitar claims duplicados ou bloqueios longos.
- Dead letter reprocess apenas reenfileira a publication; nao ha mudanca formal de `recoveryStatus` nem nova geracao/recriacao controlada de outbox para o item dead-lettered.

Conclusao: a semantica correta deve ser formalizada como at-least-once dispatch + deduplicacao local + reconciliacao externa. Exatamente uma vez nao deve ser prometido.

## Commits Tardios e Fencing

Pontos positivos:

- `PublicationOutboxMessage` tem `claimedBy`, `claimedAt`, `leaseExpiresAt` e `fencingToken`.
- `claimOutbox` incrementa `fencingToken`.
- `completeOutbox`, `failOutbox` e `markOutboxUnknown` validam worker, fencing token e lease antes de aceitar commit.
- Testes em memoria cobrem o caso em que worker A perde lease, worker B assume e o commit tardio de A e rejeitado.

Lacunas:

- Os commits de sucesso em Postgres nao sao uma transacao unica. `completeOutbox` atualiza outbox, depois cria receipt, finaliza attempt, atualiza target e possivelmente publication em chamadas separadas.
- Se o processo cair apos marcar outbox como `dispatched` e antes de criar receipt/atualizar attempt, o banco pode ficar inconsistente.
- Se o provider confirmou sucesso e a persistencia local falhou apos a chamada externa, o dispatch atual nao transforma automaticamente esse caso em `unknown_outcome`.
- A validacao de "attempt ainda ativa" nao esta explicita no commit; a verificacao atual se limita ao claim da outbox.

Conclusao: fencing existe, mas a unidade de commit local apos provider precisa ser transacional e precisa cobrir falha de persistencia depois de sucesso externo.

## Inconsistencia Entre Provider e Banco

Cenario critico: provider publica com sucesso, mas o banco falha antes de receipt/attempt/target/publication serem persistidos. Hoje ha risco de:

- outbox `dispatched` sem receipt;
- attempt `running` apos sucesso externo;
- target ainda `publishing`/`pending`;
- publication nao finalizada;
- reconciliacao nao criada automaticamente para recuperar o sucesso externo.

Antes de provider real, o commit de resultado externo deve ser uma operacao atomica no repositorio ou uma saga local que primeiro registra resultado externo seguro e, em caso de erro, marca `unknown_outcome` de forma duravel.

## Estado Externo Desconhecido

Pontos positivos:

- `unknown_outcome` existe como estado de publication e target.
- `PublicationProviderCallResult` possui variante `unknown_outcome`.
- `PublicationDispatchService` nao faz retry cego para `unknown_outcome`; ele chama `markOutboxUnknown` e cria `PublicationReconciliation`.
- `PublicationReconciliationService` consulta `getStatus` no adapter e cria receipt quando status publicado e confirmado.

Lacunas:

- `markOutboxUnknown` marca outbox como `failed`. Isso exige cuidado para que recovery/rebuild nao trate a mensagem como retry automatico.
- Reconciliacao confirmada atualiza publication para `published` sem verificar se todos os targets foram publicados. Isso e aceitavel para sprint sem multi-provider simultaneo, mas perigoso se multiplos targets/canais existirem.
- Status `confirmed_not_published` nao atualiza attempt/target/publication para falha comprovada.
- `providerRequestId` fica na reconciliation, mas nao ha campo correspondente no receipt para preservar request id confirmado.

Conclusao: o conceito existe, mas a maquina de estados de reconciliacao ainda precisa ficar mais estrita antes de trafego real.

## Provider Registry e Capabilities

Pontos positivos:

- `PublicationProviderRegistry` registra, lista, resolve e bloqueia provider desconhecido/desabilitado.
- Descriptor declara canais, content types, idempotency, status lookup, delete, update, scheduling, receipt verification, tamanho maximo e quantidade maxima de assets.
- Fake e DryRun implementam descriptor operacional e health.

Lacunas:

- O dominio ainda tipa providers reais como literais permitidos (`instagram`, `facebook`, `linkedin`, `x`), embora nao existam adapters reais. Isso e aceitavel como metadata, mas deve ser bloqueado por registry/policy em runtime.
- Descriptors em banco existem na migration, mas nao foi identificado fluxo de persistencia/sincronizacao do registry para `publication_provider_descriptors`.
- Health do provider existe, mas readiness global ainda e superficial.

Conclusao: registry e descriptor estao bem encaminhados para sprint de fake/dry-run, mas ainda nao devem ser usados como garantia de readiness real.

## Credential Reference e Secrets

Pontos positivos:

- `PublicationCredentialReference` contem apenas ids, tenant, workspace, provider, status e timestamps.
- Migration nao cria colunas para token, refresh token, client secret, senha, chave privada ou segredo bruto.
- `PublicationSecretResolverPort` isola resolucao de segredo na camada de adapter.

Lacunas:

- `InMemoryPublicationSecretResolver.resolve` devolve segredo fake mesmo sem credential reference. Isso e aceitavel para fake/dry-run, mas deve ser bloqueado para qualquer provider real.
- Nao ha validacao forte de status `active/disabled/revoked` no dispatch; o dispatch apenas chama resolver com `credentialReferenceId` opcional.
- Falta politica explicita de sanitizacao de logs/traces/events para garantir ausencia de secrets. Os eventos atuais registram safe messages e ids, mas isso deve virar teste de contrato.

Conclusao: modelo de referencia esta correto, mas o resolver fake nao pode virar default para modo real.

## Durable Outbox e Atomicidade

Pontos positivos:

- `PublicationOutboxMessage` contem os campos minimos pedidos.
- `createAttemptWithOutbox` em Postgres usa transacao para attempt + payload reference + outbox + event.
- Migration cria indices por status/available_at, lease, publication, provider, idempotency e fencing.

Lacunas:

- `PublicationPayloadReference` ainda persiste `payload jsonb` e `assets jsonb`; isso evita duplicar payload na outbox, mas nao e uma referencia externa/imutavel verdadeira.
- Validacao de tenant/workspace/publication/target/versao/integridade/tamanho ocorre parcialmente via checksum e tamanho; nao ha validacao completa de assets imutaveis.
- A transacao atomica existe para criacao de outbox, mas nao para finalizacao de dispatch/reconciliation.

Conclusao: a criacao atomica esta coberta, mas o ciclo completo ainda nao e transacional.

## Recovery e Shutdown Seguro

Pontos positivos:

- Existe `PublicationRecoveryService`.
- Existe `rebuildPublicationQueueFromOutbox`.
- Existe `PublicationWorker.shutdown`, que impede novos `runOnce`.

Lacunas:

- Startup recovery nao parece conectado ao servidor/API.
- Shutdown nao drena dispatches ativos; apenas seta flag para proximos ciclos.
- Nao ha estado explicito de "stop claiming new outbox messages".
- Nao ha protecao para chamada externa ja iniciada: se o processo for encerrado durante `provider.publish`, o sistema depende da lease expirar e pode retryar sem antes marcar unknown outcome.

Conclusao: recovery/shutdown ainda estao incompletos para provider real.

## Health, Readiness e Observabilidade

Pontos positivos:

- Metricas incluem pending/claimed, success/failure, unknown outcomes, reconciliations, mismatch, lease expired, fencing rejected, dead letters e credential failures.
- API expõe health de provider e health/metrics de publication.

Lacunas:

- `collectPublicationHealth` retorna banco/outbox/scheduler/workers como ready sem executar checks reais.
- Um provider desabilitado pode quebrar health se `resolve` for usado para health de descriptor desabilitado.
- Readiness nao valida migrations, conexao Postgres, capacidade de claim, scheduler ativo, worker ativo nem reconciliation service ativo.
- Metricas sao derivadas de eventos/estado em consulta, nao de instrumentacao operacional de latencia por dispatch.

Conclusao: observabilidade esta no vocabulario correto, mas readiness ainda e mock/superficial.

## API Administrativa

Coberto:

- `GET /v1/publication-providers`
- `GET /v1/publication-providers/:providerId/health`
- `GET /v1/publications/outbox`
- `GET /v1/publications/reconciliation`
- `GET /v1/publications/:id/attempts`
- `GET /v1/publications/:id/receipt-verifications`
- `POST /v1/publications/dead-letters/:id/reprocess`
- `POST /v1/publications/:id/reconcile`

Riscos:

- `POST /v1/publications/:id/publish` ainda aceita modo sincrono sem outbox quando `async` nao e true.
- `GET /v1/publications/queue` expõe fila em memoria, nao a fonte autoritativa.
- Reprocess de dead letter reenfileira, mas nao muda estado de recovery nem garante elegibilidade da outbox.
- Endpoints de health/metrics/readiness nao devem expor payloads ou secrets; ate aqui nao foi visto segredo, mas falta teste dedicado de resposta HTTP.

## Frontend

Nao foi revisado painel operacional no `web` nesta Fase 1. Pelo estado observado, a parte backend/API tem superficies administrativas, mas nao ha evidencia nesta revisao de uma UI operacional completa para provider registry, provider health, outbox, leases, fencing token, attempts, unknown outcomes, reconciliation, receipt verification e dead letters.

## Isolamento Arquitetural

Ponto positivo:

- O script `check-publication-isolation.mjs` bloqueia imports de Execution em Publication e marcadores proibidos como Skills, AI Gateway, SDK Anthropic, fetch e providers reais legados.

Lacunas:

- O script verifica marcadores textuais; ele nao prova que todos os caminhos de API usam outbox duravel.
- `PublicationEngine` ainda depende de `PublicationProviderPort`, um contrato legado de publish direto.

Conclusao: o isolamento de modulo esta bom, mas o isolamento de fluxo de side effect ainda precisa ser endurecido.

## Gate de Aprovacao

Minha recomendacao para a Fase 1:

- Aprovado para continuar apenas com implementacao fake/dry-run da Sprint 17.
- Nao aprovado para provider externo real.
- Antes de seguir para codigo funcional, a implementacao deve aceitar como diretriz obrigatoria: todo publish operacional passa por outbox duravel; o caminho sincrono direto fica restrito a legado/dry-run ou removido; commits pos-provider viram transacao local; startup recovery e shutdown seguro entram no ciclo de vida da aplicacao.

## Bloqueios Antes de Provider Real

1. Remover/bloquear publish sincrono direto para qualquer modo real.
2. Tornar `completeOutbox`, `failOutbox`, `markOutboxUnknown` e reconciliacao confirmada transacionais em Postgres.
3. Garantir que falha de persistencia apos sucesso externo gere estado recuperavel (`unknown_outcome`) ou registro duravel equivalente.
4. Integrar startup recovery e release de leases expiradas ao bootstrap da aplicacao.
5. Implementar shutdown com drain de dispatches ativos.
6. Validar credential reference ativa antes de resolver segredo.
7. Proibir segredo fake/default para provider real.
8. Formalizar retry: nunca retryar `unknown_outcome` sem reconciliacao conclusiva.
9. Persistir/sincronizar descriptors do registry ou remover tabela se ela nao for fonte operacional.
10. Adicionar testes Postgres de concorrencia/fencing/atomicidade, nao apenas testes em memoria.

## Decisao Requerida

Para prosseguir para as Fases 2-26, e necessaria aprovacao explicita aceitando o escopo acima e confirmando que a Sprint 17 continua limitada a fake/dry-run, sem provider real.
