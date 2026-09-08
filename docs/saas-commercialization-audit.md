# Auditoria — Vorix como SaaS comercializável (Billing, Checkout, Onboarding, Omnichannel)

> Auditoria de código real (não genérica) para a evolução do Vorix em SaaS autônomo de
> aquisição de clientes. Todas as afirmações abaixo foram verificadas em código, migrations e
> arquivos reais do repositório — cada uma cita arquivo/linha/tabela. Nenhuma suposição.

## 0. Resumo executivo

Existem **três sistemas de "billing/limite" parcialmente sobrepostos e não reconciliados**, e
**nenhum gateway de pagamento**:

| Sistema | Onde vive | Armazenamento | Está no caminho real de produção? |
|---|---|---|---|
| **A — Platform Billing** (Sprint 25) | `src/domain/platform-billing/`, `src/application/ports/platform-billing-repository.port.ts` | Postgres (`tenant_billing`, `tenant_credit_ledger`, `tenant_ai_usage_monthly`) | **SIM** — signup, painel admin e o AI Gateway usam isto de verdade |
| **B — Valentina** (tenancy) | `src/application/tenancy/*` | Arquivo JSON plano (`tenants.json`) | **Órfão** — `checkLimits()` nunca é chamado fora de teste; `canUseSpecialist` só é usado por 1 skill; tenants de signup público **nunca** ganham registro Valentina |
| **C — AI Gateway credits** | `src/application/ai-providers/credit-accounting.service.ts`, `src/application/ai-gateway/credit-gated-ai-gateway.ts` | Postgres (`ai_operation_types`, `ai_provider_models`, `ai_generation_ledger`) | **SIM**, robusto, com idempotência financeira real |
| **Gateway de pagamento** | — | — | **Não existe.** Confirmado por grep exaustivo + comentários explícitos no próprio código ("não existe gateway de pagamento ainda") |

**Decisão de arquitetura recomendada**: estender o Sistema A (é o único real e conectado),
generalizar a *forma* do Sistema B (o shape de `TenantPlanLimits` é bom, a implementação em JSON
não é), manter o Sistema C intacto como uma fonte de consumo especializada dentro da nova camada
de Usage. Não criar um quarto sistema do zero.

---

## 1. O que já existe — por área

### 1.1 Tenant/Workspace

- **Não existe tabela `tenants`.** Confirmado por comentário explícito em
  `src/domain/identity/identity.model.ts:15-19`: `tenantId` é uma string solta, nunca uma FK real,
  "porque a tabela `tenants` não existe em Postgres." O registro comercial mais próximo de um
  "Tenant" é a linha em `tenant_billing` (chave primária `tenant_id`).
- `Workspace` (`src/domain/workspace/workspace.model.ts:112-142`): `id, tenantId, name, kind?,
  status, createdAt, updatedAt, archivedAt?, knowledge?, campaignIds, assetLibraryId?,
  integrations, members, settings`. `WORKSPACE_STATUSES = ["active", "inactive", "archived"]`
  (linha 20) — **não existe estado "provisioning"**. Transições validadas por
  `assertValidWorkspaceTransition` (linhas 39-44).
- **Limite de workspace por tenant JÁ é aplicado hoje**, não é um gap —
  `src/application/workspace/workspace-use-cases.ts:40-61` (`createWorkspace`) consulta
  `platformBillingRepository.getTenantBilling` + `getPlatformPlan(billing.planCode).maxWorkspaces`
  e lança `WORKSPACE_LIMIT_EXCEEDED` se o tenant já está no teto. FREE=1, START/PRO/BUSINESS/
  ENTERPRISE=`null` (ilimitado) — `platform-plan-catalog.ts`.

### 1.2 Signup / provisionamento

`src/application/identity/signup-public.usecase.ts` (`signupPublic`), rota
`POST /v1/auth/signup` (`src/interfaces/api/routes/v1/auth.route.ts:175-212`). Sequência real,
hoje:

1. Verifica e-mail duplicado (`userRepository.getByEmail`).
2. Gera `tenantId` via `idGenerator("tenant")` — **gerador não-criptográfico**
   (`Date.now().toString(36) + Math.random()...`), sujeito a colisão sob concorrência real.
3. `registerUser` → cria `User` (senha com bcrypt) + `TenantMembership` com role **`admin`**
   (não `owner` — todo primeiro usuário de tenant próprio nasce "admin", hoje equivalente a
   `owner` em permissões, mas vale registrar para quando essa distinção passar a importar).
4. `workspaceRepository.create({ tenantId, name: workspaceName, kind: "default" })`.
5. `platformBillingRepository.ensureTenantBilling({ tenantId, now })` → `INSERT ... ON CONFLICT
   DO NOTHING` em `tenant_billing` com `plan_code='FREE'`, `subscription_status='trial'`, cotas do
   catálogo FREE.
6. Chama `login()` imediatamente → sessão completa (JWT + refresh token + cookies) — sem etapa de
   ativação/verificação separada.

**Gap real e concreto**: os passos 3-5 **não estão numa transação de banco** — cada repositório
chama `pool.query(...)` independentemente. Um crash entre os passos deixa um tenant parcial
(usuário existe, workspace ou billing não). Nenhuma migration/lock resolve isso hoje.

**Não existe verificação de e-mail** em lugar nenhum do código (grep exaustivo, zero hits) —
deliberadamente adiado, conforme comentário no próprio use case.

**Não existe nenhum padrão de "provisionamento" reutilizável** — a única ocorrência da palavra é
um comentário (`workspace-use-cases.ts:46`), nunca uma função/orquestração nomeada. Um fluxo de
"provisionar tenant + workspace + defaults após pagamento" será uma peça nova, construída sobre
as mesmas primitivas (`registerUser`, `workspaceRepository.create`,
`platformBillingRepository.ensureTenantBilling`), com a transação que falta hoje.

### 1.3 RBAC

`Permission`/`TENANT_ROLES`/`ROLE_PERMISSIONS` (`src/domain/identity/identity.model.ts`) — papéis
`owner/admin/editor/viewer`, ~70 permissões string-literal, incluindo todo o bloco de CRM
(`contact:*`, `deal:*`, `automation:manage`...). **Ortogonal a plano/billing hoje** — RBAC nunca
consultou `tenant_billing`. Existe também um papel de plataforma separado,
`User.isPlatformAdmin`/`AuthPrincipal.isPlatformAdmin`, checado por `requirePlatformAdmin`
(`require-principal.ts:35-41`), coluna `users.is_platform_admin` (migration 0051).

**Conclusão**: uma camada de entitlement (`canUse`/`limit`) pode ser um terceiro eixo ortogonal —
`hasPermission(role, permission) && tenantCanUse(tenantId, capability)` — sem tocar em
`identity.model.ts`. O próprio skill `ana-social-publishing` já faz esse duplo-gate hoje, só que
manualmente contra os campos crus de `tenant.planLimits` (Valentina), não via uma API central.

### 1.4 Planos e catálogo

`src/domain/platform-billing/platform-plan-catalog.ts` — **100% hardcoded em TS**,
`Object.freeze()`, sem tabela própria no banco:

```ts
export const PLATFORM_PLAN_CODES = ["FREE", "START", "PRO", "BUSINESS", "ENTERPRISE"] as const;

export type PlatformPlanDefinition = {
  code: PlatformPlanCode; name: string; tagline: string;
  monthlyPriceUsd: number; monthlyCreditsQuota: number; monthlyPublicationsQuota: number;
  maxWorkspaces: number | null; highlighted?: boolean; features: readonly string[];
};
```

`features: readonly string[]` é **confirmadamente cosmético** — só é lido em
`web/app/pricing/page.tsx:107` para renderizar texto. Nenhum use case, middleware ou rota lê esse
campo para liberar/bloquear qualquer coisa. Isto bate exatamente com o não-negociável do pedido
("nunca `if (plan === "pro")`") — hoje não existe esse `if`, mas também não existe imposição real
de capability nenhuma a partir do catálogo — só de **cota numérica** (`maxWorkspaces`, créditos).

`GET /v1/platform/plans` (público, sem auth) → `listPublicPlans()` lê direto do catálogo TS,
excluindo ENTERPRISE. **Achado de drift**: a copy da página de pricing ainda diz "100 mil tokens
de IA" — o modelo mudou pra "créditos" (FREE = 50 créditos) desde a migration 0054 e a cópia nunca
foi atualizada.

### 1.5 Créditos de IA (AI Gateway)

Sistema maduro e real. Tabelas (`db/migrations/0054_ai_provider_registry.sql`,
`0087_ai_billing_idempotency.sql`): `ai_providers`, `ai_provider_models`, `ai_operation_types`
(`credits_cost` por operação), `ai_generation_ledger` (idempotência financeira via
`idempotency_key` com índice único parcial), `tenant_ai_usage_monthly` (chave `(tenant_id,
period)`, incrementado por período — "reseta" naturalmente a cada mês novo, sem cron).

`CreditAccountingService` (`src/application/ai-providers/credit-accounting.service.ts`):
`checkAvailability(tenantId, operationTypeCode, now)`, `recordSuccess(...)`, `recordFailure(...)`.
`CreditGatedAiGateway` decora o `AiGatewayPort` real: checa disponibilidade antes, registra
consumo depois, nunca cobra duas vezes pela mesma chave de idempotência.

**Isto não deve ser tocado nem duplicado** — vira uma fonte de consumo dentro da nova camada de
Usage (`limit("ai_credits")` lê exatamente estes dados).

### 1.6 Valentina (tenancy) — órfã, mas com forma reaproveitável

`src/application/tenancy/*`. Tipo rico (`valentina.types.ts:35-45`):

```ts
export type TenantPlanLimits = {
  monthlyAiTokens: number | "unlimited"; dailyAiTokens: number | "unlimited";
  specialists: SkillCapability[] | "all"; features: string[] | "all";
  integrations: TenantSocialNetwork[] | "all";
  monthlyPublications: number | "unlimited"; monthlyCampaigns: number | "unlimited";
  monthlyImages: number | "unlimited"; monthlyVideos: number | "unlimited";
};
```

Armazenado em **arquivo JSON plano** (`LocalJsonValentinaTenantRepository`, `tenants.json`), sem
migration/tabela. `checkLimits()` é chamado **só em teste** (zero chamadas em produção). Só
`canUseSpecialist` é usado de verdade, e só dentro de `ana-social-publishing.skill.ts:393-406`,
verificando campos crus de `tenant.planLimits` manualmente. `signupPublic` **nunca** cria um
registro Valentina — todo tenant de signup público não tem representação em Valentina; o gate do
skill de publicação social simplesmente não se aplicaria a um cliente real hoje.

**Decisão**: não ressuscitar Valentina como base de entitlements (JSON não serve para produção
multi-processo/multi-instância, e está desconectada do funil real). **Generalizar a FORMA**
(`TenantPlanLimits` é um ótimo esqueleto de "capabilities + múltiplas dimensões de limite") na
nova camada, sobre Postgres. Valentina em si fica **intocada** (NÃO TOCAR) — continua servindo
Sofia/Bianca/Pedro exatamente como hoje.

### 1.7 Feature flags

**Confirmado, definitivamente: não existe nenhum feature flag por tenant hoje.** Todos os flags
encontrados (`AI_GATEWAY_ENABLED`, `AI_BRIEFING_EXTRACTION_ENABLED`, `AI_COMMERCIAL_COPILOT_ENABLED`,
`CONVERSATIONS_MODULE_ENABLED`, `PUBLICATION_PRODUCTION_ENABLED`, `META_INSTAGRAM_DM_ENABLED`,
outros ~15) são env vars globais lidas uma vez no boot (`api-config.ts`) — mesmo valor pra todo
tenant no processo. A única linha "parecida com banco" (`platform_ai_settings`) é um **singleton
global** (`id text primary key default 'singleton'`), não por tenant.

Achado colateral: `META_INSTAGRAM_DM_ENABLED` é **lido mas nunca checado em lugar nenhum** — a
rota de webhook do Instagram DM é registrada incondicionalmente. É código morto que deveria ou
virar um gate real, ou ser removido — ver seção "DEPRECATED".

### 1.8 Módulo Conversas / Messaging

- `MessagingProvider` (`src/application/ports/messaging-provider.port.ts:44-66`) é uma interface
  **plana, sem conceito de capability** — assume QR/logout universais mesmo para canais OAuth. Já
  existe precedente de capability declarada em outro port do mesmo repositório
  (`SocialPublisherPort.capabilities`, publicação de conteúdo) — padrão a copiar, não inventar.
- `messaging_connections.provider` está **restrito a `'wuzapi'` no CHECK constraint do banco**
  (migration 0080) e no union TS (`MESSAGING_PROVIDERS = ["wuzapi"]`). **Nenhum limite de
  quantidade de conexões é aplicado hoje** — `createConnection` só valida workspace + nome.
- O worker (`vorix-worker`) constrói **uma única instância de provider pro processo inteiro**
  (`inbox-worker.ts:286-288`) — nem `createConnection` nem `processOutboundMessage` despecham por
  `connection.provider`. Funciona hoje só porque existe 1 provider. A fila/exchange RabbitMQ já é
  genérica o bastante para múltiplos providers; o que precisa mudar é o `deps.provider` virar um
  registry resolvido por chamada — é uma alteração real, mas não um redesenho.
- **Instagram DM já é real e funcional** — não é stub. `send-instagram-dm.ts` faz chamada Graph
  API de verdade; o webhook (`instagram-dm-webhook.route.ts`) verifica HMAC de verdade
  (`verifyMetaWebhookSignature`) e está registrado incondicionalmente em `app.ts`. Mas é
  **totalmente isolado do Inbox/CRM** — nunca cria `contact_identities`, não usa fila, é síncrono.
  `check-crm-isolation.mjs` já proíbe esse módulo de importar CRM.
- **Facebook Messenger DM**: não existe nenhum código.
- **TikTok DM**: não existe nenhum código, e — pesquisa externa confirmada — a API de mensageria
  do TikTok for Business só é acessível via programa de "Messaging Partners" certificados (ex.:
  SleekFlow), não é uma API pública auto-serviço como a da Meta. Não pode ser prometido como
  "disponível" comercialmente sem esse processo de parceria.

### 1.9 Site / navegação / analytics / onboarding

- `web/app/page.tsx` **já é uma landing page real** (hero + 4 features + preview de planos + CTA),
  não um stub — reaproveitar como base, só reposicionar a copy (hoje fala só de "Marketing com
  IA", precisa refletir a jornada completa).
- `web/app/pricing/page.tsx`, `login`, `signup`, `privacy`, `terms`, `data-deletion` — todos reais
  e funcionais. Achado: e-mail de contato nas páginas legais é `imobilsi9.com.br`, domínio
  diferente do atual — vale corrigir antes de qualquer lançamento comercial.
- **Onboarding: não existe nenhum** — zero arquivos, zero wizard. O único "primeiro acesso" é um
  empty-state de nomear o workspace (`web/app/workspaces/page.tsx:116-143`), não um tour de
  produto.
- **Navegação é de um nível só** — `WorkspaceNavSection { label, items: WorkspaceNavItem[] }`,
  sem aninhamento. `WorkspaceSidebar.tsx` só tem UM caso especial de seção colapsável (Backstage,
  código sob medida, não reutilizável). Agrupar "Comercial"/"Marketing" como pedido exige alterar
  o tipo e o loop de render — não existe primitivo de "grupo" pronto.
- **Pipeline de Analytics existente é fechado demais para funil de produto** — `eventType` é um
  union fechado de exatamente 28 valores (`analytics.model.ts:3-32`), todos semânticos de
  publicação/execução/agendamento; o catálogo de métricas (`analytics-metric-registry.ts`) é
  ~50 definições hardcoded. Tecnicamente a tabela `analytics_events` é genérica o bastante (JSON
  livre em `dimensions`/`measurements`), mas o enum + validador + métricas são fechados em
  código. **Recomendação: log de eventos de produto PARALELO** (mesmo padrão arquitetural —
  tabela append-only, escopado por tenant/workspace — mas união de evento própria, aberta ao
  funil SaaS), não estender o enum de 28 valores.
- **Painel admin (Sprint 25) não tem MRR/ARR/churn** — só snapshot do mês corrente + ranking
  top-10 por receita. Isso é 100% a construir.

### 1.10 Webhooks / Secrets / Observabilidade

- **Duas verificações de assinatura HMAC diferentes e incompatíveis já existem**
  (`verifyMetaWebhookSignature` para Meta; `WebhookSignatureVerifier` para os webhooks sandbox do
  próprio Zuno) — nenhuma genérica. Um provedor de pagamento vai precisar de uma **terceira**,
  seguindo a forma da de Meta (`timingSafeEqual`, corpo cru em `Buffer`), não estendendo nenhuma
  das duas.
- **Existe um log de eventos de webhook genérico e reaproveitável**:
  `WebhookEventRepositoryPort` + tabelas `webhook_events`/`webhook_nonces`/`provider_events`
  (migration 0046), com dedup real via `primary key (provider_id, nonce)`. É o candidato mais
  próximo para um webhook de pagamento — ou, mais simples ainda, copiar o padrão já comprovado de
  `inbox_messages`: `unique(connection_id, external_message_id)` + `INSERT ... ON CONFLICT DO
  NOTHING` + flag `wasCreated`.
- **Secret Manager de produção JÁ é real** (contradiz `docs/deployment.md`, que está
  desatualizado): `PostgresSecretManager` (AES-256-GCM, tabela `operational_secrets`, chave
  derivada de `JWT_SECRET`) já guarda os tokens OAuth de Meta/TikTok/YouTube/Kwai em produção.
  Uma chave de API de pagamento usa exatamente o mesmo caminho — nunca vai para o frontend, nunca
  em coluna Postgres em texto puro.
- **Middleware de idempotência HTTP existe mas não serve para webhook de pagamento** — é
  keyed por header `Idempotency-Key` (que o provedor de pagamento não envia) + `tenantId:userId`
  do principal autenticado (que uma chamada de webhook não tem) + armazenamento em memória com
  TTL de 24h. Webhook de pagamento precisa de dedup durável por `event.id` do próprio provedor —
  código novo, modelado no padrão de `inbox_messages`.
- **Métricas Prometheus reais já existem** (`prom-client`, `prom-inbox-metrics.ts`) mas só
  expostas num servidor HTTP à parte dentro do processo `vorix-worker` — a API principal não tem
  rota `/metrics`. Não há Prometheus/Grafana implantado em lugar nenhum do repositório. Registrar
  novos contadores de billing no mesmo `Registry` compartilhado é a forma correta de reaproveitar.
- **Migrations**: 102 arquivos aplicados, tope atual `0102_crm_automation_run_logs.sql`. Nova
  sequência de billing começa em `0103`. Proteção contra checksum divergente já existe e é real
  (`migration-runner.ts`, erro `MIGRATION_CHECKSUM_MISMATCH`).
- **Padrão de configuração já estabelecido** (`api-config.ts:47-56`): segredo ausente + flag
  ligada → degrada graciosamente na chamada, nunca derruba o boot; formato de config inválido
  (ex.: enum desconhecido) → falha no boot. Replicar exatamente isso para
  `BILLING_PROVIDER_ENABLED`.

---

## 2. Arquitetura recomendada

### 2.1 Princípio central

**Estender `tenant_billing` (Sistema A) como o registro comercial do tenant, nunca substituí-lo.**
Ele já é lido em todo request path relevante (signup, criação de workspace, painel admin,
AI Gateway). Adicionar uma tabela `subscriptions` "por cima" dele, e recalcular/materializar as
colunas de cota de `tenant_billing` a partir dela sempre que a assinatura mudar — assim o caminho
quente ("quantos créditos este tenant tem agora?") continua sendo uma leitura de uma linha só,
sem join, e o contrato comercial de verdade (plano, versão, addons, ciclo, provedor) vive num
lugar auditável e versionado.

### 2.2 Modelo de domínio novo

```
plan_versions            -- snapshot imutável de um PlatformPlanDefinition + entitlements + limites
subscriptions            -- 1 por tenant ativo; referencia plan_versions, nunca só um "plan_code"
subscription_items       -- add-ons / itens extras da assinatura (deltas sobre os limites do plano)
payment_methods          -- cache de exibição (marca/final/validade) — nunca dado de cartão real
invoices                 -- cache de exibição sincronizado via webhook — provedor é a fonte real
billing_events           -- projeção de auditoria (subscription criada/mudou/cancelou, pagamento ok/falhou)
payment_webhook_events   -- log bruto + dedup dos eventos recebidos do provedor (padrão inbox_messages)
usage_counters           -- contagem periódica só para recursos que não são "count(*) de uma tabela existente"
```

`tenant_billing` ganha colunas novas, aditivas (`subscription_id`, `plan_version_id`) — nenhuma
coluna existente muda de significado, nenhum código que já lê `plan_code`/`subscription_status`
quebra.

### 2.3 Por que `PlanVersion` resolve o não-negociável de versionamento

Hoje, mudar `PLATFORM_PLAN_CATALOG` no código muda o plano de **todo mundo** imediatamente —
exatamente o que o pedido proíbe ("assinaturas existentes devem manter a versão contratada").
`plan_versions` snapshota entitlements+limites+preço como um JSONB imutável por
`(plan_code, version)`; uma `subscription` referencia um `plan_version_id` específico, nunca só um
nome de plano solto. Alterar o catálogo em código gera uma NOVA versão; assinantes existentes
continuam apontando para a versão antiga até fazerem upgrade/renovarem sob a nova política — isso
é decidido explicitamente, nunca por sobrescrita silenciosa.

### 2.4 Camada de Entitlement/Usage central

```ts
canUse(tenantId, capability): Promise<boolean>
limit(tenantId, resource): Promise<{ used: number; max: number | null }>
```

Resolvida a partir de `subscription.plan_version.entitlements/limits` + deltas de
`subscription_items` (add-ons). Para recursos que já são contagens de tabelas existentes
(usuários, workspaces, conexões, contatos, automações) — nunca duplicar em `usage_counters`;
contar direto com cache curto em processo (evita "query pesada em todo request", sem precisar de
Redis, que não existe nesta stack). Para créditos de IA — ler direto de
`tenant_ai_usage_monthly`/`CreditAccountingService`, sistema já existe e é correto.

### 2.5 `BillingProvider` — abstrato, com duas implementações (mesmo padrão já usado no repo)

Exatamente como `MessagingProvider` tem `WuzApiMessagingProvider` (real) +
`FakeMessagingProvider` (teste), e o AI Gateway tem `AnthropicAiModelProvider` (real) +
`FakeAiModelProvider` (teste) — o novo `BillingProvider` port ganha:

- `SandboxBillingProvider` — determinístico, sem chamada externa, usado em dev/teste (equivalente
  ao `Fake*`).
- `StripeBillingProvider` — implementação real via SDK do Stripe (o gateway cujos conceitos batem
  1:1 com os métodos pedidos: Checkout Sessions, Subscriptions, Billing Portal, Webhooks).
  **Importante**: funciona de verdade só quando `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` forem
  configurados — sem eles, degrada graciosamente (mesmo padrão de `AI_GATEWAY_ENABLED` sem
  `ANTHROPIC_API_KEY`), nunca derruba o boot. Isso significa que a arquitetura fica pronta para
  cobrança real assim que uma conta Stripe própria for criada e configurada — passo que só quem
  detém a conta pode fazer, nunca algo que eu simulo ou possuo.

### 2.6 Fluxo de checkout (reaproveitando o que já existe)

```
Landing (page.tsx, REUTILIZAR) → Pricing (REUTILIZAR) → escolher plano
  → Signup (ALTERAR: transação real + aceita planVersionId opcional)
    → tenant FREE/trial provisionado hoje mesmo (como já acontece)
      → se plano pago: createCheckout() → Stripe Checkout hospedado
        → webhook (checkout.session.completed / customer.subscription.*) é A ÚNICA fonte de
          verdade pra ativar — nunca o redirect do navegador sozinho
          → subscriptions criada/atualizada, tenant_billing recalculado, billing_events gravado
```

Sinal explícito do pedido — "ou checkout imediato, dependendo da estratégia comercial" — é
suportado pela mesma arquitetura: o webhook é sempre quem ativa, independente de o cliente ter
passado por um trial antes ou ido direto pro checkout.

### 2.7 Segurança do webhook de pagamento

Verificação HMAC nova (padrão Meta, não reaproveitando nenhum dos dois verificadores existentes)
+ tabela `payment_webhook_events` com `unique(provider, provider_event_id)` +
`INSERT ... ON CONFLICT DO NOTHING` (padrão comprovado de `inbox_messages`) + secret da API armazenada
via `SecretManagerPort`/`PostgresSecretManager` já real e em produção.

---

## 3. Classificação REUTILIZAR / ALTERAR / CRIAR / DEPRECATED / NÃO TOCAR

**REUTILIZAR (sem mudar)**
- `tenant_billing`, `platform-plan-catalog.ts` como fonte de novas versões de plano
- `CreditAccountingService`/`ai_generation_ledger`/`tenant_ai_usage_monthly` (créditos de IA)
- `SecretManagerPort`/`PostgresSecretManager`/`operational_secrets` (chave do provedor de pagamento)
- `WebhookEventRepositoryPort`/padrão `unique(...)+ON CONFLICT DO NOTHING` de `inbox_messages`
- `web/app/page.tsx`, `pricing/page.tsx`, `login`, `signup` como base de UI
- Registry `prom-client` (`prom-inbox-metrics.ts`) para novos contadores de billing
- `Permission`/`ROLE_PERMISSIONS`/RBAC (ortogonal, intocado)
- Convenção de config fail-fast-vs-degrade (`api-config.ts`)

**ALTERAR**
- `signup-public.usecase.ts` → transação real + `planVersionId` opcional
- `tenant_billing` → colunas novas aditivas (`subscription_id`, `plan_version_id`)
- `MessagingProvider` port → campo de `capabilities` (mesmo padrão de `SocialPublisherPort`)
- `messaging_connections` → CHECK constraint de `provider` deixa de ser só `'wuzapi'`
- `vorix-worker` → `deps.provider` vira registry por `connection.provider`
- `WorkspaceNavSection`/`WorkspaceSidebar.tsx` → suporte a agrupamento (Comercial/Marketing)
- `META_INSTAGRAM_DM_ENABLED` → passa a ser checado de verdade (hoje é lido e ignorado)
- `docs/deployment.md` → corrigir a seção de Secret Manager (está desatualizada)
- Copy de `pricing/page.tsx` (créditos, não "tokens") e e-mail de contato nas páginas legais

**CRIAR**
- `plan_versions`, `subscriptions`, `subscription_items`, `payment_methods`, `invoices`,
  `billing_events`, `payment_webhook_events`, `usage_counters`
- Camada `canUse()`/`limit()` central
- `BillingProvider` port + `SandboxBillingProvider` + `StripeBillingProvider`
- Verificador HMAC específico do provedor de pagamento
- Fluxo de checkout/upgrade/downgrade/cancelamento/reativação self-service
- Área "Plano e Cobrança" no produto
- Onboarding guiado (wizard + defaults + templates por segmento)
- `MetaMessengerMessagingProvider` (Facebook), oficialização de Instagram dentro do Inbox unificado
- Log de eventos de produto SaaS (funil), paralelo ao Analytics de marketing existente
- Dashboard interno de MRR/ARR/churn/trial-conversão
- Rota `/metrics` na API principal

**DEPRECATED / candidatos a correção (não é "apagar", é "consertar")**
- `META_INSTAGRAM_DM_ENABLED` como flag morta — vira funcional ou é removida
- Trecho de `docs/deployment.md` sobre Secret Manager de produção (desatualizado)
- Copy "100 mil tokens" na página de pricing

**NÃO TOCAR**
- WuzAPI/RabbitMQ/envio-recebimento do WhatsApp em si
- Envio/recebimento real do Instagram DM (Graph API) — só integrar ao Inbox, nunca refazer
- Todo o módulo CRM (Contact/Pipeline/Deal/Task/Proposal/Automação/Resultados)
- `AiGateway`/`CreditGatedAiGateway` internamente
- Valentina (`src/application/tenancy/*`) — continua servindo Sofia/Bianca/Pedro como está
- `idempotency.middleware.ts` — continua para seu uso HTTP atual, não é reaproveitado para webhook
- `analytics.model.ts` (28 eventos de marketing) — não estender, construir paralelo

---

## 4. Riscos técnicos

1. **Provisionamento sem transação** — já é um risco hoje (independente de billing); vira crítico
   assim que existir dinheiro real envolvido. Resolver na Fase 1/2, não depois.
2. **Gerador de ID não-criptográfico** (`idGenerator`) — baixo risco de colisão hoje, mas deve ser
   trocado por algo com garantia real (uuid/ulid) antes de qualquer volume de checkout real.
3. **TikTok DM depende de aprovação externa como parceiro certificado** — não pode entrar no
   mesmo cronograma de confiança que Instagram/Facebook; risco comercial de prometer prazo.
4. **Secret Manager é envelope simples (chave única derivada de `JWT_SECRET`, sem rotação)** —
   adequado para o primeiro corte de produção, mas rotacionar `JWT_SECRET` no futuro invalida
   todos os segredos armazenados, incluindo a chave do provedor de pagamento — precisa de rotina
   de re-configuração documentada antes de girar essa chave em produção.
5. **Sem Prometheus/Grafana implantado** — os contadores existem, ninguém os observa hoje;
   billing sem alerta de falha de webhook é um risco operacional real.
6. **Nenhum payment gateway real** — toda a Fase 1-3 pode ser construída e testada com o
   `SandboxBillingProvider`, mas cobrança real só liga quando uma conta Stripe própria (ou
   equivalente) existir e for configurada — isso não é algo que eu crio ou possuo.

---

## 5. Plano de fases (conforme solicitado, sem big bang)

1. **Billing Foundation** — `plan_versions`, `subscriptions`, `subscription_items`,
   `usage_counters`, camada `canUse`/`limit`, `BillingProvider` (Sandbox + Stripe), migrations.
2. **Checkout** — transação real no signup, `createCheckout`, webhook, provisionamento,
   `payment_webhook_events`, ativação.
3. **Subscription Lifecycle** — upgrade/downgrade (com detecção de overage e política de bloqueio
   sem apagar dado), add-ons, cancelamento self-service, reativação, inadimplência
   (`past_due`→modo limitado, nunca exclusão automática).
4. **Billing UX** — área "Plano e Cobrança", consumo, faturas, cartão, self-service completo.
5. **Onboarding** — wizard guiado + defaults inteligentes (equipe/pipeline/etapas/tags padrão,
   já usando o que a Fase 1-7 do CRM entregou) + templates por segmento (versionados, não
   hardcoded no domínio).
6. **Omnichannel** — capabilities por provider, Facebook Messenger oficial, unificação real do
   Instagram DM dentro do Inbox/CRM, TikTok fica com capability flag `false` documentada até
   confirmação de parceria.
7. **Commercialization** — site reposicionado, trial configurável central, product analytics do
   funil, dashboard interno de SaaS (MRR/ARR/churn), QA final de navegação.

Cada fase: migrations aditivas, `typecheck`/`build`/`architecture:check`/testes antes do commit,
exatamente como nas 7 fases do módulo Comercial já entregues.
