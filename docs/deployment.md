# Deployment — Plataforma Zuno (RC 1.0)

**Production permanece bloqueada por padrão** (`ProductionGuard`, ver `docs/sprint-24-final-report.md`). Este documento descreve como implantar um ambiente controlado (sandbox/staging) — não um passo a passo de ativação de produção real, que exige aprovação explícita fora do escopo desta sprint.

## Pré-requisitos

- Node.js ≥ 20, PostgreSQL real (não PGlite — PGlite é só para testes).
- Variáveis de ambiente mínimas (ver `.env.example`, com o gap documentado no relatório final — algumas variáveis usadas por `api-config.ts` não estão listadas lá ainda): `DATABASE_URL`, `JWT_SECRET`, `API_CORS_ORIGIN`, `COOKIE_SECURE=true` (fora de `localhost`).

## Passos

1. `npm ci && npm run build` — compila TypeScript, copia manifestos de Skills e assets do Remotion.
2. `npm run db:migrate` — aplica as 49 migrations pendentes (transação por arquivo, checksum verificado contra o que já foi aplicado — falha explícita se um arquivo já aplicado foi alterado).
3. `npm run db:migrate:status` — confirmar que tudo aplicou.
4. Configurar `AUTH_MODE=jwt` (nunca `noop` fora de dev/teste) com `JWT_SECRET` forte e `DATABASE_URL` apontando para o Postgres real.
5. `PERSISTENCE_DRIVER=postgres` (memória nunca deve rodar fora de dev/teste — dados somem a cada restart).
6. `COOKIE_SECURE=true` obrigatório fora de `http://localhost` — o padrão é `false`, então isto **precisa ser setado explicitamente** (achado de configuração crítica no relatório final).
7. `SECRET_MANAGER_PROVIDER` — `local` para sandbox (não durável, aceitável só fora de produção real); `production` hoje é um stub fail-closed sem backend real conectado (bloqueia qualquer fluxo que dependa de segredo de credencial até um backend real existir — ver Riscos residuais).
8. `npm run zuno:api` — sobe a API.
9. `cd web && npm run build && npm start` — sobe o frontend (`NEXT_PUBLIC_API_URL` apontando para a API).
10. Confirmar `GET /readyz` → `ready: true` e `GET /v1/system/release-gate` → `productionEnabled: false` antes de considerar o ambiente "no ar".

## Nunca fazer nesta fase

- Setar `PUBLICATION_PRODUCTION_ENABLED=true` sem um Secret Manager de produção real conectado — o `ProductionGuard` deveria bloquear, mas não confiar cegamente nisso como única camada de defesa.
- Expor a API sem `@fastify/cors` restrito a uma origem conhecida — o padrão já é restrito (`localhost:3001`), mas confirmar `API_CORS_ORIGIN` em cada ambiente.
- Rodar sem headers de segurança adicionais (`helmet`/CSP) — nenhum está registrado hoje (achado do relatório final); não é um bloqueador para sandbox, mas é um requisito antes de qualquer exposição pública real.

## Rollback

Não existe rollback automatizado de migrations (decisão documentada em `migration-runner.ts` — cada migration reverte só a si mesma se falhar durante a aplicação; migrations já commitadas nunca são desfeitas automaticamente). Rollback de uma migration já aplicada = restaurar de backup + reaplicar as migrations anteriores, ou escrever uma migration forward-only de correção. Planejar isso explicitamente antes de qualquer deploy de produção real.
