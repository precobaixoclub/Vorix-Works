# Vorix — Auditoria de Pricing & Capacidade (Etapa A: auditoria + simulação + recomendação)

> **Etapa A apenas.** Nenhum catálogo, migration, Stripe, Home ou deploy foi alterado nesta rodada.
> O commit local `1723424` (Aquisição/Trial/Billing self-service) foi preservado integralmente —
> `git log` confirma que é o HEAD atual, nada foi revertido ou re-commitado por cima dele.

## Resumo executivo

O mecanismo de "pacote + capacidade + adicionais self-service" que o pedido descreve **já existe em
~80% na infraestrutura atual** — não precisa ser construído do zero. `AddonDefinition`/
`SubscriptionItem` (com `quantity`), os próprios addons `extra_user` e
`extra_whatsapp_connection`, e o cálculo de entitlements que soma addon sobre o limite do plano já
estão implementados, testados e seedados em produção. O que falta é: (1) preços em BRL (hoje USD,
com valores diferentes dos citados na hipótese), (2) fechar 5 gaps pontuais de robustez no
`purchaseAddon`/`removeAddon` (não é billing novo, é reuso incompleto do que já existe), e (3) **um
risco crítico e não relacionado a esta rodada, descoberto agora**: a página pública de preços lê de
um catálogo desconectado do que o checkout realmente cobra.

Recomendação de preços (detalhada na seção 3): **START R$149 · PRO R$299 · BUSINESS R$599**, com
adicional de usuário R$39/mês e adicional de número R$79/mês (os mesmos valores da hipótese) — essa
combinação é a que oferece o desconto mais consistente e persuasivo do pacote sobre a montagem avulsa
(13% a 18%), com números "redondos" (terminados em 9, convenção comum de SaaS BR).

---

## 1. O que já existe (não duplicar)

| Peça | Estado | Evidência |
|---|---|---|
| `AddonDefinition` (code, resource, increment, preço, ativo) | JÁ EXISTE | `src/domain/platform-billing/plan-version.model.ts:36-50` |
| `SubscriptionItem` com `quantity` | JÁ EXISTE | `src/domain/platform-billing/subscription.model.ts:37-46` |
| Addon `extra_user` (resource=`users`, increment=1, hoje US$15/mês) | JÁ SEEDADO | `db/migrations/0104_billing_addon_definitions.sql:18` |
| Addon `extra_whatsapp_connection` (resource=`messaging_connections`, increment=1, hoje US$39/mês) | JÁ SEEDADO | `db/migrations/0104_billing_addon_definitions.sql:19` |
| Cálculo de limite efetivo = `plan_version.limits[resource] + Σ(addon.increment × item.quantity)` | JÁ EXISTE E FUNCIONA | `src/application/billing/entitlement-use-cases.ts:43-50` |
| `users`/`messaging_connections` já são dimensões de limite (não só capability booleana) | JÁ EXISTE | `src/domain/platform-billing/plan-entitlements.model.ts:20-29` |
| Stripe: subscription item com `quantity` (criar/atualizar) | JÁ EXISTE | `stripe-billing-provider.ts:131-143` (create), `:155-163` (update — **órfão, nunca chamado**) |
| Stripe: troca de price/plano com proration controlável (`proration_behavior`) | JÁ EXISTE | `stripe-billing-provider.ts:91-105` (`changeSubscription`) |
| Franquia de IA como conceito comercial separado do usuário (`extra_ai_credits_1000`, US$25/1000) | JÁ EXISTE | `db/migrations/0104_billing_addon_definitions.sql:20` — confirma a seção 19 do pedido: usuário adicional nunca destrava IA ilimitada, já são addons distintos hoje |
| UI de comprar/remover addon em Plano e cobrança | JÁ EXISTE (funcional, com gaps de UX) | `web/app/workspaces/[workspaceId]/settings/plano/page.tsx:198-212` |

**Conclusão**: a arquitetura de dados está certa e não muda. O trabalho de uma rodada de
implementação futura é fechar gaps de comportamento, nunca recriar tabelas/conceitos.

## 2. Gaps reais encontrados (não são "billing novo" — são acabamento do que já existe)

1. **`purchaseAddon` sempre cria um `SubscriptionItem` novo, nunca soma na quantidade de um já
   existente do mesmo addon** (`lifecycle-use-cases.ts`, função `purchaseAddon`) — duas compras do
   mesmo addon viram 2 linhas em vez de 1 com `quantity=2`. `updateSubscriptionItemQuantity` já
   existe no `BillingProviderPort`/Stripe/Sandbox mas está **órfão**, nunca chamado.
2. **`POST /billing/addons` não tem `config: { idempotent: true }`** — o middleware de idempotência
   já existe no projeto (opt-in por rota), só não foi ligado nesta rota. Duplo clique em "+1 usuário"
   hoje pode cobrar duas vezes.
3. **`removeAddon` não valida uso atual antes de remover** — ao contrário de `changePlan`, que já
   tem `detectDowngradeOverage` pronto e reaproveitável. Hoje é tecnicamente possível remover
   `extra_user` mesmo com mais membros ativos do que o novo limite permitiria (contraria a seção 13
   do pedido: nunca remover automaticamente, sempre pedir resolução operacional primeiro — hoje
   simplesmente não impede).
4. **Nenhuma mudança agendada para o próximo ciclo existe** (nem no nosso código, nem via Stripe
   `SubscriptionSchedule`, que nunca é usado) — necessário para a seção 15 do pedido ("reduções no
   próximo ciclo"). Recomendação de arquitetura na seção 6.
5. **Frontend nunca mostra preview de custo antes de comprar um addon** (mostra só o preço no botão,
   sem confirmação) e **nunca permite quantidade > 1** pela UI hoje (sempre `quantity:1`, e o backend
   filtra addons já contratados da lista de "disponíveis" — `overview-use-cases.ts:77-81`).

## 3. Simulação de preços

**Premissa fixa** (hipótese do pedido, mantida): usuário adicional = R$39/mês · número adicional =
R$79/mês. **Capacidade incluída** (seção 5 do pedido): START 2 usuários/1 número · PRO 5/2 ·
BUSINESS 10/5 — já mais madura que o preço, mantida como está.

Testados os 3 conjuntos de preço pedidos (seção 7):

| Conjunto | START | PRO | BUSINESS |
|---|---|---|---|
| A | R$149 | R$299 | R$599 |
| B | R$159 | R$319 | R$629 |
| C | R$179 | R$329 | R$649 |

### 3.1 Desconto do pacote na sua própria capacidade incluída

"Preço avulso equivalente" = preço do plano imediatamente inferior + adicionais necessários para
igualar a capacidade do plano de cima (regra da seção 18: comparar sempre com o imediatamente
inferior, nunca com uma base genérica).

| Comparação | Avulso equivalente | A (149/299/599) | B (159/319/629) | C (179/329/649) |
|---|---|---|---|---|
| PRO vs START+3 usuários+1 número | START + R$196 | 345 → PRO 299 = **−46 (13,3%)** | 355 → PRO 319 = **−36 (10,1%)** | 375 → PRO 329 = **−46 (12,3%)** |
| BUSINESS vs PRO+5 usuários+3 números | PRO + R$432 | 731 → BUSINESS 599 = **−132 (18,1%)** | 751 → BUSINESS 629 = **−122 (16,2%)** | 761 → BUSINESS 649 = **−112 (14,7%)** |

Os 3 conjuntos são **matematicamente coerentes** (nenhum viola a seção 17 — pacote sempre mais barato
que montar a mesma capacidade no nível inferior). O Conjunto A dá o desconto mais forte e mais
uniforme (13%/18%); o Conjunto C é o mais conservador (12%/15%, PRO com desconto mais fraco — risco
de o cliente não perceber vantagem clara em migrar de START para PRO).

### 3.2 Matriz completa — configuração necessária × melhor opção (Conjunto A, recomendado)

Custo de cada opção = preço do plano + adicionais necessários para atingir a capacidade pedida
(nunca menos que zero). "Melhor opção" = menor custo entre as 3.

| Usuários | Números | START+extras | PRO+extras | BUSINESS+extras | Melhor opção | Preço final | Economia vs 2º melhor |
|---|---|---|---|---|---|---|---|
| 1 | 1 | **149** | 299 | 599 | START | R$149 | R$150 |
| 2 | 1 | **149** | 299 | 599 | START | R$149 | R$150 |
| 3 | 1 | **188** | 299 | 599 | START | R$188 | R$111 |
| 3 | 2 | **267** | 299 | 599 | START | R$267 | R$32 |
| 5 | 2 | 345 | **299** | 599 | PRO | R$299 | R$46 |
| 5 | 3 | 424 | **378** | 599 | PRO | R$378 | R$46 |
| 6 | 2 | 384 | **338** | 599 | PRO | R$338 | R$46 |
| 6 | 3 | 463 | **417** | 599 | PRO | R$417 | R$46 |
| 7 | 3 | 502 | **456** | 599 | PRO | R$456 | R$143 |
| 8 | 4 | 620 | **574** | 599 | PRO | R$574 | R$25 |
| 10 | 5 | 777 | 731 | **599** | BUSINESS | R$599 | R$132 |
| 12 | 5 | 855 | 809 | **677** | BUSINESS | R$677 | R$132 |
| 15 | 7 | 1130 | 1084 | **952** | BUSINESS | R$952 | R$132 |

Observação real relevante: em **8 usuários/4 números**, PRO+extras (R$574) ainda é mais barato que
BUSINESS puro (R$599) — o crossover pra BUSINESS só acontece exatamente na capacidade incluída dele
(10/5). Isso está correto e é a garantia da seção 17 funcionando (BUSINESS nunca é mais barato do que
deveria antes de "valer a pena" de verdade).

### 3.3 Mesma matriz — Conjuntos B e C (resumo, só a melhor opção)

| Usuários/Números | Conjunto B — melhor opção | Conjunto C — melhor opção |
|---|---|---|
| 1/1, 2/1 | START R$159 | START R$179 |
| 3/1 | START R$198 | START R$218 |
| 3/2 | START R$277 | START R$297 |
| 5/2 | PRO R$319 | PRO R$329 |
| 5/3 | PRO R$398 | PRO R$408 |
| 6/2 | PRO R$358 | PRO R$368 |
| 6/3 | PRO R$437 | PRO R$447 |
| 7/3 | PRO R$476 | PRO R$486 |
| 8/4 | PRO R$594 | PRO R$604 |
| 10/5 | BUSINESS R$629 | BUSINESS R$649 |
| 12/5 | BUSINESS R$707 | BUSINESS R$727 |
| 15/7 | BUSINESS R$982 | BUSINESS R$1.002 |

A ordem de qual plano é a melhor opção **não muda entre os 3 conjuntos** — só o valor final. Ou seja,
a escolha entre A/B/C é puramente uma decisão de posicionamento de preço (mais agressivo vs. mais
conservador), não uma questão de coerência matemática — os 3 são coerentes.

## 4. Crossovers (seção 8 do pedido)

Isolando cada dimensão (mantendo a outra no nível incluído do plano menor, pra achar o ponto exato):

| Transição | Dimensão | Conjunto A | Conjunto B | Conjunto C |
|---|---|---|---|---|
| START → PRO | usuários (número=1) | crossover em **6 usuários** | crossover em **7 usuários** | crossover em **6 usuários** |
| START → PRO | números (usuários=2) | crossover em **3 números** | crossover em **4 números** | crossover em **3 números** |
| PRO → BUSINESS | usuários (números=2) | crossover em **13 usuários** | crossover em **13 usuários** | crossover em **14 usuários** |
| PRO → BUSINESS | números (usuários=5) | crossover em **6 números** | crossover em **6 números** | crossover em **7 números** |

Leitura prática: um cliente START que cresce pra 6 pessoas (mesmo com só 1 número) já paga menos
indo pro PRO. Um cliente PRO só "vale a pena" migrar pra BUSINESS por causa de usuários quando passa
de 12-13 pessoas — na prática, a maioria das migrações PRO→BUSINESS vai ser puxada pela capacidade
*combinada* (users+numbers), não por uma dimensão isolada, como a matriz da seção 3.2 já mostra.

## 5. Problemas matemáticos encontrados

**Nenhum problema de incoerência interna** nos 3 conjuntos testados — todos respeitam "pacote sempre
mais barato que a capacidade equivalente no nível inferior" (seção 17), em toda a faixa de 1 a 15
usuários / 1 a 7 números testada.

**Um problema real, fora da precificação em si, encontrado durante a auditoria**: hoje **a página
pública de preços (`GET /v1/platform/plans` → Home/Pricing) lê de um catálogo TypeScript hardcoded
(`PLATFORM_PLAN_CATALOG`, `src/domain/platform-billing/platform-plan-catalog.ts:60-139`) que é
**totalmente desconectado** do catálogo real usado no checkout (`plan_versions`, o que o Stripe
efetivamente cobra via `monthlyProviderPriceRef`)**. Isso significa: se os preços novos desta seção
forem publicados só num lugar (ex.: só no catálogo TS, pra "atualizar a Home rápido"), o cliente veria
um preço na Home e seria cobrado outro no checkout — ou vice-versa. **Isso precisa ser corrigido na
próxima rodada de implementação, antes de publicar qualquer preço novo** — não é opcional, é a
diferença entre "cliente vê X, paga X" e um bug de cobrança visível publicamente.

## 6. Recomendação de arquitetura — representação no billing provider (seção 21-22)

O pedido lista 3 opções (A: subscription base + items; B: quantities no provider; C: preço calculado
internamente). **A opção B já é a que está implementada** (`SubscriptionItem.quantity` +
`stripe.subscriptionItems.create/update({ quantity })`) — é a forma nativa do Stripe pra "N unidades
de um add-on" (mesmo padrão usado por qualquer SaaS com "seats"). Recomendação: **manter a opção B,
só fechar os gaps da seção 2** (reusar `updateSubscriptionItemQuantity` em vez de sempre criar item
novo, ligar idempotência, validar uso no `removeAddon`).

**Para "reduções entram no próximo ciclo" (seção 15) sem inventar lógica financeira paralela**: Stripe
`SubscriptionSchedule` não é usado hoje em nenhum lugar do código — adicioná-lo seria uma superfície
de API nova. Alternativa mais coerente com o que o projeto já faz: o próprio `cancelAtPeriodEnd` já é
exatamente esse padrão ("marca a intenção agora, aplica no fim do ciclo, um scheduler periódico já
existente resolve" — mesmo mecanismo de `trial-expiration-scheduler.ts`). Recomendação: **um campo
`pendingQuantityChange`/`pendingRemoval` na `SubscriptionItem` (ou tabela equivalente), aplicado por
um scheduler novo no mesmo padrão do de expiração de trial** — nunca chamando Stripe antes da hora,
nunca duplicando o conceito de "agendamento" que o Stripe já tem embutido nativamente via
`SubscriptionSchedule` (que poderia substituir isso no futuro, mas não é necessário agora). Isto é
uma recomendação de arquitetura para a próxima rodada — **não implementado nesta**.

## 7. Migrations que seriam necessárias (não criadas nesta rodada)

1. Nova versão (v3) de `plan_versions` para START/PRO/BUSINESS em BRL — mesmo padrão já usado pela
   migration `0131` (nova versão, nunca `UPDATE` na versão contratada).
2. `addon_definitions` precisa de uma coluna de moeda (hoje só tem `monthly_price_usd`/
   `yearly_price_usd`, nomeadas em USD, sem campo `currency`) — ou uma tabela de versionamento de
   addon equivalente à de planos (hoje addons **não são versionados**, só `active`). Recomendação:
   dar addons o MESMO tratamento de versão que os planos já têm, em vez de inventar um mecanismo
   paralelo.
3. `subscription_items` ganhar `unique(subscription_id, addon_code)` (índice único) para permitir
   consertar o gap 2.1 (impedir 2 linhas do mesmo addon por assinatura) de forma garantida pelo
   banco, não só por disciplina de código.
4. Correção arquitetural (não é sobre preço, é sobre a fonte): `GET /v1/platform/plans` passar a ler
   de `plan_versions` (banco) em vez do catálogo TS hardcoded — elimina o risco da seção 5.

Nenhuma dessas foi criada nesta rodada (gate).

## 8. Impacto sobre o commit `1723424`

**Nenhum conflito.** O que aquele commit fez continua válido e é a fundação sobre a qual esta
mudança se apoia:
- Migration `0131` (trial 14→7 dias, nova versão de plano) **não precisa ser desfeita** — uma futura
  migration de preço BRL cria a versão 3 sobre a versão 2 (que já tem `trial_days=7`), no mesmo
  padrão aditivo.
- O wiring de signup→trial, a remoção do FREE da Home/Pricing e a estrutura visual da Home (jornada,
  pilares, FAQ) continuam corretos — só os **números exibidos** (hoje US$29/US$89/US$249, lidos do
  catálogo legado) precisarão ser trocados quando os novos preços forem aprovados, e a correção da
  seção 5 (Home ler do banco, não do TS) precisa acontecer *junto* dessa troca, não depois.
- `TRIAL_ENABLED`/`BILLING_PROVIDER_ENABLED` continuam desligados em produção, como já estavam —
  nada nesta rodada muda essa pendência.

## 9. Recomendação: trial 7 vs. 10 dias

Não alterado nesta rodada (gate explícito do pedido — "não alterar novamente enquanto esta decisão
não estiver fechada"). Only uma recomendação, sem dado de conversão real disponível pra decidir com
certeza (o produto ainda não rodou trial em produção — `TRIAL_ENABLED` nunca esteve ligado):

**Recomendo manter 7 dias.** Razões: (1) o onboarding do Vorix já torna a conexão do WhatsApp
opcional — o valor do produto (CRM, conversas, marketing) é explorável rápido, sem depender de uma
integração externa lenta; (2) 7 dias é o padrão mais comum em SaaS B2B self-service de baixo ticket
(reduz o tempo até a decisão de compra, e o custo de créditos de IA consumidos durante o trial); (3)
10 dias faria mais sentido se o "aha moment" dependesse de uma etapa lenta (ex.: aprovação de número
WhatsApp Business API, homologação) — que não é o caso aqui. Se depois de rodar em produção os dados
mostrarem conversão baixa por falta de tempo, 10 dias é uma mudança de configuração trivial (o valor
já é 100% dirigido por `plan_versions.trial_days`, nunca hardcoded).

## 10. Impacto BRL

Resumo (detalhe técnico nas seções 1-2 do relatório dos agentes de auditoria, arquivo:linha
confirmado):

- **Stripe products/prices**: preço real cobrado vem de um Price ID do Stripe
  (`monthlyProviderPriceRef`), cuja moeda é definida DENTRO do Stripe, fora do nosso banco — migrar
  pra BRL exige criar novos Price objects em BRL no Stripe (ação manual/admin, fora do código) e
  apontar a nova `plan_version` pra eles.
- **`plan_versions`**: já tem coluna `currency`, já funciona a nível de banco — **sem gap**.
- **`addon_definitions`**: **sem coluna de moeda** — gap real, migration necessária (seção 7.2).
- **Subscriptions existentes**: nunca mudam de moeda/preço automaticamente — continuam na versão
  antiga (USD) até o cliente fazer upgrade/renovar sob a nova política, exatamente como o sistema de
  versionamento já garante por design.
- **Checkout**: sem mudança de lógica — só passa a referenciar Price IDs em BRL para novas
  `plan_versions`.
- **Webhook**: `webhook-use-cases.ts:175` tem um fallback `?? "USD"` quando o Stripe não informa
  moeda no evento — inofensivo hoje (Stripe sempre informa), mas vale registrar.
- **Analytics**: nenhum evento carrega moeda/preço na propriedade hoje (verificado no vocabulário
  fechado) — sem impacto.
- **Formatadores**: `web/lib/format.ts:17-19` (`formatCurrencyCents`) já suporta BRL nativamente
  (`Intl.NumberFormat`, default já é `"BRL"`) — **sem gap**. O problema é só
  `web/features/platform-plans/api.ts:34-37` (`formatPlanPrice`), que tem `"US$ "` hardcoded como
  string literal — precisa trocar pra `formatCurrencyCents`/`Intl` dinâmico.
- **Home/Pricing/Billing**: dependem da correção da seção 5 (ler de `plan_versions`, não do catálogo
  TS) para exibir BRL de forma coerente com o que é cobrado.

## 11. Riscos

1. **(Crítico, não é sobre preço)** Preço exibido publicamente ≠ preço cobrado no checkout, hoje, por
   causa de duas fontes de dados desconectadas — precisa ser corrigido ANTES de publicar qualquer
   preço novo (seção 5).
2. `addon_definitions` sem versionamento — mudar o preço de `extra_user` hoje muda pra todo mundo
   imediatamente (mesmo problema que `plan_versions` já resolveu para planos, mas nunca foi
   estendido pra addons).
3. Sem idempotência em `POST /billing/addons` — risco de cobrança duplicada por duplo clique, hoje.
4. `removeAddon` sem validação de uso — risco de um tenant ficar com capacidade contratada menor que
   o uso real sem nenhum aviso.
5. Nenhum dado real de custo (COGS) por usuário/conexão foi usado nesta simulação — a auditoria
   validou só a COERÊNCIA INTERNA do catálogo (pacote sempre mais barato que avulso), não a margem
   real contra custo de infraestrutura/suporte. Igual à rodada anterior: não inventado, documentado
   como pendência.
6. Nenhuma conta Stripe com produtos BRL foi confirmada como existente — a criação desses objetos no
   Stripe é uma ação administrativa fora do repositório, não algo que o código resolve sozinho.

---

## Classificação da Etapa A

| Item | Resultado |
|---|---|
| Modelo de pricing recomendado | Pacote (capacidade incluída) + adicionais self-service — arquitetura já existente, reaproveitada |
| START recomendado | R$149/mês |
| PRO recomendado | R$299/mês |
| BUSINESS recomendado | R$599/mês |
| Usuário adicional | R$39/mês (mantido da hipótese) |
| Número adicional | R$79/mês (mantido da hipótese) |
| Descontos do pacote | PRO: 13,3% vs. START+extras · BUSINESS: 18,1% vs. PRO+extras |
| Crossovers | START→PRO: 6 usuários OU 3 números · PRO→BUSINESS: 13 usuários OU 6 números |
| Problemas matemáticos | Nenhum nos 3 conjuntos testados — catálogo internamente coerente |
| Trial 7 vs 10 dias | Recomendo manter 7 (sem dado de conversão real ainda; ver seção 9) |
| Impacto BRL | 2 gaps reais (moeda em addons; Home lendo catálogo errado) — nenhum bloqueador arquitetural |
| Arquitetura Stripe recomendada | Manter a já usada (subscription items + quantity) — só fechar gaps de robustez |
| Migrations necessárias | 4, nenhuma criada nesta rodada |
| Impacto sobre commit 1723424 | Nenhum conflito — extensão aditiva |
| Riscos | 6, listados na seção 11 |

**GATE respeitado**: nenhum catálogo, migration, Stripe, Home ou deploy foi alterado. Aguardando
aprovação dos preços antes de qualquer implementação.
