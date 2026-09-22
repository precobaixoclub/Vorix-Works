# Vorix — Implementação: Mercado Pago como novo BillingProvider

> Pricing/Capacity Etapa C. Continuação de `docs/vorix-billing-mercadopago-audit.md` (aprovada) —
> aqui está o que foi de fato construído. `SandboxBillingProvider`/`StripeBillingProvider` continuam
> intactos e testados; Mercado Pago foi ADICIONADO como uma terceira implementação do
> `BillingProviderPort` já existente, nunca uma arquitetura paralela. `BILLING_PROVIDER_ENABLED`
> permanece `false` em produção (não alterado nesta rodada) e nenhuma credencial Live foi usada —
> ver seção 20 (gate de produção).

## 1. Arquitetura

Nada no domínio/casos de uso comerciais mudou de forma — `Subscription`, `SubscriptionItem`,
`plan_versions`, `addon_definitions`, `subscription_pending_changes` (estendida, ver seção 10),
`capacity.model.ts`, entitlements, trial, scheduler continuam exatamente os mesmos. O
`BillingProviderPort` (`src/application/ports/billing-provider.port.ts`) ganhou:

- `readonly supportsNativeScheduledCancellation: boolean` — capability flag (mesmo padrão de
  `SocialPublisherPort.capabilities`) que diz se o provider agenda `cancel_at_period_end`
  nativamente. `true` para Stripe/Sandbox, `false` para Mercado Pago.
- `amount?: number; currency?: string` opcionais em `CreateCheckoutInput`, `CreateSubscriptionInput`,
  `ChangeSubscriptionInput`, `AddSubscriptionItemInput`, `RemoveSubscriptionItemInput`,
  `UpdateSubscriptionItemQuantityInput` — SEMPRE calculados pelo caso de uso chamador via
  `capacity.model.ts` (nunca dentro do provider). Stripe/Sandbox ignoram; Mercado Pago os usa como
  única fonte de verdade do valor cobrado.
- `providerSubscriptionId?` em `RemoveSubscriptionItemInput`/`UpdateSubscriptionItemQuantityInput` —
  Mercado Pago precisa saber QUAL `preapproval` atualizar mesmo quando a operação é "sobre um item"
  (que não existe nativamente lá, ver seção 6).
- `requestIdHeader?` em `HandleWebhookInput` — só Mercado Pago usa (entra no manifest de
  assinatura, seção 13).

`MercadoPagoBillingProvider implements BillingProviderPort` como uma classe irmã de
`StripeBillingProvider`/`SandboxBillingProvider`, mesmo arquivo por provider, mesmo padrão de
degradação graciosa (`NOT_CONFIGURED` sem credenciais, nunca derruba o boot).

## 2. Adapter (`src/infrastructure/billing/mercadopago-billing-provider.ts`)

Sem dependência nova — usa `fetch`/`crypto` nativos do Node (mesma preferência de minimalismo já
usada em outros schedulers do repositório). Todo método é `try/catch`-livre por dentro de um
helper `request()` central que nunca lança — sempre devolve `{ok:true,data}` ou
`BillingProviderFailure` categorizado (`not_configured`/`invalid_request`/`provider_unavailable`/
`not_found`/`signature_invalid`), idêntico ao contrato que Stripe/Sandbox já cumprem.

## 3. Configuração

`api-config.ts` ganhou `billing.provider: "sandbox"|"stripe"|"mercadopago"` (de `BILLING_PROVIDER`,
só considerado quando `BILLING_PROVIDER_ENABLED=true`; senão sempre `"sandbox"`, preservando o
comportamento anterior) + `mercadoPagoAccessToken`/`mercadoPagoWebhookSecret`/
`mercadoPagoNotificationUrl` (de `MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_WEBHOOK_SECRET`/
`MERCADOPAGO_NOTIFICATION_URL`). `container.ts` seleciona a implementação por
`config.billing.provider` — nunca vários booleans independentes que poderiam divergir (seção 26 do
pedido). Nenhuma destas variáveis foi definida em `.env.zuno`/`docker-compose.zuno.yml` nesta
rodada — produção continua 100% inalterada até uma decisão explícita de ativar.

## 4. Autenticação

Um único `Bearer <MERCADOPAGO_ACCESS_TOKEN>` em todo request (`Authorization` header) — sem OAuth,
sem refresh. Em Test Mode, o token começa com `TEST-`; em produção Live começaria com `APP_USR-`
(nunca usado nesta rodada). Relatório da seção 20 nunca expõe o valor, só CONFIGURED/NOT_CONFIGURED.

## 5. Preapproval (assinatura)

`createCheckout` cria uma `preapproval` via `POST /preapproval`:

```
{ reason, external_reference, payer_email, back_url, notification_url,
  auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount, currency_id },
  status: "pending" }
```

A resposta traz `init_point` (URL hospedada de autorização, devolvida como `checkoutUrl` — mesmo
papel do Stripe Checkout Session URL) e `id` (devolvido como `providerSessionId`). Nenhuma
`Subscription` é criada no Vorix aqui — só quando o webhook confirmar (mesma regra não-negociável
já usada pro Stripe, seção 8 do pedido).

## 6. Composição de preço

Mercado Pago não tem "item de linha com quantidade" — uma `preapproval` cobra um
`transaction_amount` único. `capacity.model.ts` (`resolveCommercialCapacity`) continua sendo a
ÚNICA fonte do total (base + add-ons), calculado pelo caso de uso ANTES de chamar o provider, nunca
dentro do adapter. `subscription_items` (quantidade/rastro de usuários e números) continua 100% no
banco do Vorix — o Mercado Pago só recebe o número final. `addSubscriptionItem`/
`removeSubscriptionItem`/`updateSubscriptionItemQuantity` do adapter nunca criam item nenhum de
verdade — todos convergem para `PUT /preapproval/{id}` reescrevendo `auto_recurring.
transaction_amount` para o total já recalculado. `providerItemId` devolvido por
`addSubscriptionItem` é sintético (`mercadopago-virtual-item-{subscriptionId}`, nunca existe no
Mercado Pago) só para preencher o campo já existente em `SubscriptionItem` sem quebrar o shape.

Todo caso de uso que muda capacidade/plano foi atualizado para computar `amount`/`currency` via
`resolveCommercialCapacity`/preço do catálogo ANTES de chamar o provider:
`checkout-use-cases.ts` (`startCheckout`), `lifecycle-use-cases.ts` (`purchaseAddon`, `removeAddon`,
`changePlan`), `capacity-use-cases.ts` (`applyDuePendingCapacityChanges`, redução agendada).
Stripe/Sandbox recebem os mesmos campos e simplesmente os ignoram (nenhuma mudança de
comportamento pra eles — os 61 testes de billing pré-existentes continuam passando sem alteração).

## 7. Capacity update (aumento)

Aumento de usuários/números continua imediato (`purchaseAddon`, nunca mudou) — a única diferença é
que agora ele SEMPRE passa `amount`/`currency` recalculados ao provider (seção 6). Confirmado por
teste (`mercadopago-lifecycle-scheduler.test.mjs`): PRO (R$299) + 1 `extra_user` (R$39) → provider
recebe `amount:338`; segunda compra do mesmo addon → `amount:377` (298+2×39), sempre incrementando
a MESMA linha (`upsertIncrement`), nunca duplicando item.

## 8. Upgrade/downgrade de plano

`changePlan` (upgrade imediato, downgrade com bloqueio de overage — comportamento inalterado) agora
recalcula o total do plano NOVO + add-ons já contratados via `resolveCommercialCapacity` e passa
`amount`/`currency` para `billingProvider.changeSubscription`, que no Mercado Pago vira
`PUT /preapproval/{id}` com o novo `transaction_amount`.

## 9. Downgrade / redução de capacidade

Comportamento já existente da Etapa B (nunca imediato, sempre agendado via
`subscription_pending_changes`, aplicado pelo scheduler no fim do ciclo) — só o VALOR passado ao
provider mudou: `applyDuePendingCapacityChanges` agora projeta o total pós-redução (via
`resolveCommercialCapacity` sobre os itens já com a quantidade reduzida) e passa `amount`/`currency`
na chamada `removeSubscriptionItem`/`updateSubscriptionItemQuantity`.

## 10. Cancellation scheduling

Mercado Pago não tem `cancel_at_period_end` nativo (confirmado na auditoria) — reaproveitada a
MESMA fila `subscription_pending_changes` já usada para redução de capacidade, generalizada com
uma coluna nova `change_type` (`'capacity_decrease'` default | `'cancellation'`, migration
`0133_billing_pending_change_types.sql`, aditiva: coluna com default + `addon_code`/
`from_quantity`/`target_quantity` relaxados para nullable + constraint condicional garantindo que
uma linha de cancelamento nunca tem addon/quantidade e vice-versa + índice único parcial garantindo
no máximo um cancelamento pendente por assinatura).

- `cancelSubscriptionSelfService`: quando `billingProvider.supportsNativeScheduledCancellation` é
  `false`, NUNCA chama `cancelSubscription` na hora — cria uma pendência
  `changeType:"cancellation"` com `effectiveAt = subscription.currentPeriodEnd`. Quando é `true`
  (Stripe/Sandbox), comportamento 100% inalterado (`cancel_at_period_end:true` síncrono).
- `applyDuePendingCapacityChanges` (scheduler): ao encontrar uma pendência de cancelamento vencida,
  chama `billingProvider.cancelSubscription({atPeriodEnd:false, providerSubscriptionId})` de
  verdade, marca a `Subscription` local como `cancelled` e reverte `tenant_billing` pro FREE — o
  MESMO efeito que `handleSubscriptionUpdated(deps,event,deleted:true)` já produz no caminho de
  webhook (idempotente: se o webhook assíncrono do Mercado Pago confirmar depois, é um no-op).

Ambos os caminhos confirmados por teste em `mercadopago-lifecycle-scheduler.test.mjs`.

## 11. Reactivation

`reactivateSubscription`: quando não-nativo, cancela a PENDÊNCIA (`markCancelled`) em vez de chamar
`resumeSubscription` no provider — porque nada foi de fato cancelado no Mercado Pago ainda.
Confirmado que, uma vez que o scheduler já executou o cancelamento real (assinatura virou
`status:"cancelled"`, saiu do conjunto não-terminal), `getRealActiveSubscription` já lança
`SUBSCRIPTION_NOT_FOUND` sozinho — nunca finge que a assinatura antiga é reutilizável (seção 19 do
pedido); o cliente precisa de um checkout novo. Coberto por teste explícito (reativação ANTES e
DEPOIS do cancelamento efetivo).

## 12. Payment method / portal de pagamento

Mercado Pago não expõe uma lista de "forma de pagamento salva do assinante" pela API de
`preapproval` do jeito que o Stripe expõe `paymentMethods.list` — `getPaymentMethod` devolve
`paymentMethod: undefined` explicitamente (nunca inventa um cartão fake). `createCustomerPortal`
falha explicitamente com `not_configured` e uma mensagem clara — decisão de produto já confirmada
na auditoria (seção 5): o assinante mercadopago gerencia o cartão dentro da PRÓPRIA conta/app dele;
o Vorix (Configurações → Plano e cobrança) é o control plane comercial, não um portal de cartão. O
botão "Gerenciar pagamento" do frontend já trata falhas do provider via toast de erro existente —
nenhuma tela nova foi criada (seção 29 do pedido: nenhuma alteração visual grande).

## 13. Webhook

Assinatura verificada via `x-signature` (`ts=...,v1=...`) + opcionalmente `x-request-id` — manifest
`id:{dataId};request-id:{requestId};ts:{ts};` com os segmentos `id:`/`request-id:` OMITIDOS
inteiramente (nunca deixados em branco) quando ausentes, `dataId` sempre minúsculo, HMAC-SHA256
contra `MERCADOPAGO_WEBHOOK_SECRET` (segredo de webhook — diferente do access token de API),
hex-comparado via `timingSafeEqual`. Notificação do Mercado Pago é sempre "fina"
(`{type, data:{id}}`) — o adapter sempre busca o recurso completo via `GET /preapproval/{id}` (para
`type:"subscription_preapproval"`) ou `GET /v1/payments/{id}` (para `type:"payment"`) antes de
normalizar. A rota genérica `/webhooks/billing/{providerId}` (já existente, fora de `/v1`) agora
escolhe o nome do cabeçalho de assinatura por provider (`x-signature` para Mercado Pago,
`stripe-signature` para Stripe) e sempre encaminha `x-request-id` — nenhuma rota nova.

## 14. Status mapping

`external_reference` carrega `{tenantId, planVersionId, billingInterval}` como JSON (única forma de
metadata do Mercado Pago — o Stripe tem um campo `metadata` nativo estruturado; aqui o adapter
decodifica de volta pra um objeto `data.metadata`, reaproveitando `handleCheckoutCompleted` sem
nenhuma mudança). O adapter traduz os topics/status NATIVOS do Mercado Pago pro MESMO vocabulário
canônico que `webhook-use-cases.ts` já usa (`checkout.session.completed`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`,
`invoice.payment_failed`) — só o adapter conhece a semântica específica do Mercado Pago (seção 21
do pedido), o resto da aplicação nunca vê um status/topic do Mercado Pago.

## 15. Failures

Toda falha do provider (HTTP não-2xx, corpo inválido, assinatura inválida) vira
`BillingProviderFailure` categorizada, nunca uma exceção não tratada — mesmo contrato que Stripe já
cumpre. Falha de pagamento continua tratada pela infraestrutura JÁ EXISTENTE
(`handleInvoiceEvent`/`invoice.payment_failed` → `past_due` → modo somente-leitura), sem nenhuma
política nova.

## 16. Reconciliation

Nenhum mecanismo de reconciliação NOVO foi criado — reaproveitados os já existentes:
`payment_webhook_events` (dedup por `provider`+`providerEventId`, já genérico o bastante) garante
idempotência de webhook; `subscription_items.upsertIncrement`/`incrementQuantity` (atômicos, `ON
CONFLICT`) garantem que compras concorrentes do mesmo add-on nunca se percam; o índice único
parcial novo (`subscription_pending_changes_one_cancellation_idx`) garante no máximo uma
pendência de cancelamento por assinatura sob concorrência real. Nenhuma alteração financeira fica
silenciosamente divergente: toda falha do provider em `applyCapacityChange`/`purchaseAddon`/
`changePlan`/`cancelSubscriptionSelfService` propaga como exceção ANTES de qualquer escrita local
(o provider é sempre chamado primeiro; só em caso de sucesso o banco local é atualizado) — mesmo
padrão que o Stripe já usava.

## 17. Segurança

`MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_WEBHOOK_SECRET` só em variável de ambiente/secret — nunca
commitados, nunca logados. Nenhuma credencial real foi usada nesta rodada (nenhuma conta Mercado
Pago de teste foi configurada neste ambiente). Ver seção 20 para a classificação
CONFIGURED/NOT_CONFIGURED.

## 18. Testes

- `tests/mercadopago-billing-provider.test.mjs` (11 testes) — adapter isolado com `fetch` fake
  (sem credenciais reais): `not_configured` sem token; `createCheckout` monta `auto_recurring`/
  `external_reference`/`status:pending` corretamente e nunca aceita cobrar sem `amount`/`currency`
  do chamador; `changeSubscription`/`addSubscriptionItem`/`removeSubscriptionItem`/
  `updateSubscriptionItemQuantity` convergem pro mesmo `PUT /preapproval/{id}`;
  `cancelSubscription({atPeriodEnd:true})` é rejeitado explicitamente;
  `cancelSubscription({atPeriodEnd:false})`/`resumeSubscription` funcionam; `getPaymentMethod`
  nunca inventa cartão; `createCustomerPortal` falha explícito; `handleWebhook` valida assinatura
  válida/inválida (HMAC real), mapeia `subscription_preapproval`→
  `checkout.session.completed`/`customer.subscription.deleted` e `payment`→
  `invoice.payment_succeeded`/`failed`.
- `tests/mercadopago-lifecycle-scheduler.test.mjs` (6 testes, Postgres real via pglite) — com um
  fake provider `supportsNativeScheduledCancellation:false`: cancelamento agenda pendência (nunca
  chama o provider na hora); reativação antes do vencimento cancela a pendência; scheduler aplica o
  cancelamento vencido (chama o provider, marca `cancelled`, reverte pro FREE); reativação DEPOIS do
  cancelamento efetivo exige checkout novo (`SUBSCRIPTION_NOT_FOUND`); `purchaseAddon` calcula
  `amount` certo (PRO+1 `extra_user`=338, +2=377); redução agendada aplicada pelo scheduler também
  recalcula `amount` corretamente (338 após reduzir de 2 pra 1 extra_user).
- Suíte completa (3109 testes) rodada de ponta a ponta: **3107 passaram**. As 2 falhas
  (`analytics.test.mjs`, `cli.smoke.test.mjs`) são pré-existentes e não relacionadas — arquivos não
  tocados nesta rodada, reproduzidas em isolamento antes de qualquer mudança de billing.
  `npm run typecheck`, `npm run build` e `npm run architecture:check` (raiz) passam limpos.

Cenários de preço exatos da seção 36 do pedido (START=149, PRO=299, BUSINESS=599, PRO+user=338,
PRO+number=378, PRO+2users+number=456) já eram cobertos por `pricing-capacity.test.mjs`
(inalterado, roda contra o catálogo real) — reconfirmados aqui indiretamente, já que
`resolveCommercialCapacity`/`computeCapacityCost` (a mesma fonte usada pelo Mercado Pago) não
mudaram.

## 19. Runtime QA

**Nenhuma credencial de Test Mode do Mercado Pago está configurada neste ambiente** — nenhuma conta
foi criada/fornecida nesta rodada. Por isso, nenhuma chamada real a `api.mercadopago.com` foi feita
(nem em Test Mode); toda a cobertura acima usa HTTP fake determinístico. `MERCADOPAGO_SANDBOX` =
`PENDING_CREDENTIALS` (ver classificação seção 20). QA de navegador (1440px/390px) não foi
executado, pelo mesmo motivo — não há um checkout real pra abrir sem `init_point` de verdade.

## 20. Gate de produção

| Item | Status |
|---|---|
| `MERCADOPAGO_PROVIDER` | **IMPLEMENTED** — `MercadoPagoBillingProvider` implementa o `BillingProviderPort` completo, testado com HTTP fake |
| `MERCADOPAGO_SANDBOX` | **PENDING_CREDENTIALS** — nenhuma credencial de Test Mode fornecida/configurada neste ambiente |
| `PREAPPROVAL_CREATE` | VERIFIED_RUNTIME (contra fake) — real: PENDING_CREDENTIALS |
| `WEBHOOK` | VERIFIED_RUNTIME (assinatura HMAC real, mapeamento de evento real, contra fake) |
| `SUBSCRIPTION_ACTIVATION` | VERIFIED_RUNTIME (via `handleCheckoutCompleted`, reaproveitado sem mudança) |
| `PLAN_AMOUNT` | VERIFIED_RUNTIME (`changePlan` recalcula e passa `amount`/`currency`) |
| `CAPACITY_AMOUNT_UPDATE` | VERIFIED_RUNTIME (aumento e redução, valores exatos confirmados por teste) |
| `SCHEDULED_DECREASE` | VERIFIED_RUNTIME (scheduler aplica e recalcula `amount`) |
| `SCHEDULED_CANCELLATION` | VERIFIED_RUNTIME (fila + scheduler, efeito idêntico ao webhook `deleted`) |
| `REACTIVATE_BEFORE_CANCEL` | VERIFIED_RUNTIME |
| `REACTIVATE_AFTER_CANCEL` | VERIFIED_RUNTIME (rejeita corretamente, exige checkout novo) |
| `PAYMENT_FAILURE` | VERIFIED_RUNTIME (mapeamento `invoice.payment_failed`, reaproveita `handleInvoiceEvent` sem mudança) |
| `PAYMENT_METHOD_SELF_SERVICE` | PARTIAL — `getPaymentMethod`/`createCustomerPortal` degradam graciosamente (sem portal hospedado, decisão de produto já aprovada), nunca simulam suporte que não existe |
| `PROVIDER_RECONCILIATION` | VERIFIED (mecanismos existentes reaproveitados, sem gap novo identificado) |
| `BROWSER_QA` | PENDING — sem credenciais de Test Mode não há `init_point` real pra abrir no navegador |
| `MERCADOPAGO_LIVE_READY` | **NO** — falta: credenciais de Test Mode reais para completar Sandbox/Browser QA end-to-end; `BILLING_PROVIDER_ENABLED` continua `false` em produção; nenhuma variável Mercado Pago foi adicionada a `docker-compose.zuno.yml`/`.env.zuno` nesta rodada |

Nenhuma cobrança real foi processada. Nenhuma credencial Live foi usada ou solicitada. Parando aqui
conforme instruído.

## 21. Tela de admin "Mercado Pago" (credenciais editáveis em runtime)

Adicionada depois da rodada de homologação acima — o usuário perguntou onde configurar o Mercado
Pago dentro do próprio Vorix. Antes disso, `MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_WEBHOOK_SECRET`/
`MERCADOPAGO_NOTIFICATION_URL` só existiam como variável de ambiente lida uma vez no boot, sem
nenhuma tela — ao contrário das "Chaves OpenAI/Gemini"/"Configurações (Anthropic)".

**Escopo, decisão explícita do usuário**: a tela controla SÓ as credenciais. Qual provider está
ATIVO (`sandbox`/`stripe`/`mercadopago`) continua sendo `BILLING_PROVIDER_ENABLED`/
`BILLING_PROVIDER` (env + deploy) — a rota de webhook é registrada uma vez no boot a partir do
provider ativo, e tornar isso dinâmico também foi avaliado e descartado por aumentar
significativamente o escopo/risco sem necessidade real.

**Implementação** (mesmo molde de `platform_ai_settings`/Anthropic, Sprint 25/Fase 3 — nenhuma
arquitetura nova):
- Migration `0134_billing_provider_settings.sql` — tabela singleton `billing_provider_settings`,
  access token e webhook secret gravados criptografados (AES-256-GCM, chave derivada de
  `JWT_SECRET`), só os últimos 4 caracteres expostos ao admin; `notification_url` em claro (não é
  segredo).
- `BillingProviderSettingsRepositoryPort` + `PostgresBillingProviderSettingsRepository`
  (`src/infrastructure/storage/postgres/postgres-billing-provider-settings-repository.ts`).
- `MercadoPagoBillingProviderOptions` passou a aceitar `string | (() => Promise<string|undefined>)`
  em cada campo (`accessToken`/`webhookSecret`/`notificationUrl`) — string fixa preserva 100% o
  comportamento anterior (env-only, usado quando não há Postgres/identity); uma closure é resolvida
  com cache de 60s dentro do próprio provider (mesmo padrão de `OpenAiImageProviderAdapter`), nunca
  uma consulta ao banco por chamada de API.
- `container.ts` passa a construir essas closures quando `identityRepositories.
  billingProviderSettingsRepository` existe — valor da tela vence, cai pro env quando ausente.
- Rotas `GET`/`PUT /admin/billing-provider-settings` (mesmo guard `requirePlatformAdmin` de
  `/admin/platform-ai-settings`), tela `web/app/admin/billing-provider/page.tsx` (mesmo padrão
  visual de "Configurações (Anthropic)": mascarado + last4 + remover com confirmação para os dois
  segredos; campo de texto simples para a Notification URL).
- **Achado corrigido nesta rodada**: a função que gera a "visão pública" (`toPublicSettings`,
  usada tanto aqui quanto no padrão original do Anthropic) fazia `{...settings, hasX}` — como o
  objeto passado em runtime é o `*Resolved` (que carrega os segredos em claro), o spread copiava
  essas propriedades pro JSON da resposta HTTP mesmo sem aparecerem no tipo TypeScript declarado
  (proteção só em tempo de compilação, nunca em runtime). Corrigido aqui construindo o objeto campo
  a campo. **O mesmo padrão em `platform-ai-settings.model.ts` (`toPublicSettings`, tela
  Anthropic) provavelmente tem o mesmo problema — não foi tocado nesta rodada por estar fora do
  escopo pedido, mas vale uma correção separada.**
- Testes novos: `tests/billing-provider-settings.test.mjs` (7 testes — singleton, criptografia/
  last4, `undefined` mantém/`""` remove, validação de URL, visão pública nunca vaza segredo, cache
  TTL do provider com closure vs. string fixa). `tests/mercadopago-billing-provider.test.mjs` (11)
  e `tests/mercadopago-lifecycle-scheduler.test.mjs` (6) continuam passando sem nenhuma edição —
  confirma que o refactor pra aceitar closures é 100% compatível com o uso por string simples.
- Verificação: `npm run typecheck`/`build` (raiz e `web/`) limpos, `npm run architecture:check`
  limpo, suíte completa (3116 testes) — 3113 passaram; as 3 falhas (`analytics.test.mjs`,
  `cli.smoke.test.mjs`, `inbox-resilience.test.mjs`) são flakes pré-existentes/de timing sob carga
  da suíte completa, não relacionadas a estas mudanças — todas reproduzidas em arquivos nunca
  tocados nesta rodada; a de `inbox-resilience` passou limpa quando reexecutada isolada.
