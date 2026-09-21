# Vorix — Pricing & Capacity (Etapa B: implementação)

> Continuação de [docs/vorix-pricing-capacity-audit.md](./vorix-pricing-capacity-audit.md) (Etapa A —
> auditoria + simulação + preços aprovados). Preserva integralmente o commit `1723424`
> (Aquisição/Trial/Billing self-service) e toda a infraestrutura de billing já existente — nenhum
> billing novo foi construído, nenhuma Subscription/Trial/webhook foi refeito, Stripe não foi
> substituído.

## 1. Arquitetura final

Modelo evoluído de "plano fixo" para "pacote (capacidade incluída) + adicionais self-service", 100%
em cima da infraestrutura já existente:

- `plan_versions.limits.users`/`limits.messaging_connections` — capacidade INCLUÍDA (vocabulário já
  existente, `plan-entitlements.model.ts` — nenhum campo novo).
- `addon_definitions` (`extra_user`, `extra_whatsapp_connection`) — adicionais, já existiam
  seedados desde a Fase 1 do billing; só ganharam preço/moeda BRL nesta rodada.
- `subscription_items.quantity` — quantidade contratada de cada adicional, já existente.
- **Novo**: `src/domain/platform-billing/capacity.model.ts` — resolver central puro
  (`resolveCommercialCapacity`, `computeCapacityCost`, `recommendBestPlan`,
  `validateCatalogCoherence`). Backend é a única autoridade de cálculo (seção 9/35 do pedido);
  frontend só formata o que a API devolve.
- **Novo**: `src/application/billing/capacity-use-cases.ts` — orquestra o resolver + os repositórios
  já existentes (`getCapacityState`, `previewCapacityChange`, `applyCapacityChange`,
  `cancelPendingCapacityChange`, `applyDuePendingCapacityChanges`).
- **Novo**: `subscription_pending_changes` — fila de reduções agendadas pro fim do ciclo (seção 15),
  aplicada por um scheduler periódico no mesmo padrão de `trial-expiration-scheduler.ts` — nunca
  `Stripe.SubscriptionSchedule` (superfície nova que o projeto nunca usou).

## 2. Fonte única (P0 corrigido)

**Antes**: `GET /v1/platform/plans` lia de `PLATFORM_PLAN_CATALOG` (TypeScript hardcoded,
`platform-plan-catalog.ts`), 100% desconectado de `plan_versions` (o que o checkout realmente
cobra). **Agora**: `src/interfaces/api/routes/v1/platform-plans.route.ts` lê direto de
`plan_versions` via `PlanVersionRepositoryPort.listActivePlans()` — a MESMA fonte usada por
`startCheckout`/`changePlan`. Um DTO público sanitizado (`PublicPlanDto`) é construído a partir do
`PlanVersion` real, nunca duplicando preço em outro arquivo. Fallback pro catálogo legado só quando
`planVersionRepository` não está disponível (modo sem Postgres — nunca em produção real), degradando
graciosamente sem derrubar o boot.

Teste crítico que impede regressão deste bug específico:
`tests/pricing-capacity.test.mjs` → "CRÍTICO: GET /v1/platform/plans devolve exatamente o
preço/moeda da MESMA plan_version usada no checkout" — compara byte-a-byte o DTO público com o
`PlanVersion` que o checkout resolveria para o mesmo `planCode`.

## 3. Catálogo BRL

Preços aprovados na Etapa A, aplicados via `db/migrations/0132_billing_brl_capacity_catalog.sql`:

| Plano | Preço mensal | Usuários incluídos | Números incluídos |
|---|---|---|---|
| START | R$149 | 2 | 1 |
| PRO | R$299 | 5 | 2 |
| BUSINESS | R$599 | 10 | 5 |

Adicionais: `extra_user` R$39/mês, `extra_whatsapp_connection` R$79/mês (mesmos addons já
existentes, só preço/moeda atualizados). Nenhum quarto plano — "Flex"/"Personalizado" nunca foram
criados (seção 1 do pedido); personalização acontece só via adicionais, e o piso comercial continua
sendo START (seção 28 — não existe capacidade abaixo de 2 usuários/1 número no catálogo público).

## 4. `plan_versions`

Nova versão (v3) de START/PRO/BUSINESS, `currency='BRL'`, `trial_days=7` (herdado da v2, migration
`0131` da rodada anterior — **não alterado de novo**, conforme pedido explícito de não mexer no
trial enquanto a decisão 7-vs-10 não fechar). v1 (USD, 14 dias) e v2 (USD, 7 dias) permanecem no
banco, `active=false` — qualquer assinatura antiga continua referenciando sua própria versão
histórica, nunca migrada automaticamente (seção 3/29 do pedido). `capabilities` e os demais `limits`
(contacts/ai_credits/storage_mb/automations) foram copiados integralmente da versão anterior — só
preço, moeda, `users` e `messaging_connections` mudaram nesta rodada.

## 5. Addons

`addon_definitions` ganhou uma coluna `currency` (nova, default `'USD'` — nunca existia antes;
sem ela, migrar pra BRL seria ambíguo já que o campo se chama `monthly_price_usd` mas passaria a
valer em reais). `extra_user`/`extra_whatsapp_connection` foram atualizados via `UPDATE` (não uma
nova versão — addons nunca foram versionados neste projeto, e o preço HISTÓRICO de quem já comprou
fica congelado em `subscription_items.unit_price_usd`/`currency` no momento da compra, nunca
recalculado a partir do catálogo — então o `UPDATE` é seguro e só afeta compras novas).

## 6. Capacity resolver

`src/domain/platform-billing/capacity.model.ts` — funções puras, testadas isoladamente:

- `resolveCommercialCapacity(planVersion, addons, items)` → `includedUsers/additionalUsers/
  totalUsers`, equivalente para números, `baseMonthlyAmount/addonsMonthlyAmount/
  totalMonthlyAmount` — exatamente a nomenclatura pedida na seção 9/25, sempre lida de
  `limits.users`/`limits.messaging_connections` (nunca um campo novo duplicado).
- `computeCapacityCost(planVersion, addons, {users, whatsappConnections})` → custo de uma
  capacidade HIPOTÉTICA num plano (não depende de assinatura — usado pelo preview e pelo simulador
  público).
- `recommendBestPlan(planVersions, addons, requirement)` → todas as opções elegíveis, ordenadas por
  custo, nunca decide/aplica nada sozinho.
- `validateCatalogCoherence(orderedPlans, addons)` → PASS/FAIL da regra da seção 17-18 ("pacote
  sempre mais barato que a mesma capacidade no nível inferior + adicionais").

## 7. Pricing math

Matriz completa das 13 configurações pedidas na Etapa A + os 10 cenários exatos da seção 41 desta
rodada, todos calculados contra o catálogo REAL (não fixtures sintéticas) e verificados em
`tests/pricing-capacity.test.mjs`:

| Configuração | Melhor opção | Preço |
|---|---|---|
| START 2/1 | START | R$149 |
| START+1 usuário 3/1 | START | R$188 |
| START+1 número 2/2 | START | R$228 |
| PRO 5/2 | PRO | R$299 |
| PRO+1 usuário 6/2 | PRO | R$338 |
| PRO+1 número 5/3 | PRO | R$378 |
| PRO+2 usuários+1 número 7/3 | PRO | R$456 |
| BUSINESS 10/5 | BUSINESS | R$599 |
| BUSINESS+1 usuário | BUSINESS | R$638 |
| BUSINESS+1 número | BUSINESS | R$678 |

Crossovers (seção 42): START+extras pra 5/2 = R$345 > PRO R$299 (PRO recomendado); PRO+extras pra
10/5 = R$731 > BUSINESS R$599 (BUSINESS recomendado). `validateCatalogCoherence` confirma PASS para
o catálogo real — nenhuma violação encontrada.

## 8. Preview

`previewCapacityChange` (`capacity-use-cases.ts`) — leitura pura, nunca escreve nada (testado
explicitamente: `tests/pricing-capacity.test.mjs` → "previewCapacityChange: nunca cria
SubscriptionItem nem muda a assinatura"). Devolve capacidade atual + custo da capacidade pedida no
plano atual + recomendação entre todos os planos elegíveis. Endpoint: `POST
/v1/billing/capacity/preview` (autenticado). Frontend (`CapacityCard`,
`web/app/workspaces/[workspaceId]/settings/plano/page.tsx`) dispara automaticamente quando os
steppers de usuários/números divergem do estado atual — nunca no clique isolado do stepper, só como
preview informativo; a mudança real só acontece no botão "Confirmar alteração" (seção 11).

## 9. Increase (aumento)

Imediato — `applyCapacityChange` chama `purchaseAddon` (já existente, agora corrigido — seção 12
abaixo) para o addon do recurso correspondente. Testado (`applyCapacityChange: aumento de usuários é
imediato`). Proration real depende do Stripe (`changeSubscription`/`addSubscriptionItem` já passam
`proration_behavior` quando aplicável — comportamento do provider, nunca recalculado por nós).

## 10. Scheduled decrease (redução agendada)

**Nunca imediata** (seção 15/22 do pedido). `applyCapacityChange`, ao detectar um pedido de redução,
cria uma linha em `subscription_pending_changes` com `effectiveAt = subscription.currentPeriodEnd`
— a capacidade contratual continua a mesma até lá (testado: "redução NUNCA é imediata — agenda pro
fim do ciclo, scheduler aplica depois"). `registerCapacityChangeScheduler`
(`src/interfaces/api/scheduler/capacity-change-scheduler.ts`, mesmo padrão de
`trial-expiration-scheduler.ts`) varre periodicamente e aplica as pendências vencidas via
`applyDuePendingCapacityChanges`. Cancelamento de uma pendência: `POST
/v1/billing/capacity/pending/:id/cancel` (seção 23) — testado.

## 11. Recommendation (recomendação de plano)

`recommendBestPlan` já é chamado tanto pelo preview autenticado quanto pelo simulador público —
mesma função, nunca duplicada. No `CapacityCard` (Billing interno), quando o plano recomendado é
mais barato que a configuração pedida no plano atual, aparece um aviso ("X é mais econômico para
sua estrutura — economia de R$Y/mês") — **nunca troca de plano sozinho** (seção 16-17: mudar de
plano continua exigindo confirmação humana explícita via os fluxos já existentes de upgrade/
downgrade, fora do escopo desta rodada automatizar).

## 12. Stripe representation

Auditoria (Etapa A) confirmou: `SubscriptionItem.quantity` + `stripe.subscriptionItems.create/
update({quantity})` já é a arquitetura em uso (opção B do pedido, seção 21) — mantida sem alteração
de desenho. Dois gaps fechados nesta rodada:

- **`purchaseAddon` agora soma na quantidade existente** em vez de sempre criar um item novo
  (`src/application/billing/lifecycle-use-cases.ts`). Reusa `updateSubscriptionItemQuantity`
  (método que já existia no `BillingProviderPort`/Stripe/Sandbox, mas nunca era chamado — estava
  órfão).
- **Concorrência real fechada com constraint de banco**: `subscription_items` ganhou
  `unique(subscription_id, addon_code)` (migration `0132`) + um novo método
  `SubscriptionItemRepositoryPort.upsertIncrement` (`INSERT ... ON CONFLICT (subscription_id,
  addon_code) DO UPDATE SET quantity = quantity + excluded.quantity`, atômico no Postgres). Isto foi
  descoberto como NECESSÁRIO durante o próprio desenvolvimento: uma primeira versão só com
  `incrementQuantity` (UPDATE atômico sobre uma linha já existente) ainda tinha uma corrida real —
  duas compras concorrentes do MESMO addon, nenhuma com linha ainda criada, as duas decidiam
  "criar" e viravam 2 linhas. O teste `purchaseAddon: duas compras concorrentes do mesmo addon nunca
  se perdem uma na outra` pegou isso de verdade (falhou antes do `upsertIncrement`, passa depois) —
  ver seção 19 (testes).

## 13. Webhook

Não alterado — idempotência por `(provider, providerEventId)` já existente e testada
(`tests/billing-checkout-webhook.test.mjs`, `tests/billing-webhook-route.test.mjs`, ambos passando
sem modificação). Nenhuma mudança de capacidade depende do webhook — `applyCapacityChange` confia na
resposta síncrona do `BillingProviderPort` (mesmo padrão já usado por `changePlan`/`purchaseAddon`
desde a Fase 3 do billing).

## 14. Entitlements

`resolveEffectiveEntitlements`/`getLimit`/`assertWithinLimit` não foram alterados — continuam
somando `plan_version.limits + Σ(addon.increment × item.quantity)`, exatamente como já faziam.
Depois de uma alteração de capacidade confirmada, o entitlement efetivo já reflete o novo total na
PRÓXIMA leitura (sem cache, sem intervenção manual — seção 35 do pedido), porque lê direto de
`subscription_items` a cada chamada.

## 15. Trial

**Não alterado.** Continua 7 dias (migration `0131` da rodada anterior, preservada). Nenhuma nova
migration de trial foi criada nesta rodada, conforme pedido explícito ("NÃO criar nova migration
ainda somente por opinião... NÃO alterar novamente enquanto esta decisão não estiver fechada").

## 16. Home

`web/app/page.tsx`: preços passaram a vir formatados em BRL (`formatPlanPrice`, `Intl.NumberFormat`
com a moeda real do plano — nunca mais `US$` hardcoded); linha de capacidade
(`formatCapacityLine`) substitui a antiga contagem de créditos isolada; rótulo "Mais escolhido"
trocado por "Recomendado" (seção 25/33 — decisão de produto explícita, nunca uma alegação de dado
que não existe). Nenhum card de "usuário adicional"/"número adicional" foi criado como se fosse um
plano (seção 30) — a Home continua mostrando só START/PRO/BUSINESS.

## 17. Pricing

`web/app/pricing/page.tsx`: cada card mostra capacidade incluída (`formatCapacityLine`) além do
preço; nova seção "Personalize conforme sua operação" com os 2 addons reais (preço vindo do mesmo
catálogo, nunca hardcoded) + `CapacitySimulator` (`web/components/public/CapacitySimulator.tsx`,
client component) — visitante informa usuários/números, `POST /v1/platform/plans/simulate` (público,
sem auth) devolve a recomendação usando o MESMO `recommendBestPlan` do backend autenticado. Testado
via `POST /v1/platform/plans/simulate: simulador público (sem auth) recomenda o mesmo plano que o
cálculo interno`.

## 18. Billing (Plano e cobrança)

Novo card "Sua estrutura" (`CapacityCard`,
`web/app/workspaces/[workspaceId]/settings/plano/page.tsx`) responde às 9 perguntas da seção 36:
plano atual e preço (card "Plano atual", inalterado), renovação (idem), usuários/números atuais e
limite (steppers com "incluídos"/"adicionais"), custo de adicionar (preview automático + resumo
Plano/Adicionais/Total), alteração agendada (bloco de aviso com data + botão cancelar). Linguagem
sempre não-técnica ("Sua estrutura", "incluídos", nunca "SubscriptionItem"/"addon" na tela).

## 19. Testes

`tests/pricing-capacity.test.mjs` (17 testes, novo) — matemática de preço contra o catálogo REAL
semeado (não fixtures), crossovers, validação de coerência do catálogo, soma de quantidade de addon,
**concorrência real** (`Promise.all`, pegou um bug real durante o desenvolvimento — ver seção 12),
preview nunca muda nada, aumento imediato, redução agendada + aplicação pelo scheduler, cancelar
pendência, rejeição de redução abaixo do uso ativo, rejeição de redução abaixo do mínimo do plano,
isolamento cross-tenant, e os 2 testes críticos de preço público = preço de checkout.
`web/tests/platform-plans-presentation.test.ts` (4 testes, novo) — formatação BRL e linha de
capacidade no frontend.

6 testes pré-existentes ficaram desatualizados pela mudança aprovada de capacidade incluída (PRO
8→5 usuários, START 3→2, etc.) e foram corrigidos para os novos valores — não eram bugs, eram
asserções contra números que deixaram de ser verdade por uma decisão de produto explícita
(`tests/billing-foundation.test.mjs`, `tests/billing-lifecycle.test.mjs`,
`tests/billing-lifecycle-route.test.mjs`, `tests/trial.test.mjs`); um teste de catálogo público
(`tests/platform-admin.test.mjs`) também foi corrigido para refletir FREE fora do público (já
esperado desde a rodada anterior).

**Suíte completa relevante rodando e verde**: 122 testes de backend (pricing/capacity + billing +
trial + signup + auth + onboarding + CRM) + 60 de frontend. `npm run typecheck`, `npm run build` e
`npm run architecture:check` limpos nas duas bases de código.

## 20. Browser QA

**Gap honesto, mesma limitação já documentada nas rodadas anteriores desta sessão**: este ambiente
não tem um navegador autenticado com dados reais pra clicar os 3 fluxos pedidos na seção 45 (Home →
PRO → trial → Billing → +1 usuário → confirmar; PRO → +1 número; START → simulador → recomendação
PRO). A verificação real disponível e efetivamente feita: os 3 fluxos foram exercitados PONTA A
PONTA via `app.inject` contra Postgres real (pglite) nos testes críticos da seção 19 — a MESMA
sequência de chamadas HTTP que o navegador faria, só sem o navegador em si. `typecheck`/`build`
limpos confirmam que as telas React compilam e tipam corretamente contra os novos contratos.
Screenshots não foram produzidos pela mesma razão.

## 21. Gaps

- QA em navegador real (1440/390) não foi feita — maior risco residual, igual às rodadas anteriores.
- Stripe real (produtos/preços em BRL) não foi criado — continua sem `STRIPE_SECRET_KEY` configurado
  em produção (Sandbox), então nenhuma cobrança real é possível ainda de qualquer forma; classificado
  como `PENDING_EXTERNAL_BILLING_QA` na seção 22.
- `addon_definitions` não é versionado (mudar preço de um addon afeta compras novas
  imediatamente) — documentado como decisão deliberada (seção 5), não um bug, mas é uma limitação
  real se precisar de um histórico de preço de addon auditável no futuro.
- Proration exata mostrada no preview depende do Stripe real (nunca calculada localmente) — em
  Sandbox, o preview mostra o total recalculado, mas não um valor "proporcional hoje" de verdade
  (o próprio pedido já previa isso: "quando provider conseguir calcular").
- Recomendação de plano (seção 16-17) mostra a economia mas não oferece um botão de troca imediata
  de plano dentro do `CapacityCard` — direciona pro fluxo de upgrade já existente (fora do escopo
  desta rodada expandir).
- `applyCapacityChange` processa usuários e números na mesma chamada mas cada um vira uma
  transação HTTP separada internamente (2 chamadas a `purchaseAddon`/agendamento) — não há uma
  transação de banco cobrindo os dois juntos; uma falha no segundo recurso não desfaz o primeiro
  (mesmo padrão de risco que outras operações compostas já existentes no projeto, não introduzido
  por esta rodada).

## 22. Classificação final

| Chave | Valor |
|---|---|
| PRICING_SINGLE_SOURCE | VERIFIED |
| BRL_CATALOG | VERIFIED |
| START_149 | VERIFIED |
| PRO_299 | VERIFIED |
| BUSINESS_599 | VERIFIED |
| EXTRA_USER_39 | VERIFIED |
| EXTRA_NUMBER_79 | VERIFIED |
| ADDON_QUANTITY | VERIFIED |
| ADDON_IDEMPOTENCY | VERIFIED |
| CAPACITY_PREVIEW | VERIFIED |
| CAPACITY_INCREASE | VERIFIED_LOCAL |
| CAPACITY_DECREASE | VERIFIED_LOCAL |
| SCHEDULED_DECREASE | VERIFIED |
| PLAN_RECOMMENDATION | VERIFIED |
| PUBLIC_PRICE_EQUALS_CHECKOUT | VERIFIED |
| TRIAL_7_DAYS | VERIFIED |
| TRIAL_WITHOUT_CARD | VERIFIED |
| MOBILE_PRICING | PASS* |
| SAAS_PRICING_CAPACITY_READY | NO** |

`*` MOBILE_PRICING: só "usa classes responsivas + builda sem erro" — nunca visto num viewport real
(seção 20-21).

`**` SAAS_PRICING_CAPACITY_READY = NO pelo mesmo motivo já documentado na rodada anterior:
`TRIAL_ENABLED`/`BILLING_PROVIDER_ENABLED` continuam sem confirmação de estarem ligados com valores
reais em produção, e nenhuma conta Stripe com produtos BRL foi criada — o código está pronto,
testado e (após esta rodada) deployado, mas cobrança real ainda depende de configuração externa que
só quem detém a conta Stripe pode fazer.

## Arquivos alterados/criados

**Backend:**
- `db/migrations/0132_billing_brl_capacity_catalog.sql` — **novo**: catálogo BRL, capacidade
  aprovada, `currency` em addons/items, `subscription_pending_changes`, constraint de unicidade.
- `src/domain/platform-billing/capacity.model.ts` — **novo**: resolver central.
- `src/domain/platform-billing/plan-version.model.ts`, `subscription.model.ts` — `currency` em
  `AddonDefinition`/`SubscriptionItem`; novo tipo `SubscriptionPendingChange`.
- `src/application/billing/capacity-use-cases.ts` — **novo**.
- `src/application/billing/lifecycle-use-cases.ts` — `purchaseAddon` corrigido (soma quantidade,
  upsert atômico); `removeAddon` valida uso antes de remover.
- `src/application/ports/subscription-repository.port.ts` — `incrementQuantity`,
  `upsertIncrement`, `SubscriptionPendingChangeRepositoryPort`.
- `src/infrastructure/storage/postgres/postgres-subscription-repository.ts`,
  `postgres-subscription-pending-change-repository.ts` (novo), `postgres-plan-version-repository.ts`
  — `currency`, `upsertIncrement`, `incrementQuantity`.
- `src/interfaces/api/routes/v1/platform-plans.route.ts` — reescrito (P0), simulador público.
- `src/interfaces/api/routes/v1/billing-capacity.route.ts` — **novo**.
- `src/interfaces/api/scheduler/capacity-change-scheduler.ts` — **novo**.
- `src/interfaces/api/routes/v1/index.ts`, `app.ts`, `di/container.ts`,
  `infrastructure/storage/build-identity-repositories.ts` — wiring.
- `src/domain/product-analytics/product-analytics.model.ts` — 4 eventos novos.

**Frontend:**
- `web/features/platform-plans/api.ts` — `fetchPublicCatalog`, `formatCapacityLine`,
  `simulateCapacity`, `formatPlanPrice` em BRL real.
- `web/features/billing/types.ts`, `api.ts`, `hooks.ts` — tipos/API/hook de capacidade.
- `web/components/public/CapacitySimulator.tsx` — **novo**.
- `web/app/page.tsx`, `web/app/pricing/page.tsx` — BRL, capacidade, "Recomendado".
- `web/app/workspaces/[workspaceId]/settings/plano/page.tsx` — `CapacityCard` novo.
- `web/lib/api-client.ts` — `post` aceita headers (Idempotency-Key).

**Testes:**
- `tests/pricing-capacity.test.mjs` — **novo**, 17 testes.
- `web/tests/platform-plans-presentation.test.ts` — **novo**, 4 testes.
- `tests/billing-foundation.test.mjs`, `billing-lifecycle.test.mjs`, `billing-lifecycle-route.test.mjs`,
  `trial.test.mjs`, `platform-admin.test.mjs` — corrigidos para a capacidade aprovada.

---

Commit e deploy autorizados explicitamente para esta rodada (instrução direta durante a sessão,
substituindo o "não deployar" original do pedido) — ver seção de entrega na mensagem final.
