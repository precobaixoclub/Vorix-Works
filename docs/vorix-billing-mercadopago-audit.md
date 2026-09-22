# Vorix — Auditoria: trocar o gateway de Stripe para Mercado Pago

> **Etapa A apenas — nenhum código escrito.** Você confirmou explicitamente que quer trocar de
> Stripe para Mercado Pago, superando a instrução anterior de "não substituir Stripe". Antes de
> escrever qualquer linha de `MercadoPagoBillingProvider`, este documento traduz a arquitetura real
> do Mercado Pago (pesquisada agora, com fontes) contra o `BillingProviderPort` que já existe, e
> aponta exatamente onde encaixa e onde não encaixa sem ajuste. Nada foi implementado, nenhum flag
> foi alterado, `SandboxBillingProvider`/`StripeBillingProvider` continuam intactos no código
> (trocar o provider ativo é uma decisão de configuração, não precisa apagar o código do Stripe).

## 1. Como o Mercado Pago modela assinatura (fonte real, pesquisada agora)

Mercado Pago não tem "Subscription + SubscriptionItem com quantity" como o Stripe. O modelo é
`preapproval` (a assinatura em si) + opcionalmente `preapproval_plan` (um molde reutilizável):

- Uma `preapproval` cobra um **valor único e fixo por ciclo** (`auto_recurring.transaction_amount`
  + `currency_id` + `frequency`) — **não existe conceito nativo de múltiplos itens de linha com
  quantidade dentro da mesma assinatura**, ao contrário de `stripe.subscriptionItems`.
- Status confirmados: `pending` (aguardando autorização do pagador), `authorized` (cobrando
  normalmente), `paused` (nenhuma cobrança até reativar), `cancelled`.
- **`PUT /preapproval/{id}` permite atualizar `transaction_amount`, `status` e outros campos de uma
  assinatura já existente** — isto é a peça que fecha o gap acima (seção 3).
- Checkout hospedado existe (equivalente ao Stripe Checkout) — a criação de uma `preapproval`
  devolve uma URL de autorização (`init_point`) para onde o cliente é redirecionado.
- Webhooks: header `x-signature` (HMAC, chave secreta obtida no painel "Your Integrations →
  Webhooks"), validado junto com `x-request-id` + `data.id` — mesmo formato geral do
  `stripe-signature` (HMAC com segredo por aplicação), sintaxe diferente. SDK oficial já expõe um
  validador pronto.

## 2. Contra o `BillingProviderPort` atual — método por método

| Método do port | Stripe (hoje) | Mercado Pago | Encaixe |
|---|---|---|---|
| `createCheckout` | Checkout Session, devolve `checkoutUrl` | Criar `preapproval` (ou `preapproval_plan`+`preapproval`), devolve `init_point` | **OK, mapeável** |
| `createSubscription` | — | `preapproval` já nasce "criada" ao autorizar | **OK, mapeável** |
| `changeSubscription` (troca de plano) | troca o Price do item base | `PUT /preapproval/{id}` com novo `transaction_amount` | **OK, mapeável** — mas nós que calculamos o valor (MP não tem "Price" reutilizável do mesmo jeito) |
| `cancelSubscription` (`atPeriodEnd`) | Stripe agenda nativamente | MP não tem "cancelar ao fim do período" nativo | **GAP — ver seção 4** |
| `resumeSubscription` | desfaz o agendamento | `PUT status=authorized` | **OK, mapeável** (dentro do próprio prazo) |
| `addSubscriptionItem` / `updateSubscriptionItemQuantity` / `removeSubscriptionItem` | item de linha nativo, com `quantity` | **não existe equivalente nativo** | **GAP CRÍTICO — ver seção 3** |
| `getPaymentMethod` | objeto de cartão via customer | MP expõe dado do meio de pagamento associado à preapproval/payer | **OK, mapeável, formato diferente** |
| `createCustomerPortal` | Stripe Billing Portal (hospedado, pronto) | **MP não tem um portal de autoatendimento equivalente pronto** | **GAP — ver seção 5** |
| `handleWebhook` | 1 verificador HMAC | outro verificador HMAC (`x-signature`) | **OK, mapeável** |

## 3. Gap crítico: capacidade (usuários/números) não tem "item com quantidade" nativo

Isto é o coração de tudo que a Etapa B construiu (`extra_user`/`extra_whatsapp_connection` como
`SubscriptionItem.quantity`). O Mercado Pago não representa isso nativamente numa única assinatura.

**Caminho recomendado — nenhuma arquitetura nova, reaproveita o que já existe**: nosso
`capacity.model.ts`/`capacity-use-cases.ts` já calculam `totalMonthlyAmount` (base + addons) como
UM número único, sempre — isto é exatamente o que uma `preapproval` do Mercado Pago cobra
(`transaction_amount` único). Ou seja: **não precisamos que o PROVIDER entenda "item com
quantidade"** — só precisamos que, toda vez que `applyCapacityChange` mudar a quantidade de um
addon, o `MercadoPagoBillingProvider.changeSubscription`/um novo método equivalente chame `PUT
/preapproval/{id}` com o `transaction_amount` recalculado. O rastro de "quantos usuários/números"
continua 100% em `subscription_items` (nosso banco, inalterado) — só o VALOR cobrado pelo provider
muda. Nenhuma mudança na Etapa B é necessária; só a implementação do provider muda.

## 4. Gap: cancelamento "até o fim do período"

O pedido original (e o próprio Vorix) exige `cancel_at_period_end` — acesso continua até o fim do
ciclo pago. Mercado Pago não tem essa semântica nativa (`status=cancelled` provavelmente para a
cobrança mais perto do imediato, a documentação pesquisada não confirma um agendamento nativo).

**Caminho recomendado — reaproveita um padrão que a Etapa B já construiu**: exatamente o mesmo
mecanismo de `subscription_pending_changes` (fila de mudança agendada + scheduler periódico, criado
pra redução de capacidade) resolve isto sem inventar nada novo — `cancelSubscriptionSelfService`
passa a marcar `cancelAtPeriodEnd=true` no NOSSO banco (como já faz) e só chama `PUT
status=cancelled` no Mercado Pago quando o scheduler perceber que o período realmente terminou.
Nosso `readOnly`/entitlements já são a autoridade sobre "o cliente ainda tem acesso", nunca o
provider — então isto não muda a garantia já existente, só onde o cancelamento real acontece no
gateway.

## 5. Gap: portal de autoatendimento de pagamento

Stripe tem "Billing Portal" pronto (gerenciar cartão, ver faturas). Mercado Pago não tem um
equivalente hospedado idêntico — o caminho comum é o cliente atualizar o meio de pagamento
re-autorizando a preapproval, ou uma tela própria dentro do Vorix consumindo a API do MP
diretamente. **Isto é a maior peça de UX nova**, não coberta 1:1 pelo `createCustomerPortal` de
hoje. Recomendação: manter o botão "Gerenciar pagamento" na tela de Billing, mas ele levaria a um
fluxo de re-autorização da própria preapproval (ou uma tela simples dentro do Vorix), não a uma URL
hospedada externa como hoje — precisa de decisão de produto, não é puramente técnico.

## 6. O que NÃO muda

- `Subscription`/`SubscriptionItem`/`plan_versions`/`addon_definitions`/`subscription_pending_changes`
  — schema intacto. `billingProvider` já é uma coluna de texto livre (`"stripe"`/`"sandbox"` hoje);
  passa a aceitar `"mercadopago"` sem migration.
- `capacity.model.ts`, `capacity-use-cases.ts`, `entitlement-use-cases.ts`, toda a Etapa B — intactos.
  O provider é só quem confirma o dinheiro; o resto do sistema já é agnóstico a isso (por desenho,
  desde a Fase 1 do billing).
- `plan_versions.monthlyProviderPriceRef`/`addon_definitions.monthlyProviderPriceRef` — nomeado
  "Price" (linguagem Stripe), mas é só uma `string` de referência externa; Mercado Pago usaria o
  MESMO campo pra guardar `preapproval_plan_id` (ou ficaria vazio, se optarmos por criar a
  `preapproval` direto com `transaction_amount`, sem plano associado — mais simples, recomendado).
- `payment_webhook_events` (dedup por `provider` + `providerEventId`) — já é genérico o bastante
  pra um segundo provider sem mudança de schema.
- Os 5 Price IDs de Stripe Test Mode que você já criou **deixam de ser necessários** se a decisão
  for seguir com Mercado Pago em vez de Stripe — não seria desperdício "descartar" (eles continuam
  existindo na sua conta Stripe, sem custo, e o código do `StripeBillingProvider` continua no
  repositório caso vocês queiram voltar a oferecer Stripe no futuro como opção adicional).

## 7. Recomendação

1. **Criar `MercadoPagoBillingProvider`** implementando o `BillingProviderPort` já existente (mesmo
   padrão de `StripeBillingProvider`/`SandboxBillingProvider` — nenhuma interface nova).
2. Resolver o gap da seção 3 (capacidade) computando `transaction_amount` a partir do
   `capacity.model.ts` já existente, nunca duplicando essa conta dentro do novo provider.
3. Resolver o gap da seção 4 (cancelamento agendado) reaproveitando o padrão de
   `subscription_pending_changes` já construído na Etapa B.
4. Decidir o gap da seção 5 (portal de pagamento) — decisão de produto, preciso da sua orientação.
5. Webhook novo (`/webhooks/billing/mercadopago`, mesmo padrão de rota já usado por
   `/webhooks/billing/{providerId}` — o `providerId` já é dinâmico na rota existente, nenhuma rota
   nova de fato).
6. Testes: mesmo padrão pglite + `app.inject` já usado para Stripe/Sandbox, com um
   `MercadoPagoBillingProvider` real chamando **Mercado Pago Test Mode de verdade** (credenciais de
   teste, sem cartão real) — mesmo racional de homologação que já vínhamos seguindo.

## 8. Perguntas antes de implementar qualquer coisa

1. Confirma que o valor cobrado (seção 3) pode ser um único `transaction_amount` recalculado a cada
   mudança de capacidade, em vez de itens de linha separados visíveis pro cliente dentro do
   Mercado Pago? (Internamente o Vorix continua discriminando plano+addons normalmente — isto é só
   sobre o que o MERCADO PAGO vê/cobra.)
2. Tem credenciais de **Test Mode** do Mercado Pago (Access Token + chave de assinatura de webhook)
   pra eu configurar, ou prefere configurar você mesmo no servidor (mesmo racional de segurança já
   combinado para o Stripe)?
3. Confirma a abordagem da seção 4 para cancelamento (fila de pendência + scheduler, já existente)
   em vez de tentar achar uma feature nativa equivalente no Mercado Pago que pode não existir?
4. Alguma preferência sobre o gap do portal de pagamento (seção 5)?

Nenhuma implementação começa até estas respostas. Parando aqui.
