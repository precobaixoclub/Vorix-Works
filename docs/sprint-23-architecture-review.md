# Sprint 23 - Revisao Arquitetural

Data: 2026-07-30

Status: aguardando aprovacao antes de implementar codigo funcional.

## 1. Objetivo

Preparar o Zuno para um release candidate local de producao sem ativar producao real, sem abrir novos providers e sem adicionar funcionalidades editoriais.

A Sprint 23 deve endurecer a plataforma existente em seguranca, resiliencia, observabilidade, performance e operacao. O resultado esperado e uma base tecnicamente pronta para canario controlado futuro, mantendo `PUBLICATION_PRODUCTION_ENABLED=false` como comportamento seguro.

## 2. Escopo Confirmado

Entram na Sprint 23:

- Secret Manager por abstracao;
- Production Guard e bloqueios fail-closed;
- circuit breakers persistentes;
- rate limit global;
- backpressure para filas e workers;
- cache controlado;
- healthchecks, readiness e liveness;
- revisao de performance e indices;
- testes de carga e failover;
- plano de backup e restore;
- logging estruturado e mascaramento;
- revisao de seguranca;
- SLI, SLO e error budget;
- API e painel operacional administrativos;
- documentacao operacional e relatorio final.

Ficam fora:

- provider novo;
- provider real em producao;
- automacao externa de deploy;
- BI externo/data warehouse;
- novas features editoriais;
- mudancas de produto no calendario, analytics ou publicacao.

## 3. Arquitetura Atual Relevante

Publication possui outbox, retries, dead letters, reconciliation, health e provider registry. O endpoint `/v1/publications/health` ja agrega repository, queue, providers e secret resolver.

Scheduling possui fila temporal, lease/fencing, recover, dead letters e health. O endpoint `/v1/scheduling/health` ja existe por workspace.

Analytics possui eventos append-only, snapshots reconstruiveis, data quality, insights, alerts, exports e health. O endpoint `/v1/analytics/health` ja existe por workspace.

Credential/Governance possui auditoria, compliance, bindings e verificacoes de escopo. A resolucao de segredo ainda usa `LocalPublicationSecretStore`, que guarda segredo em memoria.

API possui `loadApiConfig`, `buildApiContainer`, RBAC por permissao e `/health` superficial. A composicao atual e o ponto correto para injetar novas portas operacionais.

Persistencia PostgreSQL ja existe para dominios principais, incluindo migrations ate `0048_analytics_domain.sql`.

## 4. Gargalos e Riscos de Producao

### 4.1 Segredos

Risco: `LocalPublicationSecretStore` e aceitavel para sandbox/teste, mas nao e aceitavel para ambiente production-like porque perde dados em restart e mantem segredos diretamente no processo.

Decisao proposta:

- criar `SecretManagerPort` generico em application;
- manter `PublicationSecretStoragePort` como contrato de dominio de publicacao;
- criar adapter `SecretManagerPublicationSecretStore`;
- manter `LocalPublicationSecretStore` apenas para dev/test/sandbox;
- criar `ProductionSecretManager` fail-closed quando nao configurado;
- nunca retornar valor de segredo por API, log ou auditoria.

### 4.2 Production Guard

Risco: hoje existem flags separadas para provider environment, production enabled, canary e real execution. Elas bloqueiam cenarios relevantes, mas ainda nao existe uma politica operacional unica que explique por que um side effect externo foi permitido ou negado.

Decisao proposta:

- criar `EnvironmentPolicy` central;
- criar `ProductionGuard` para qualquer side effect externo;
- criar `ReleaseGate` com resultado auditavel;
- manter producao bloqueada por padrao;
- exigir aprovacao explicita, tenant/workspace canary, provider permitido e segredo production-ready antes de qualquer chamada real futura.

### 4.3 Circuit Breakers

Risco: `InMemoryHandlerCircuitBreaker` protege execucao no processo atual, mas perde estado em restart e nao cobre publication providers de forma persistente.

Decisao proposta:

- criar porta persistente de circuit breaker;
- persistir estado por tenant/workspace/provider/capability ou route group;
- estados: `closed`, `open`, `half_open`;
- abrir circuito para timeout, provider unavailable, rate limited e authentication;
- bloquear dispatch enquanto `open`;
- registrar recovery apos sucesso em `half_open`;
- expor leitura administrativa segura.

### 4.4 Filas e Workers

Risco: `InMemoryPublicationQueue` e adequada para testes, mas perde jobs em restart. A durabilidade real hoje vem do outbox, nao da queue em memoria.

Decisao proposta:

- tratar queue em memoria como acelerador local, nao fonte de verdade;
- usar outbox/occurrences como fonte duravel;
- adicionar backpressure antes de claims/dispatch quando backlog, latencia ou dead letters ultrapassarem limite;
- limitar concorrencia por tenant, provider e worker;
- garantir que restart de worker recupere pelo repository sem duplicar publicacao.

### 4.5 Health Superficial

Risco: `/health` retorna apenas `ok`, sem diferenciar processo vivo de prontidao para receber trafego.

Decisao proposta:

- manter `/health` como endpoint simples;
- adicionar `/livez` para processo vivo;
- adicionar `/readyz` para dependencias obrigatorias;
- adicionar `/v1/system/health` administrativo com detalhe por subsistema;
- readiness deve falhar se database obrigatorio, secret manager, migrations ou dependencias criticas nao estiverem prontos.

### 4.6 Crescimento de Dados

Risco: Analytics, outbox, provider events, audit logs, scheduling occurrences e dead letters podem crescer indefinidamente.

Decisao proposta:

- validar indices em tabelas criticas;
- definir retencao por tipo de dado;
- paginar endpoints administrativos;
- limitar janelas de consulta;
- evitar `list` sem limite em rotas de operacao;
- adicionar testes de volume local para 10k e, quando pratico, 100k eventos.

## 5. Single Points of Failure

SPOFs atuais ou potenciais:

- database PostgreSQL;
- secret store local em memoria;
- queue em memoria;
- processo unico de worker;
- provider externo;
- analytics snapshots sem job externo;
- logs apenas locais/console.

Mitigacoes propostas:

- secret manager abstrato e health-checkado;
- repository como fonte de recuperacao de filas;
- circuit breaker persistente;
- backpressure e rate limit antes de saturar provider/database;
- runbook de restart/recovery;
- backup/restore documentado e testado localmente;
- logs estruturados com correlation id.

## 6. Locks, Concorrencia e Idempotencia

Publication deve preservar idempotencia por outbox intent, publication id, attempt id e receipt.

Scheduling deve preservar lease/fencing em occurrences e recuperar missed/expired claims sem duplo dispatch.

Analytics deve continuar append-only e idempotente por `(tenantId, eventId)`.

Decisao proposta:

- evitar locks longos no nivel de aplicacao;
- preferir claims atomicos no repository;
- manter transacoes curtas;
- nao executar chamadas externas dentro de transacao de banco;
- gravar intencao/attempt antes do side effect e receipt/reconciliation depois;
- usar idempotency keys nos providers reais futuros.

## 7. Queries Criticas

Revisar indices e planos para:

- publication outbox por status, `runAfter`, tenant/workspace e provider;
- publication attempts por publication e provider;
- reconciliation por status e idade;
- dead letters por workspace/status;
- scheduling occurrences por status, `scheduledAt`, lease e workspace;
- webhook provider events por provider event id, receivedAt e status;
- analytics events por tenant/workspace/occurredAt/eventType;
- analytics snapshots por tenant/workspace/metric/period/granularity;
- audit logs por tenant/workspace/createdAt/resource.

Toda rota administrativa que listar dados operacionais deve ter `limit`, cursor ou janela temporal.

## 8. Cache

Cache deve ser opcional e seguro.

Permitido:

- provider descriptors;
- metric registry;
- health summaries de curta duracao;
- configuracoes estaticas derivadas;
- consultas analiticas agregadas com TTL curto.

Proibido ou evitado:

- segredos;
- permissoes/RBAC;
- claims de filas;
- publication attempt em andamento;
- webhook nonce/replay state;
- dados que possam liberar side effect externo indevidamente.

Decisao proposta:

- criar `CachePort`;
- implementar `NoopCache` e `InMemoryTtlCache`;
- injetar cache apenas em servicos explicitamente seguros;
- invalidar por tenant/workspace quando houver mutacao operacional relevante.

## 9. Rate Limit

Risco: sem rate limit global, endpoints de operacao podem pressionar banco, workers e providers.

Decisao proposta:

- criar `RateLimiterPort`;
- implementar rate limit por route group, principal, tenant, workspace e IP;
- usar limites separados para auth, webhooks, analytics query/export, publication operate e admin;
- retornar 429 com envelope seguro;
- nunca contar health/livez como trafego de negocio;
- registrar metricas e auditoria apenas para eventos administrativos relevantes.

## 10. Backpressure

Backpressure deve impedir que o sistema aceite mais trabalho quando a operacao esta degradada.

Sinais:

- outbox pendente acima do limite;
- fila temporal atrasada;
- dead letters crescendo;
- circuit breaker aberto;
- secret manager indisponivel;
- provider health degraded/unhealthy;
- database latency elevada;
- analytics ingestion lag.

Acoes:

- pausar claims/dispatch;
- rejeitar novas operacoes com 429/503 seguro quando apropriado;
- permitir leituras e reprocessamentos administrativos controlados;
- expor estado no painel operacional.

## 11. Observabilidade

Logging estruturado deve incluir:

- request id;
- tenant id;
- workspace id;
- actor id quando autenticado;
- route group;
- operation id;
- publication id, schedule id, event id ou export id quando aplicavel;
- provider id;
- status, duracao e categoria de erro.

Logging nao deve incluir:

- access tokens;
- refresh tokens;
- secrets;
- Authorization;
- cookies;
- payload OAuth bruto;
- webhook raw payload sensivel;
- conteudo integral de posts quando nao necessario.

SLIs propostos:

- API availability;
- API latency p95/p99;
- publication dispatch success rate;
- publication end-to-end latency;
- provider circuit open time;
- scheduling on-time dispatch rate;
- scheduling recovery success;
- analytics ingestion success rate;
- analytics query latency;
- dead letter rate;
- backup restore success.

SLOs iniciais devem ser conservadores e locais, usados como criterio de release candidate, nao como promessa publica.

## 12. API Administrativa

Criar rotas sob `/v1/system/*`, protegidas por permissao administrativa dedicada.

Rotas propostas:

- `GET /v1/system/health`;
- `GET /v1/system/readiness`;
- `GET /v1/system/circuit-breakers`;
- `POST /v1/system/circuit-breakers/:id/reset`;
- `GET /v1/system/rate-limits`;
- `GET /v1/system/backpressure`;
- `GET /v1/system/queues`;
- `GET /v1/system/secrets/health`;
- `GET /v1/system/slo`;
- `GET /v1/system/audit`;
- `POST /v1/system/recovery/run`;

Essas rotas nao devem ativar producao, nao devem expor segredo e nao devem executar provider real.

## 13. Painel Operacional

Criar um painel no frontend para operadores/admins com:

- status geral;
- readiness/liveness;
- filas e backpressure;
- circuit breakers;
- provider health;
- secret manager health;
- dead letters;
- data quality;
- SLI/SLO;
- acoes controladas de reset/recovery quando permitidas por RBAC.

O painel deve ser operacional, denso e escaneavel. Nao deve ser landing page.

## 14. Backup e Restore

Plano minimo:

- documentar tabelas criticas;
- documentar ordem de restore;
- validar restore local em banco temporario;
- verificar consistencia de analytics snapshots reconstruidos;
- verificar outbox/reconciliation apos restore;
- verificar ausencia de duplicidade em publication/scheduling;
- registrar evidencia no relatorio final.

Snapshots de Analytics nao sao fonte primaria. A fonte primaria continua sendo `analytics_events`.

## 15. Testes Propostos

Testes unitarios:

- Production Guard;
- Secret Manager fail-closed;
- circuit breaker persistente;
- rate limiter;
- backpressure;
- cache TTL/invalidation;
- health/readiness/liveness;
- log redaction.

Testes de integracao:

- provider failure -> circuit breaker open -> recovery -> dispatch resumed;
- worker failure -> restart -> recovery -> no duplication;
- analytics -> snapshot -> restore/rebuild -> consistency;
- secret manager unavailable -> readiness degraded/unhealthy -> no external side effect;
- backpressure active -> enqueue/dispatch controlled;
- rate limit exceeded -> 429 safe envelope.

Validacoes finais esperadas:

- `npm run typecheck`;
- `npm run architecture:check`;
- testes de publication, scheduling, analytics e persistence;
- testes novos de operations/production-hardening;
- testes frontend do painel operacional.

## 16. Ordem de Implementacao Proposta

1. Portas operacionais: secret manager, production guard, circuit breaker, rate limit, cache, backpressure.
2. Adapters em memoria/noop e adapters PostgreSQL onde o estado precisa sobreviver a restart.
3. Health/readiness/liveness e configuracao.
4. Integracao na composition root.
5. API administrativa.
6. Painel operacional.
7. Testes de falha, recovery, carga local e restore.
8. Documentacao e `docs/sprint-23-final-report.md`.

## 17. Criterios de Aprovacao da Revisao

A implementacao so deve comecar apos aprovacao explicita desta revisao.

Aprovacao significa aceitar as seguintes decisoes:

- producao continua bloqueada por padrao;
- Sprint 23 nao cria provider novo;
- Secret Manager sera uma abstracao fail-closed;
- circuit breaker de operacao critica sera persistente;
- queue em memoria nao sera tratada como fonte duravel;
- readiness sera mais restritivo que health/liveness;
- painel operacional sera administrativo, nao funcionalidade editorial;
- testes de failover/restore serao obrigatorios antes do relatorio final.

