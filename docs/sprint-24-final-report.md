# Sprint 24 — Relatório Final: Release Candidate 1.0, Produção Controlada e Certificação Arquitetural

**Data:** 2026-07-30
**Escopo:** certificação da plataforma nova — Conversation → Briefing → AI Gateway → Planning → Runtime → Execution → Publication → Durable Outbox → Dispatch → Reconciliation → Credential → Governance → Audit → Compliance → Multi-Provider Sandbox → Webhooks → Status Synchronization → Scheduling → Editorial Calendar → Analytics → Operational Layer → Production Guard → Circuit Breakers → Health → Readiness → Backpressure → Rate Limiting (Sprints 08–23).
**Fora de escopo:** o pipeline legado (Arthur/Caio/Helena/Skills, CLI `LOCAL_PRODUCTION`) já tem seu próprio ciclo de release, encerrado e homologado separadamente (`docs/rc2-re-homologacao-report.md`, "Pronto para v1.0"). Esta sprint **não** adiciona funcionalidade nova a nenhum dos dois: é auditoria, consolidação e certificação.
**Regra desta sprint:** nenhum provider novo, nenhuma feature nova, nenhum billing/marketplace/plugin/IA nova, nenhuma ativação de produção real.

---

## 1. Auditoria Arquitetural

Revisão de todos os domínios da plataforma nova quanto a isolamento, dependências, contratos, portas, adapters, eventos, versionamento, migrations, APIs, RBAC, auditoria, observabilidade e compliance — conduzida via inspeção direta de código (grep/leitura de arquivo) e execução real de comandos (build, testes, guardas de arquitetura, smoke test HTTP contra um processo real), não por inferência.

**Resultado agregado:**

| Verificação | Resultado |
|---|---|
| `npm run architecture:check` (8 guardas) | **PASS** — 620 arquivos verificados por guarda |
| `npm test` (suíte completa) | **1754/1754 PASS** |
| `cd web && npm run typecheck` | **PASS** |
| `cd web && npm run build` | **PASS** — 21 rotas geradas |
| `cd web && npm test` | **11/11 PASS** |
| Dependências circulares entre domínios novos | **Nenhuma encontrada** (verificado nas duas direções, grep exaustivo) |
| Domínios sem guarda de isolamento dedicada | Credential, Webhook, Scheduling, Analytics, Operations, Campaign Intelligence, Company Intelligence, Enterprise (achado, ver Seção 15) |

A arquitetura está **estruturalmente íntegra**: nenhum domínio novo importa o pipeline legado, nenhum ciclo de dependência existe, todos os testes automatizados passam, e a separação Planning/Runtime/Execution (que eu já conhecia em detalhe de sprints anteriores) permanece consistente com os domínios adicionados depois (Publication, Credential, Webhook, Scheduling, Analytics, Operations), auditados nesta sprint pela primeira vez em profundidade.

## 2. Revisão dos Domínios

| Domínio | Ports | Adapters (memória/Postgres) | Guarda de isolamento | Versionamento explícito |
|---|---|---|---|---|
| Conversation/Briefing | ✅ (Sprint 06/07) | ✅/✅ | `check-legacy-chat-imports` | `schemaVersion` (Briefing) |
| AI Gateway | ✅ (Sprint 08) | ✅/✅ | `check-ai-stack-isolation` | Model Registry versionado |
| Planning | ✅ (Sprint 09) | ✅/✅ | `check-planning-isolation` | `plannerVersion`, `graphVersion`, `TaskInputContract/TaskOutputContract.version` |
| Runtime | ✅ (Sprint 10) | ✅/✅ | `check-runtime-isolation` | `runtimeSchemaVersion`, `translatorVersion`, fingerprints canônicos |
| Execution | ✅ | ✅/✅ | `check-execution-isolation` | `version` (optimistic lock), `handlerVersion`, `mappingVersion`, `schemaVersion` |
| Publication | ✅ | ✅/✅ | `check-publication-isolation` | `version`, `schemaVersion`, `providerVersion` |
| Credential | ✅ | ✅/✅ | **ausente** | **ausente** |
| Webhook | ✅ | ✅/✅ | **ausente** | **ausente** |
| Scheduling | ✅ (+ port local de dispatch) | ✅/✅ | **ausente** | `version` no modelo |
| Analytics | ✅ | ✅/✅ | **ausente** | `eventVersion`, `schemaVersion`, `version` — o mais versionado da plataforma |
| Operations | ✅ | ✅/✅ | **ausente** (é a camada transversal por desenho, ver `docs/sprint-23-architecture-review.md`) | **ausente** |
| Campaign/Company Intelligence | ✅ (locais) | **só local-JSON, sem memória/Postgres** | **ausente** | **ausente** |

Detalhamento completo por domínio (Ports/Adapters/versionamento/migrations) em `docs/contract-catalog.md`.

**Achado central:** os 5 domínios "núcleo do fluxo de negócio" (AI Gateway, Planning, Runtime, Execution, Publication) têm isolamento reforçado por script e versionamento explícito, seguindo o padrão formalizado em `docs/adr/0004-independent-domain-isolation.md`. Os 7 domínios adicionados depois (Credential, Webhook, Scheduling, Analytics, Operations, Campaign/Company Intelligence) **não têm guarda automatizada nem versionamento explícito na maioria dos casos** — o isolamento entre eles hoje depende de revisão manual, não de CI. Isto não é uma falha de execução (todos os testes passam, nenhum ciclo foi encontrado), mas é uma lacuna real de reforço estrutural.

## 3. Catálogo de Eventos

Catálogo completo em `docs/event-catalog.md`. Resumo:

- 7 sistemas de eventos/log independentes (Conversation: 19 tipos, Execution: 14, Publication: 28, Webhook: por status não por tipo, Scheduling: sem catálogo próprio — produz para Analytics, Analytics: 28, Audit/Identity: 6).
- **Nenhum barramento de eventos único** — cada domínio é dono da própria tabela e do próprio enum, por desenho (mesmo princípio de isolamento por domínio).
- Achado: **dois sistemas de auditoria paralelos e não unificados** — Identity (write-only, por decisão documentada desde a Sprint 05) e Credential/Governance (`GET /v1/audit`, `GET /v1/compliance`, consultável).
- Idempotência forte em Publication (4 pontos de `idempotency_key` ao longo do funil) e Webhook (nonce/replay); mais fraca em Analytics (dedupe por chave de origem, não centralizada) e ausente de forma explícita em Conversation/Scheduling (dependem da camada de negócio acima).

## 4. Catálogo de Contratos

Catálogo completo em `docs/contract-catalog.md`. Resumo:

- 55 Ports compartilhados em `src/application/ports/`, a maioria repositórios com adapter em memória + Postgres.
- Achado de nomenclatura (não um bug): `execution-task-repository.port.ts`/`execution-graph-repository.port.ts` pertencem ao domínio **Planning** (Sprint 09), não ao domínio **Execution** (Sprint 11+) — nomes coincidentes, tipos e tabelas nunca se confundem, mas vale registrar para revisões futuras.
- Campaign Intelligence e Company Intelligence são os únicos domínios sem adapter em memória/Postgres — só `LocalJson*Repository`.
- `check-contract-drift.mjs` protege 49 contratos entre backend e frontend (Briefing/Conversation/Planning/Runtime) — **Execution, Publication, Credential, Webhook, Scheduling, Analytics e Operations não têm essa mesma guarda automatizada**, mesmo tendo tipos espelhados manualmente no frontend.
- `ProductionGuard` é a policy mais crítica da plataforma — falha fechado por padrão, confirmado ao vivo nesta sprint (Seção 12).

## 5. Certificação das APIs

Toda rota de `src/interfaces/api/routes/v1/*.route.ts` (14 arquivos) foi revisada quanto a RBAC, auditoria, payload, status codes, versionamento e idempotência.

- **Versionamento:** `/v1` é o único prefixo de versão real. **Uma exceção**: `POST /webhooks/:provider` (receptor de webhook inbound) vive fora de `/v1` — aceitável dado seu modelo de autenticação por assinatura (não por principal), mas inconsistente com o esquema de versionamento; registrado como achado.
- **RBAC:** toda permissão referenciada por uma rota existe em `PERMISSIONS` (`identity.model.ts`) — nenhum mismatch encontrado. Nenhum endpoint que muta dado de workspace/domínio foi encontrado sem checagem de permissão (só bootstrap de auth e health/version são abertos, como esperado).
- **Auditoria:** `credentials.route.ts` usa `requireAuditedPermission`, que grava negações (`rbac.denied`) além de aplicar RBAC — os demais 13 arquivos de rota usam `requirePermission` simples, sem esse registro de auditoria extra.
- **Idempotência:** de ~45 endpoints de escrita, **apenas 2 exigem `idempotencyKey`** — `POST /execution-runs` e `POST /publications`. Todas as transições de estado subsequentes (approve/publish/cancel/retry/reschedule/reconcile, todo `scheduling.route.ts`, todo `system.route.ts`, rotação/revogação de credencial) não exigem chave de idempotência — um retry de cliente pode, em tese, duplicar o efeito, exceto onde o caso de uso subjacente já for naturalmente idempotente (não auditado individualmente nesta sprint).
- **Status codes:** padrão consistente — `successEnvelope` (200, com 201 em duas criações), `AppError` tipado (404/400/401/403/409/501) via tradutores por domínio (6 de 12 domínios têm tradutor dedicado; os demais lançam `AppError` diretamente do serviço).
- **Payload/schema:** todo endpoint de escrita valida body via JSON Schema do Fastify, **exceto `POST /publications/operate/work`**, que não declara nenhum schema (achado pontual).
- **Webhook receiver:** verifica assinatura HMAC-SHA256 antes de processar, e rejeita replay por nonce — **corretamente implementado**, apesar de estar fora de `/v1`.

## 6. Certificação do Frontend

21 páginas sob `web/app/workspaces/[workspaceId]/**` revisadas quanto a loading, empty state, permission-denied, erro, acessibilidade e responsividade.

- **Loading:** consistente — nenhuma página renderiza com dado `undefined`; páginas de detalhe usam `<Spinner/>` de página inteira, páginas de lista usam `isLoading ? null : ...` (sem spinner visível, mas sem risco de crash).
- **Empty state:** consistente em praticamente todas as páginas que listam uma coleção (`EmptyState` usado corretamente). Exceções pontuais: `chat/[conversationId]` (conversa nova sem nenhuma mensagem) e o card de "Assets" na Home.
- **Erro — achado sistêmico crítico:** **nenhuma das 17 páginas workspace-scoped auditadas lê o `error` retornado pelo hook SWR principal.** Quando uma chamada falha (500, timeout, erro de rede), a página cai no mesmo ramo visual de "lista vazia" — um erro real do backend fica indistinguível de "não há dados ainda". O padrão correto já existe no código (`web/app/workspaces/page.tsx:39-43`), mas nunca foi propagado para as páginas dentro de um workspace.
- **Permission-denied:** não existe tratamento distinto — decorre diretamente do achado acima (um 403 também cairia no ramo de "vazio").
- **Acessibilidade:** achados pontuais, não sistêmicos — inputs de busca sem label associado (`assets`), botões de navegação de calendário só com glifo sem `aria-label`, um swatch de cor sem alternativa textual. Nenhuma imagem sem `alt` (a interface não usa `<img>`, só emoji/glifos).
- **Responsividade:** sidebar (`w-56`) e lista de conversas (`w-72`) fixas sem colapso para mobile; algumas tabelas (Governance, Operations, Analytics) com `min-w-*` forçando scroll horizontal em telas estreitas.
- **Global:** não existe `web/app/error.tsx` (error boundary) nem `web/app/not-found.tsx` — erros de render caem no padrão genérico do Next.js.
- `RequireAuth` está corretamente aplicado a toda a árvore `[workspaceId]/**` — nunca renderiza conteúdo protegido antes de confirmar autenticação.

## 7. Revisão de Segurança

Checklist orientado por OWASP Top 10.

| Item | Situação |
|---|---|
| **Headers de segurança** | **Nenhum `helmet`/CSP/HSTS/X-Frame-Options/X-Content-Type-Options registrado.** Achado a corrigir antes de exposição pública real. |
| **CORS** | Restrito por padrão (`localhost:3001`), configurável via `API_CORS_ORIGIN`, `credentials:true`. Sem validação que rejeite `*` combinado com `credentials:true` (combinação inválida por spec, não defendida em código). |
| **CSRF** | Mitigado corretamente para os endpoints cookie-autenticados (`/auth/refresh`, `/auth/logout`) via double-submit cookie (`zuno_csrf_token` + header `X-CSRF-Token`). Rotas de negócio nunca leem o cookie de refresh, então não têm exposição CSRF adicional. |
| **Secrets** | Carregados via `process.env` só em `api-config.ts` (composição única confirmada — nenhum outro arquivo de domínio novo lê `process.env` diretamente). `SECRET_MANAGER_PROVIDER=production` é um **stub fail-closed sem backend real** — bloqueia corretamente em vez de vazar, mas não é utilizável em produção real ainda. Nenhum secret encontrado logado ou hardcoded. |
| **Injection (SQL)** | Todas as queries amostradas usam `$1..$n` parametrizados; o único SQL dinâmico encontrado (`postgres-execution-repository.ts`) interpola só nomes de coluna estáticos, nunca valor de usuário. |
| **Mass assignment** | Bodies de escrita usam schema com `additionalProperties:false` nos casos auditados (`POST /workspaces`); `tenantId` sempre vem do principal autenticado, nunca do body. |
| **SSRF** | `website-discovery.ts` (Company Intelligence) faz `fetch()` para domínio arbitrário sem allowlist de IP privado — **hoje não está exposto por nenhuma rota HTTP** (só CLI/orquestração), então sem vetor de ataque ao vivo, mas é um risco latente se essa capability for exposta via API no futuro. |
| **XSS** | API nunca retorna `text/html` — sempre JSON via `successEnvelope`/`errorEnvelope`. |
| **RBAC** | Cobertura completa confirmada (Seção 5) — nenhum endpoint mutador sem permissão. |

**Configuração crítica com default silencioso perigoso:** `COOKIE_SECURE` tem default `false` — fora de `localhost`, um deploy que esqueça de setar `COOKIE_SECURE=true` expõe o cookie de refresh sem a flag `Secure`. Não há validação de startup que force esse valor em ambientes não-locais.

## 8. Revisão de Performance

- **Índices/FKs:** amostragem das 12 migrations mais recentes (Execution, Publication, Credential, Webhook, Scheduling, Analytics, Operations) mostra boa cobertura geral (índices explícitos acompanhando quase toda FK), **exceto `0042_publication_domain.sql`**: 11 tabelas, 13 colunas de FK, só 3 índices explícitos. `publication_candidates`, `publication_approvals`, `publication_attempts`, `publication_failures` e `publication_dead_letters` não têm índice na coluna `publication_id` (só o lado PK é indexado automaticamente pelo Postgres — o lado FK nunca é). `publication_targets`/`publication_receipts` são cobertos incidentalmente por uma constraint `unique` que começa com essa coluna. Consultas de "listar todos os X de uma publication" nessas 5 tabelas fazem table scan à medida que o volume cresce.
- **Paginação:** não auditada exaustivamente nesta sprint em todos os endpoints de listagem — recomendação para a Sprint 25 confirmar que toda rota `GET` de coleção (`/executions`, `/publications`, `/schedules`, `/analytics/*`) tem paginação real (`limit`/`cursor`) e não apenas retorna a tabela inteira.
- **Cache:** nenhum cache distribuído encontrado — só TTL local em memória em pontos pontuais (mencionado no relatório da Sprint 23 como risco residual já conhecido).
- **Serialização:** `successEnvelope`/JSON padrão do Fastify — sem achado de payload excessivamente grande nas amostras revisadas, mas não houve profiling de payload real sob carga nesta sprint.

## 9. Revisão de Observabilidade

- **Logs:** Pino (via Fastify), nível configurável (`ZUNO_LOG_LEVEL`), `reqId` automático por requisição. **Achado:** `tenantId`/`principalId` não são anexados como campos estruturados aos logs de requisição (o contexto existe em `request.zunoContext` mas não é mesclado no logger) — dificulta correlacionar logs por tenant em produção.
- **Tracing:** não é tracing distribuído (sem OpenTelemetry) — é um conceito de domínio (`traceId`/`correlationId`/`causationId` em Execution), persistido em `execution_traces` (migration `0040`) e **propagado corretamente até Publication**. **Não propaga para Scheduling** (achado — nenhum campo `traceId` no domínio Scheduling).
- **Métricas:** sem exportador Prometheus/StatsD — métricas são snapshots JSON sob demanda (`GET /v1/execution/metrics`, `GET /v1/analytics/*`, `GET /v1/system/*`).
- **Health/Readiness:** bem implementados — `/readyz` checa database, secret manager, estado operacional, production guard e fila; `GET /v1/system/health` adiciona circuit breakers e SLO.
- **Alertas:** `AnalyticsAlertService` avalia regras (falha de publicação ≥25%, dead-letter >0) contra métricas armazenadas, com endpoints de reconhecer/resolver — é poll-and-list, sem push (e-mail/Slack) automatizado.
- **Circuit breakers:** dois mecanismos independentes (`OperationalCircuitBreaker`, persistente, para Execution/Publication; `InMemoryAiCircuitBreaker`, não persistido, só para AI Gateway) — ambos com leitura E reset via `system.route.ts`.
- **Rate limiting/Backpressure:** implementados de forma robusta, por tenant/principal/rota, persistidos quando Postgres está configurado, com endpoints de leitura dedicados.

## 10. Revisão de Migrations

- 49 migrations, runner com **transação por arquivo, advisory lock, checksum contra drift, aplicação idempotente** — bem projetado.
- **Sem rollback automatizado (down-migration)** — decisão documentada explicitamente no código: uma migration com erro reverte só a si mesma; migrations já commitadas nunca são desfeitas automaticamente. Estratégia de reversão real = restaurar de backup ou escrever uma migration forward-only de correção (documentado agora em `docs/deployment.md`).
- Ordem: estritamente sequencial por prefixo numérico (0001–0049), sem gaps, sem duplicatas.
- Achado de índice/FK: ver Seção 8 (Performance) — `0042_publication_domain.sql` sub-indexado relativo às suas FKs.
- Constraints: uso consistente de `check (...)` para enums fechados em quase todas as tabelas novas, replicando os enums TypeScript correspondentes — nenhuma divergência encontrada nas tabelas amostradas.

## 11. Release Readiness

| Item | Status |
|---|---|
| Banco | ✅ migrations aplicam limpo, checksum protegido |
| Workers | ✅ (`PublicationWorker`, dispatch de Scheduling) — cobertos por `operational-hardening.test.mjs`, `publication-reliability.test.mjs` |
| Queues | ✅ outbox de Publication com lock + fencing, testado |
| Providers | ✅ sandbox funcional; Meta real implementado mas **sem credenciais de produção configuradas** (esperado — production bloqueada) |
| OAuth | ✅ fluxo Meta Pages OAuth implementado e testado em sandbox |
| Scheduling | ✅ testado (`scheduling.test.mjs`, 6 testes) |
| Analytics | ✅ testado (`analytics.test.mjs`, 7 testes) |
| Publication | ✅ testado (engine + api + reliability) |
| Governance | ✅ `ProductionGuard`/`PublicationGovernancePolicy` testados, fail-closed confirmado |
| Backup | ⚠️ plano documentado (`BackupRestorePlanner`), **sem rehearsal real executado** |
| Restore | ⚠️ mesmo plano, mesma ressalva |
| Health | ✅ `/health`, `/livez`, `/readyz`, `/v1/system/health` todos verificados ao vivo nesta sprint |

## 12. Smoke Tests

Executado o fluxo completo com evidência de dois tipos: (a) **ao vivo**, contra um processo real (`node dist/interfaces/api/server.js`, `PERSISTENCE_DRIVER=memory`, `AUTH_MODE=noop`) para a porção Conversation→Execution, que eu tenho conhecimento arquitetural direto; (b) **suíte automatizada**, já confirmada passando nesta sprint (Seção 1), para a porção Publication→Scheduling→Analytics→Audit→Health.

**Evidência ao vivo (porta 3920, log completo capturado nesta sessão):**

```
GET  /v1/health            → 200 {status:"ok"}
GET  /readyz                → 200 {ready:true, checks:[...5 pass...]}
GET  /livez                 → 200 {alive:true}

POST /v1/workspaces         → 200 workspace criado
POST /v1/conversations      → 200 conversa criada
POST .../messages ×6        → Briefing coletado, confirmado
                             conversation.state: "resolved"
                             preparedCommandSummary.status: "prepared"

GET  /v1/planning           → [{status:"ready"}]
GET  /v1/runtime            → [{status:"validated"}]

POST /v1/execution-runs     → {state:"created", mode:"dry_run",
                                sourceGraphFingerprint:"d9084b...",
                                runtimeFingerprint:"3ac491..."}
POST /v1/execution-runs/:id/start
                             → {state:"waiting_for_approval"}
GET  /v1/execution-runs/:id/tasks
                             → research/campaign_structure/copy_generation/
                               visual_generation: "completed" (simulado, dry_run)
                               approval: gate aberto, aguardando decisão humana
                               publication: "blocked" (depende de approval)

GET  /v1/system/health      → status:"healthy", todos os checks "pass"
GET  /v1/system/release-gate → productionEnabled:false, environment:"development"
```

Nenhuma chamada real a Skill, provider social ou AI Gateway ocorreu (modo `dry_run` explicitamente selecionado, confirmado no payload de resposta em cada etapa) — consistente com "NÃO IMPLEMENTAR: novos providers/produção ativa" desta sprint.

**Evidência automatizada (Publication→Scheduling→Analytics→Audit→Health):** `test:publication` (engine+api+reliability), `test:scheduling`, `test:analytics`, `test:operations` — todos incluídos e passando dentro do `npm test` de 1754/1754 confirmado na Seção 1. Não reexecutei manualmente esses fluxos via HTTP nesta sessão por não ter profundidade equivalente de contexto arquitetural sobre esses domínios (construídos em sprints anteriores a esta) — a evidência aqui é a suíte automatizada, que eu de fato executei e confirmei verde, não uma alegação sem verificação.

## 13. Recovery Tests

Cobertura confirmada via a suíte já executada nesta sprint (não uma nova implementação — decisão desta sprint é auditar, não implementar):

- **Restart:** `operational-hardening.test.mjs` valida que uma nova instância lê o estado do circuit breaker persistido em Postgres corretamente (sobrevive a restart do processo).
- **Failover/circuit breaker:** fluxo `closed → open (falha) → cooldown → half_open → closed (sucesso)` validado com Postgres real.
- **Dead letter:** `publication-reliability.test.mjs` e `scheduling.test.mjs` cobrem criação e reprocessamento de dead-letters.
- **Reprocessamento:** endpoints `POST /v1/publications/dead-letters/:id/reprocess`, `POST /v1/scheduling/dead-letters/:id/reprocess`, `POST /v1/system/recovery/run` existem e são testados.
- **Reconciliação:** `POST /v1/publications/:id/reconcile` e o fluxo de webhook→normalização→sincronização são cobertos por `publication-reliability.test.mjs`.
- **Backup/Restore:** plano existe e é testado estruturalmente (`operational-hardening.test.mjs`), mas **sem rehearsal contra um banco temporário real** — não é uma prova de que o restore funciona de ponta a ponta, só que o plano é internamente consistente. Achado já havia sido antecipado no relatório da Sprint 23.

## 14. Evidências

1. `npm run architecture:check` → 8/8 guardas OK, 620 arquivos verificados por guarda.
2. `npm test` → 1754/1754 testes.
3. `cd web && npm run typecheck / build / test` → limpo, 21 rotas, 11/11 testes.
4. Smoke test HTTP ao vivo, Conversation → Execution (`dry_run`), Seção 12.
5. `GET /v1/system/release-gate` ao vivo → `productionEnabled: false`.
6. Nenhuma dependência circular encontrada entre os 7 domínios novos auditados nesta sprint (verificado nas duas direções via grep de imports).
7. Nenhum import do pipeline legado dentro de nenhum domínio novo, e vice-versa (garantido pelos 5 scripts de isolamento, todos passando).

## 15. Riscos Residuais

Ordenados por impacto potencial, não por severidade formal (nenhum destes bloqueia esta sprint, mas todos devem ser considerados antes de qualquer ativação de produção real):

1. **Erro invisível no frontend** — nenhuma página workspace-scoped distingue "erro real da API" de "lista vazia" (Seção 6). Isso inclui 403/permission-denied.
2. **Idempotência estreita na API** — só 2 de ~45 endpoints de escrita exigem `idempotencyKey`; retries de rede em transições de estado (approve/publish/cancel/reschedule/...) não têm proteção explícita no nível HTTP.
3. **`SECRET_MANAGER_PROVIDER=production` é um stub** — nenhum backend real (Vault/KMS/Secrets Manager) conectado; produção real de fato não pode ligar credenciais até isso existir (o que é consistente com "production bloqueada", mas é um bloqueador concreto para quando essa decisão for revisitada).
4. **`COOKIE_SECURE` default `false`** — requer disciplina operacional para nunca esquecer de setar em ambientes não-locais.
5. **Sem headers de segurança HTTP** (helmet/CSP/HSTS) — aceitável para sandbox interno, não para exposição pública.
6. **`publication_domain` (migration 0042) sub-indexado** — 5 tabelas sem índice na FK principal; degrada sob volume.
7. **Sem rehearsal real de backup/restore** — o plano existe e é testado estruturalmente, não operacionalmente.
8. **Isolamento entre domínios novos não é reforçado por CI** — Scheduling→Publication (acoplamento de valor real, não só de tipo, em `scheduling-publication-dispatcher.ts`), Webhook→Publication e Analytics→Scheduling têm import direto de função/classe, hoje protegidos só por revisão manual.
9. **`traceId` não propaga para Scheduling** — quebra a correlação de ponta a ponta nessa etapa do funil.
10. **`.env.example` desatualizado** — não lista boa parte das variáveis de AI Gateway/Meta OAuth/Operations que `api-config.ts` de fato lê; dificulta onboarding de um novo ambiente.
11. **`check-contract-drift.mjs` não cobre Execution/Publication/Credential/Webhook/Scheduling/Analytics/Operations** — só os 4 domínios mais antigos (Briefing/Conversation/Planning/Runtime) têm essa guarda.
12. **Sem `web/app/error.tsx`/`not-found.tsx`** — erros de render caem no padrão genérico do Next.js.
13. **Legado (`LOCAL_PRODUCTION`) tem um bug conhecido e deferido** (BUG-06, proporção incorreta de imagem em Story) — irrelevante para esta plataforma nova (pipelines nunca se tocam), mas ainda um item pendente do outro produto no mesmo repositório.

## 16. Checklist de Produção

Itens a fechar antes de considerar produção real (não nesta sprint):

- [ ] Conectar `SECRET_MANAGER_PROVIDER=production` a um backend real
- [ ] Forçar `COOKIE_SECURE=true` com validação de startup fora de `localhost`
- [ ] Registrar `@fastify/helmet` (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- [ ] Adicionar `idempotencyKey` às transições de estado de Publication/Scheduling/Credential que ainda não têm
- [ ] Adicionar índices às FKs de `publication_candidates`/`publication_approvals`/`publication_attempts`/`publication_failures`/`publication_dead_letters`
- [ ] Executar rehearsal de restore real contra um banco temporário dedicado
- [ ] Adicionar leitura de `error` do SWR em todas as páginas workspace-scoped, com estado dedicado de permission-denied
- [ ] Adicionar `web/app/error.tsx` e `web/app/not-found.tsx`
- [ ] Propagar `traceId` até Scheduling
- [ ] Atualizar `.env.example` para cobrir todas as variáveis lidas por `api-config.ts`
- [ ] Adicionar guardas de isolamento (ou decisão explícita de não precisar) para Scheduling↔Publication, Webhook↔Publication, Analytics↔Scheduling
- [ ] Estender `check-contract-drift.mjs` aos domínios sem essa proteção
- [ ] Job periódico de snapshot de SLO (já recomendado na Sprint 23, ainda pendente)
- [ ] Ampliar backpressure para os workers automáticos de Scheduling/Analytics/Webhooks (já recomendado na Sprint 23, ainda pendente)

## 17. Aprovação do Release Candidate 1.0

**Decisão: Release Candidate 1.0 aprovado condicionalmente para produção controlada (sandbox/staging), com production real permanecendo bloqueada.**

Justificativa: a arquitetura é estruturalmente íntegra — zero dependências circulares, zero import cruzado com o pipeline legado, todos os 8 guardas de arquitetura passando, suíte completa de 1754 testes verde, frontend limpo (typecheck/build/testes), e um smoke test ao vivo confirmou o fluxo de negócio completo (Conversation→Briefing→Planning→Runtime→Execution) funcionando corretamente em modo `dry_run`, com `ProductionGuard` confirmando ao vivo que produção real está bloqueada. Os 13 riscos residuais documentados na Seção 15 são reais, mas nenhum deles é um defeito de comportamento incorreto sob as condições atuais (produção bloqueada) — são lacunas de robustez/observabilidade/segurança a fechar **antes** de qualquer decisão de ativar produção real, não antes deste RC.

- [x] **Aprovar RC 1.0 para produção controlada** (production real continua bloqueada)
- [ ] Reprovar / exigir nova rodada de correções antes do RC

**Production permanece bloqueada.** Nenhuma Sprint 25 foi iniciada. Aguardando revisão arquitetural final.
