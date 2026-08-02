# Sprint 19 - Relatorio Final

Data: 2026-07-30

## Escopo entregue

- Dominio independente de Credential, CredentialReference, CredentialBinding, CredentialRotation, CredentialHealth, OperationalAudit e ComplianceReport.
- Stores em memoria e Postgres para credenciais e auditoria operacional append-only.
- Migration `0045_credential_governance_audit_compliance.sql` com tabelas, constraints e indices do dominio.
- OAuth Meta Pages Sandbox integrado ao novo dominio sem persistir access token/page token fora do secret store.
- Rotacao manual/agendada, revoke, disable, enable, health-check e export JSON/CSV de historico.
- Policy engine de publicacao externa com RBAC, ambiente, canario, credential binding, health, escopos e aprovacao.
- Outbox real passa a resolver `credentialReferenceId` ativo antes de criar mensagem para provider externo.
- Receipts de provider real agora usam status `published`, mantendo `dry_run` separado.
- API administrativa:
  - `GET /v1/credentials`
  - `GET /v1/credentials/:id`
  - `POST /v1/credentials/connect`
  - `POST /v1/credentials/rotate`
  - `POST /v1/credentials/revoke`
  - `POST /v1/credentials/disable`
  - `POST /v1/credentials/enable`
  - `POST /v1/credentials/health-check`
  - `GET /v1/credentials/:id/export`
  - `GET /v1/audit`
  - `GET /v1/compliance`
- RBAC novo para `credential:*`, `audit:read` e `provider:operate`, com negacao auditada nas rotas administrativas.
- Frontend em `web/app/workspaces/[workspaceId]/governance/page.tsx`, com credenciais, health, acoes operacionais, audit trail, compliance e export preview.

## Decisoes

- Publication continua tendo somente espelho de `PublicationCredentialReference` para compatibilidade operacional. O dominio proprietario de credenciais fica em `src/domain/credential`.
- Secrets continuam fora de banco/repositorios de dominio. O dominio grava apenas references, scopes, expiracao, status e metadados seguros.
- Production permanece bloqueada por policy. Sprint 19 nao habilita provider novo nem publicacao em producao.
- Compliance entregue como checks automatizados internos: LGPD/minimizacao, retencao, anonimizacao, scan de secrets em dominio/audit/logs/payloads e garantia de token fora da persistencia.

## Validacao

- `npm run typecheck` - passou.
- `cd web && npm run typecheck` - passou.
- `npm run test:publication` - passou, 29 testes.
- `npm run architecture:check` - passou.
- `npm test` - passou, 1732 testes.
- `cd web && npm test` - passou, 11 testes.

## Arquivos principais

- `src/domain/credential/credential.model.ts`
- `src/application/credential/credential-governance-service.ts`
- `src/application/credential/compliance-service.ts`
- `src/application/credential/publication-governance-policy.ts`
- `src/application/ports/credential-repository.port.ts`
- `src/application/ports/operational-audit-repository.port.ts`
- `src/infrastructure/storage/in-memory-credential-repository.ts`
- `src/infrastructure/storage/in-memory-operational-audit-repository.ts`
- `src/infrastructure/storage/postgres/postgres-credential-repository.ts`
- `src/infrastructure/storage/postgres/postgres-operational-audit-repository.ts`
- `src/interfaces/api/routes/v1/credentials.route.ts`
- `web/features/governance/*`
- `web/app/workspaces/[workspaceId]/governance/page.tsx`

## Fora de escopo preservado

- Nenhum segundo provider real foi criado.
- Nenhuma publicacao em producao foi habilitada.
- Nenhum fluxo de Sprint 20 foi implementado.
