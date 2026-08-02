# Sprint 18 - Relatorio Final

Status: implementado. Sprint 19 nao foi iniciada.

## 1. Revisao Arquitetural

A revisao foi registrada em `docs/sprint-18-architecture-review.md` antes da implementacao. Ela cobriu Provider Registry, Adapter Contract, Secret Resolver, Credential Reference, Durable Outbox, Dispatch, Reconciliation, Receipt Verification, idempotencia, PublicationPolicy e Environment Policy.

## 2. Provider Escolhido

Provider unico: `meta_pages_sandbox`.

Motivos:

- Ambiente oficial de desenvolvimento/testes da Meta com Graph API, test users e test pages.
- Canal unico nesta sprint: `facebook`.
- Production permanece bloqueada.
- Nenhum segundo provider foi iniciado.

## 3. OAuth

Implementado `MetaPagesOAuthService` com:

- authorization request com `state` curto e expiravel;
- authorization code exchange;
- troca para token de maior duracao;
- resolucao de test page via `/me/accounts`;
- criacao de `PublicationCredentialReference`;
- `disconnect` com revogacao local da referencia e remocao do segredo.

Tokens nao sao persistidos no dominio Publication.

## 4. Secret Storage

Foi criada a porta `PublicationSecretStoragePort` e a implementacao local `LocalPublicationSecretStore`.

A interface ja separa:

- `tenantId`;
- `workspaceId`;
- `providerId`;
- `credentialReferenceId`;
- material secreto em `value`.

Essa porta pode ser substituida por Vault, Azure Key Vault, AWS Secrets Manager ou GCP Secret Manager sem alterar dominio ou adapter.

## 5. Provider Adapter

Foi implementado `MetaPagesSandboxProvider` com:

- `publish`;
- `getStatus`;
- `verifyReceipt`;
- `health`;
- `capabilities`;
- timeout por chamada;
- mapeamento de HTTP errors;
- captura de `x-fb-trace-id` ou `x-fb-request-id`;
- snapshot de rate limit;
- telemetria segura de latencia/erros.

## 6. Sandbox

`PublicationProviderPolicy` diferencia `sandbox` e `production`.

Sandbox permite provider real apenas quando o canario autoriza tenant e workspace. Production continua bloqueada por padrao.

## 7. Canary

Canary configuravel por env:

- `PUBLICATION_CANARY_ENABLED`;
- `PUBLICATION_CANARY_TENANT_IDS`;
- `PUBLICATION_CANARY_WORKSPACE_IDS`;
- `META_PAGES_SANDBOX_ENABLED`.

Workspaces fora do canario caem automaticamente para `dry_run`.

## 8. Rate Limit

O adapter captura:

- `retry-after`;
- `x-ratelimit-remaining`;
- `x-ratelimit-reset`.

HTTP 429 vira `rate_limited` com `retryAfter`, preservando o comportamento de retry do outbox.

## 9. Provider Errors

Mapeamento interno:

- 401: `authentication_failure`;
- 403: `permanent_failure`;
- 429: `rate_limited`;
- 5xx: `transient_failure`;
- timeout/599: `unknown_outcome`;
- demais 4xx: `rejected`.

Excecoes cruas de adapter sao normalizadas em `PublicationDispatchService`.

## 10. Receipt Real

`PublicationReceipt` agora suporta:

- `providerRequestId`;
- `externalIdentifiers`;
- `providerPublicationId`;
- `url`;
- `publishedAt`;
- `status`;
- `checksum`.

O Postgres foi estendido pela migration `0044_publication_real_provider_sandbox.sql`.

## 11. Reconciliation

`getStatus` consulta o provider por `providerPublicationId`.

Receipt verification cria novo registro e nao altera receipt existente. Unknown outcome sem external id continua inconclusivo, sem retry cego.

## 12. API

Novas rotas:

- `GET /v1/publication-providers/meta_pages_sandbox/oauth/status`;
- `POST /v1/publication-providers/meta_pages_sandbox/oauth/connect`;
- `POST /v1/publication-providers/meta_pages_sandbox/oauth/callback`;
- `POST /v1/publication-providers/meta_pages_sandbox/oauth/disconnect`;
- health de provider via rota existente.

RBAC aplicado: leitura usa `publication:read`; conexao/desconexao usa `publication:admin`.

## 13. Frontend

O painel `Publication` agora mostra:

- status do provider Meta Pages Sandbox;
- status OAuth;
- page id nao secreto;
- expiracao de token;
- acao conectar;
- acao desconectar;
- receipts com request id e identifiers externos.

## 14. Observabilidade

Adicionado:

- telemetria OAuth success/failure;
- token refresh success/failure;
- provider latency;
- provider errors;
- rate limit no health;
- metricas existentes de outbox, dead letter, reconciliation e credential failures.

## 15. Testes

Cobertura adicionada em `tests/publication-reliability.test.mjs` e `tests/publication-api.test.mjs`:

- OAuth e secret resolver;
- ausencia de tokens em credential reference;
- adapter publish;
- receipt verification;
- rate limit;
- sandbox/production policy;
- canary e fallback para dry_run;
- RBAC API;
- reconciliation apos timeout via provider fake existente;
- idempotencia e outbox duravel existentes.

## 16. Evidencia Completa

Evidencia automatizada:

OAuth -> Credential Reference -> Secret Resolver:

- teste `Meta Pages OAuth: callback salva token so no secret store e credential reference so com metadados`.

Publication -> Durable Outbox -> Dispatch -> Provider Sandbox -> Receipt -> Verification -> Completed:

- testes de publication engine/API;
- teste `Meta Pages Sandbox Adapter: publica, captura request id e verifica receipt por status externo`;
- testes de unknown outcome e reconciliation da Sprint 17 preservados.

Sem credenciais reais Meta neste ambiente, nao executei chamada live contra uma test page externa. A implementacao esta pronta para executar em sandbox quando `META_*` e canary forem configurados.

## 17. Evidencia de Isolamento Arquitetural

- Execution nao foi alterado para conhecer provider externo.
- Publication domain recebeu apenas identificador/metadados nao secretos.
- OAuth e adapter ficam em `src/infrastructure/publication`.
- Secret storage fica atras de porta de application.
- API injeta dependencias pelo container.

## 18. Riscos

- Meta Pages nao oferece idempotency key nativa para o endpoint usado; o controle continua local com outbox, fencing e reconciliation.
- Unknown outcome sem `providerPublicationId` pode permanecer inconclusivo.
- Secret store local nao e adequado para producao.
- Rotacao completa para vault externo ainda deve ser validada em ambiente real.
- Rate limit real da Meta pode usar headers adicionais alem dos headers genericos capturados.

## 19. Recomendacoes para Sprint 19

- Substituir secret store local por provider de vault.
- Adicionar lifecycle automatico de worker/recovery no servidor.
- Executar teste live com Meta test page e app em development mode.
- Expandir reconciliacao para fluxo administrativo de inconclusive.
- Persistir metricas de provider em backend de observabilidade real.
