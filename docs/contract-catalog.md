# Catálogo de Contratos — Zuno (RC 1.0)

Produzido na Sprint 24 (Fase 6). Cobre Ports, Adapters, Repositories e Policies da plataforma nova (Conversation → Operations). Não repete o que já está detalhado em `docs/event-catalog.md` (eventos) — este catálogo é sobre **portas e implementações**, não sobre o que trafega nelas.

## Como este catálogo está organizado

`src/application/ports/*.port.ts` contém os **Ports compartilhados** (55 arquivos) — a maioria repositórios (`*-repository.port.ts`), mais um punhado de portas de infraestrutura transversal (auth, clock, secret manager, métricas). Além disso, vários domínios definem **Ports locais** dentro da própria pasta (`application/<domínio>/*.port.ts`) quando o contrato é específico do domínio e nunca reaproveitado por outro. Cada Port relevante tem, no mínimo, um Adapter em memória (para testes e o driver `PERSISTENCE_DRIVER=memory`) e, para os domínios com persistência real, um Adapter Postgres.

## 1. Ports compartilhados (`src/application/ports/`)

### Repositórios de domínio (persistência)
| Port | Domínio | Adapter memória | Adapter Postgres |
|---|---|---|---|
| `conversation-repository.port.ts`, `conversation-event-repository.port.ts`, `conversation-memory-repository.port.ts` | Conversation | ✅ | ✅ |
| `briefing-repository.port.ts`, `briefing-field-value-repository.port.ts`, `briefing-question-repository.port.ts`, `prepared-command-repository.port.ts` | Briefing | ✅ | ✅ |
| `planning-repository.port.ts`, `execution-task-repository.port.ts`\*, `execution-graph-repository.port.ts`\*, `planning-artifact-repository.port.ts`, `planning-decision-repository.port.ts` | Planning | ✅ | ✅ |
| `runtime-repository.port.ts` | Runtime | ✅ | ✅ |
| `execution-repository.port.ts` | Execution (runs) | ✅ | ✅ |
| `publication-repository.port.ts` | Publication | ✅ | ✅ |
| `credential-repository.port.ts` | Credential | ✅ | ✅ |
| `webhook-event-repository.port.ts` | Webhook | ✅ | ✅ |
| `scheduling-repository.port.ts` | Scheduling | ✅ | ✅ |
| `analytics-repository.port.ts` | Analytics | ✅ | ✅ |
| `operational-audit-repository.port.ts`, `operational-state-repository.port.ts` | Operations | ✅ | ✅ |
| `ai-execution-repository.port.ts` | AI Gateway | ✅ | ✅ |
| `workspace-repository.port.ts`, `asset-library-repository.port.ts`, `chat-repository.port.ts` | Workspace/legado | ✅ | ✅ |
| `user-repository.port.ts`, `session-repository.port.ts`, `refresh-token-repository.port.ts`, `tenant-membership-repository.port.ts` | Identity | — | ✅ (Identity sempre exige Postgres, mesmo com `PERSISTENCE_DRIVER=memory` para os demais domínios) |

\* `execution-task-repository.port.ts`/`execution-graph-repository.port.ts` nomeados de forma ambígua — pertencem ao domínio **Planning** (Sprint 09, `ExecutionTask` como conceito de plano, nunca de execução real), não ao domínio **Execution** (Sprint 11+, `ExecutionRun`). A colisão de nome é só textual; os tipos e tabelas nunca se confundem (`execution_tasks` é do Planning; `execution_runs`/`execution_task_runs` são do Execution). Sinalizado aqui para evitar confusão em revisões futuras.

### Infraestrutura transversal
| Port | Propósito | Implementações conhecidas |
|---|---|---|
| `auth.port.ts` | Verificação de token → `AuthPrincipal` | `JwtAuthAdapter`, `NoopAuthAdapter` |
| `jwt.port.ts`, `password-hasher.port.ts` | Primitivas de identidade | `JsonWebTokenJwtAdapter`, `BcryptPasswordHasher` |
| `clock.port.ts` | Tempo injetável (testabilidade) | implementação direta `() => new Date()` na maioria dos casos de uso |
| `secret-manager.port.ts` | Segredos de credenciais de provider (nunca segredos da própria app) | `InMemorySecretManager` (dev/sandbox), `FailClosedProductionSecretManager` (produção — **stub, falha fechado, sem backend real**) |
| `metrics-provider.port.ts` | Métricas externas por provider (ads/campanha) | adapters específicos por provider (sandbox) |
| `audit-log.port.ts` | Log de auditoria de Identity (write-only, ver Event Catalog §7) | implementação Postgres |
| `ai-gateway.port.ts`, `ai-model-provider.port.ts`, `ai-provider.port.ts`, `ai-circuit-breaker.port.ts`, `ai-rate-limiter.port.ts`, `ai-telemetry.port.ts` | AI Gateway (Sprint 08) | `AnthropicAiModelProvider`, `FakeAiModelProvider`, `InMemoryAiCircuitBreaker`, `InMemoryAiRateLimiter` |
| `social-publisher.port.ts`, `artifact-hosting.port.ts`, `artifact-delivery.port.ts` | Publicação/entrega (legado + ponte para Publication novo) | adapters locais/sandbox |
| `storage.port.ts`, `media-catalog.port.ts`, `media-provider.port.ts` | Mídia/armazenamento (legado) | adapters locais |

## 2. Ports locais por domínio (`application/<domínio>/*.port.ts` e equivalentes)

| Domínio | Port local | Papel |
|---|---|---|
| Execution | `application/execution/execution-handler.port.ts` | Contrato entre o motor de Execution e um "handler" de tarefa — é a ÚNICA porta pela qual `application/execution` pode, em tempo de infraestrutura (nunca em domínio/aplicação), alcançar uma Skill real. `check-execution-isolation.mjs` garante que só `src/infrastructure/execution/*` implementa este port com acesso a Skills reais. |
| Publication | `publication-provider.port.ts`, `publication-provider-adapter.port.ts`, `publication-queue.ts`, `publication-secret-resolver.ts`, `publication-secret-store.ts`, `publication-provider-policy.ts` | Conjunto de portas que isolam Publication de qualquer SDK de rede social real — todo provider concreto (Meta, sandbox) implementa `PublicationProviderPort`. |
| Scheduling | `scheduled-publication-dispatcher.port.ts` | Ponte formal para o dispatcher que, na prática, importa valores de `application/publication/*` diretamente (ver achado de acoplamento na Fase 2 do relatório final) — o port existe, mas parte da implementação de referência não passa só por ele. |
| Campaign Intelligence | `campaign-workspace-repository.port.ts` | Só tem adapter local-JSON (`LocalJsonCampaignWorkspaceRepository`) — **sem adapter em memória nem Postgres**, diferente de todo o resto da plataforma nova. |
| Company Intelligence | `company-knowledge-repository.port.ts` | Mesma situação — só `LocalJsonCompanyKnowledgeRepository`. |

## 3. DTOs e schemas de validação HTTP

Cada rota Fastify declara `schema: { body, params, querystring }` inline (JSON Schema, validado pelo próprio Fastify antes do handler rodar) — não existe uma camada DTO separada com classes/`class-validator`. Os "contratos de resposta" são os tipos de retorno dos casos de uso em `application/<domínio>/*-use-cases.ts`, serializados via `successEnvelope()`/`errorEnvelope()` (`src/interfaces/api/http/response-envelope.ts`), formato estável: `{ ok: true, data, meta: {requestId} } | { ok: false, error: {code, message, recoverable}, meta }`.

Exceção parcial: `application/briefing/dto.ts` define DTOs explícitos (`BriefingQuestionDto`, `BriefingSummaryDto`, `PreparedCommandSummaryDto`) por decisão da Sprint 07 — são espelhados manualmente no frontend (`web/features/briefing/types.ts`) e protegidos por `scripts/check-contract-drift.mjs`. O mesmo padrão de espelhamento + guarda de drift existe para Planning (`web/features/planning/types.ts`) e Runtime (`web/features/runtime/types.ts`) — 49 contratos verificados no total pelo `check-contract-drift.mjs` atual. Os demais domínios (Execution, Publication, Scheduling, Analytics, Credential, Webhook, Operations) **não têm essa mesma guarda de drift** — o frontend copia os tipos manualmente sem verificação automatizada de divergência. Achado documentado no relatório final.

## 4. Policies

| Policy | Domínio | Papel |
|---|---|---|
| `PublicationGovernancePolicy` (`application/credential/publication-governance-policy.ts`) | Credential/Governance | Decide se uma Publication pode prosseguir dado o ambiente do provider (sandbox/produção) e a lista de canário. |
| `PublicationProviderPolicy`/`PublicationProviderEnvironmentPolicy`/`PublicationCanaryPolicy` (`application/publication/publication-provider-policy.ts`) | Publication | Define quais providers/ambientes estão habilitados — consultado pelo `ProductionGuard`. |
| `ProductionGuard` (`application/operations/operational-services.ts`) | Operations | **A policy mais crítica da plataforma** — combina ambiente, `providerEnvironment`, flag de produção, canário, tenant/workspace permitido, provider permitido e prontidão do Secret Manager antes de permitir qualquer efeito de produção real. Falha fechado por padrão. Exposta em `GET /v1/system/release-gate`. |
| `OperationalCircuitBreaker`/`OperationalRateLimiter`/`BackpressureController` (`application/operations/operational-services.ts`) | Operations | Policies operacionais transversais — nunca decidem regra de negócio, só limitam/param. |
| `RateLimiter` de rota (`interfaces/api/middleware/rate-limit.middleware.ts`) | HTTP | Aplica `OperationalRateLimiter` como `preHandler` global, com exceção para health/readiness/liveness. |

## 5. Guardas de arquitetura (contratos de isolamento, verificados em CI local)

| Script | Verifica |
|---|---|
| `check-legacy-chat-imports.mjs` | Nenhum consumidor novo do Chat legado |
| `check-contract-drift.mjs` | 49 contratos (Briefing/Conversation/Planning/Runtime) idênticos entre `src/` e `web/` |
| `check-ai-stack-isolation.mjs` | Ícaro (legado) × AI Gateway (novo) nunca se importam |
| `check-planning-isolation.mjs` | Planning × pipeline legado (Arthur/Caio/Helena/Skills) |
| `check-runtime-isolation.mjs` | Runtime × pipeline legado |
| `check-execution-isolation.mjs` | Execution × Caio/Helena/Skills/AI/rede/publicação (exceto adapters de `infrastructure/execution`, que têm licença explícita para tocar Skills reais) |
| `check-publication-isolation.mjs` | Publication × Execution/Helena/Skills/AI/providers reais |
| **Ausentes (achado, Fase 2):** | Não existe guarda automatizada para Credential↔Webhook↔Scheduling↔Analytics↔Operations entre si — a verificação dessas relações nesta sprint foi manual (grep), não é reforçada em CI. |

Todos os 8 scripts rodam via `npm run architecture:check`, confirmados passando nesta sprint (ver relatório final, Seção 4).
