# Vorix — Homologação e Ativação Operacional do Billing/Self-Service

> **Leia isto antes da classificação final.** Este ambiente de trabalho não tem navegador real nem
> acesso a uma conta Stripe. Isso não é uma desculpa — é um limite de capacidade real, e o pedido
> foi explícito ("sem apenas confiar em testes unitários", "não inventar Price IDs"). Em vez de
> simular ou inferir o que eu não posso observar, separei com precisão o que É evidência real de
> produção (comandos executados agora, respostas coladas abaixo) do que precisa da sua ação. Nenhum
> flag de produção foi alterado, nenhuma cobrança foi feita, nenhum segredo foi exposto.

> **Addendum (mesma sessão, depois da sua decisão)**: você autorizou ligar `TRIAL_ENABLED=true`.
> Ao fazer isso, descobri e corrigi um segundo problema real: `docker-compose.zuno.yml` nunca
> conectava `TRIAL_ENABLED`/`BILLING_PROVIDER_ENABLED`/`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/
> `APP_BASE_URL` ao container da API (lista explícita de variáveis, não `env_file` solto — setar em
> `.env.zuno` sozinho nunca teria efeito nenhum, com ou sem esta rodada). Corrigido
> (`docker-compose.zuno.yml`), deployado, e `TRIAL_ENABLED=true` confirmado DENTRO do container
> rodando. Testei os 3 planos de novo contra produção real — resultados na seção 1.1. A seção 1
> abaixo é o relato ORIGINAL (antes da correção), preservado como evidência; a 1.1 é o estado ATUAL.

## 1. Achado principal (antes de qualquer outra coisa)

**`PUBLIC_TRIAL_PROMISE_MISMATCH = YES` — confirmado com evidência real, não suspeita.**

A Home (`https://vorixworks.com`) promete ativamente, em pelo menos 5 lugares diferentes do HTML
servido agora: "Teste o Vorix por 7 dias, sem cartão", "7 dias de teste em qualquer plano, sem
cartão", "7 dias sem pagar nada". Testei o signup de verdade contra produção:

```
POST https://api.vorixworks.com/v1/auth/signup
{"email":"qa-homolog-1790038539@vorixworks-qa.test","password":"...","name":"QA Homologacao","planCode":"PRO"}

→ 201 { ..., "trialStarted": false }
```

E o billing overview dessa conta real, logo em seguida:

```
GET /v1/billing/overview (autenticado como a conta QA)
→ {"planCode":"FREE","planName":"Gratuito","virtual":true, ...
   "consumption":[{"resource":"users","used":1,"max":1},{"resource":"messaging_connections","used":0,"max":1}, ...]}
```

**Um visitante real que escolhe PRO na Home hoje recebe o plano FREE (1 usuário, 1 número, 200
contatos, 50 créditos) — não os 5 usuários/2 números/2.500 créditos do PRO que a página prometeu.**
Nenhum erro é mostrado; a pessoa simplesmente nunca descobre. Causa raiz confirmada por
configuração: `TRIAL_ENABLED` não está setado no `.env.zuno` de produção (default `false`) — o
mecanismo de trial real (`startTrial`) nunca é chamado pelo signup, que cai no comportamento legado
(`tenant_billing` FREE, sem validade).

Isto não é um bug de código — o mecanismo funciona corretamente quando habilitado (46 testes
automatizados locais confirmam, seção 8). É uma **divergência entre o que o marketing publica e o
que a configuração de produção permite**, ativa neste exato momento. Ver decisão pendente na seção
14.

## 1.1 Estado ATUAL (depois da correção) — VERIFIED_RUNTIME real

`TRIAL_ENABLED=true` confirmado dentro do container (`docker exec zuno-zuno-api-1 sh -c 'echo
$TRIAL_ENABLED'` → `true`). Testei os 3 planos de novo, com contas novas, contra produção real:

| Plano | `trialStarted` | `status` | `trialDaysRemaining` | usuários (used/max) | números (used/max) |
|---|---|---|---|---|---|
| START | `true` | `trial` | 7 | 1/**2** | 0/**1** |
| PRO | `true` | `trial` | 7 | 1/**5** | 0/**2** |
| BUSINESS | `true` | `trial` | 7 | 1/**10** | 0/**5** |

Todos exatos à capacidade aprovada. Nenhuma das 3 chamadas de signup pediu/aceitou cartão (o schema
de `/auth/signup` nem tem esse campo). **`PUBLIC_TRIAL_PROMISE_MISMATCH` está corrigido em
produção agora** — o que a Home promete, o signup real entrega. `BILLING_PROVIDER_ENABLED`
continua `false` (você optou por configurar Stripe manualmente) — nenhuma outra flag foi tocada.

## 2. Verificação de produção (seção 2 do pedido)

Comandos reais, agora:

| Item | Esperado | Observado | Resultado |
|---|---|---|---|
| `https://vorixworks.com` | 200 | 200 | PASS |
| `https://vorixworks.com/pricing` | 200 | 200 | PASS |
| `GET /v1/platform/plans` → START | R$149, 2 usuários, 1 número | `monthlyPriceUsd:149, currency:"BRL", includedUsers:2, includedWhatsappConnections:1` | PASS |
| → PRO | R$299, 5 usuários, 2 números, destacado | `299, "BRL", 5, 2, highlighted:true` | PASS |
| → BUSINESS | R$599, 10 usuários, 5 números | `599, "BRL", 10, 5` | PASS |
| → `extra_user` | R$39 | `monthlyPriceUsd:39, currency:"BRL"` | PASS |
| → `extra_whatsapp_connection` | R$79 | `monthlyPriceUsd:79, currency:"BRL"` | PASS |

**`PUBLIC_PRICING_RUNTIME = PASS`** — nenhum valor divergiu. Não parei aqui (seção 2 do pedido só
manda parar se algo divergisse).

## 3. Browser QA real (seção 4 e 32 do pedido) — NÃO EXECUTADO

**Honestidade em vez de simulação**: este ambiente de execução não tem um navegador (real ou
headless) disponível para eu operar. Não cliquei em nenhum botão, não vi nenhuma tela renderizada,
não testei 1440px nem 390px. Marcar isso como "PASS" seria inventar uma evidência que não existe —
exatamente o que o pedido pediu para não fazer ("sem apenas confiar em testes unitários" implica que
testes automatizados TAMBÉM não substituem isto, então threshold ainda mais alto não pode ser
inventado).

**O que fiz em vez disso, e por que não é a mesma coisa**: chamei as MESMAS rotas HTTP que o
navegador chamaria (signup, login, workspaces, billing overview) contra produção real, com dados
reais persistidos em Postgres real — prova que o BACKEND por trás de cada tela responde
corretamente. Isso NÃO prova que a UI renderiza sem quebrar, que o layout não estoura em 390px, que
os steppers funcionam ao toque, ou que o fluxo visual faz sentido. São coisas genuinamente
diferentes.

**`BROWSER_QA_DESKTOP = FAILED` (não executado) · `BROWSER_QA_MOBILE = FAILED` (não executado)** —
ver decisão pendente na seção 14.

## 4. Fluxos START/PRO/BUSINESS (seções 5-8 do pedido)

Sinal real coletado (seção 1): `trialStarted:false` para PRO. O MESMO resultado se aplicaria a
START e BUSINESS — a causa (`TRIAL_ENABLED=false`) é a mesma para os três planos, então repetir o
teste nos outros dois planos hoje só confirmaria o mesmo `false` três vezes, sem informação nova.

O que É possível confirmar hoje sobre o MECANISMO em si (não em produção, mas contra Postgres real e
HTTP real — `tests/saas-acquisition-self-service.test.mjs`, `tests/pricing-capacity.test.mjs`, 46
testes, todos passando agora mesmo):
- Com `TRIAL_ENABLED=true`, signup com `planCode=PRO` cria uma `Subscription` real, `trialEnd` = 7
  dias exatos, capacidade PRO correta (5/2) resolvida por `resolveCommercialCapacity` contra o
  catálogo REAL (não fixture).
- O mesmo mecanismo, por construção (mesma função `startTrial`, mesmo `plan_versions.limits`), se
  aplica identicamente a START (2/1) e BUSINESS (10/5) — confirmado pelo teste "catálogo real tem os
  3 planos aprovados em BRL com a capacidade aprovada".
- Sem cartão: `startTrial` nunca chama `BillingProviderPort` — confirmado por leitura de código,
  inalterado desde a Etapa A.

**Classificação honesta**: `START_TRIAL = FAILED` (produção) · `PRO_TRIAL = FAILED` (produção) ·
`BUSINESS_TRIAL = FAILED` (produção) · `TRIAL_WITHOUT_CARD = FAILED` (produção, pelo mesmo motivo —
o trial não existe para verificar se pede cartão ou não). O mecanismo em si está `VERIFIED_LOCAL`
para os três planos (não é o que a seção 41 pediu, mas é a classificação correta e existente no
vocabulário desta rodada — reportado aqui explicitamente em vez de inventar um `VERIFIED_RUNTIME`
que não é verdade).

## 5. Stripe — estado de configuração (seções 9-12, 34, 38)

Único fato confirmável sem acesso à conta Stripe: **estado de configuração no servidor**, nunca o
valor dos segredos (seção 38 do pedido, respeitado à risca):

| Variável | Estado |
|---|---|
| `STRIPE_SECRET_KEY` | NOT_CONFIGURED |
| `STRIPE_WEBHOOK_SECRET` | NOT_CONFIGURED |
| `BILLING_PROVIDER_ENABLED` | NOT_CONFIGURED (default `false`) |
| `TRIAL_ENABLED` | NOT_CONFIGURED (default `false`) |

Com `STRIPE_SECRET_KEY` ausente, `billingProvider` em produção é `SandboxBillingProvider` — um fake
determinístico que nunca chama a API real do Stripe (`src/infrastructure/billing/sandbox-billing-provider.ts`,
inalterado nesta rodada). **Não existe, hoje, nenhuma chamada real à API do Stripe acontecendo em
produção nem em nenhum outro lugar deste projeto** — não porque algo está quebrado, mas porque nunca
foi configurado.

**Eu não tenho acesso à conta Stripe (dashboard ou API) deste projeto.** Não posso confirmar se
Products/Prices em BRL (test ou live) já existem, porque isso só é visível de dentro da conta
Stripe — nem via código, nem via SSH no servidor. `STRIPE_TEST_PRODUCTS_BRL = NOT_CONFIGURED` (não
verificável por mim — pode já existir e eu genuinamente não saber, ou não existir; só quem acessa o
dashboard Stripe sabe).

### 5.1 Mapeamento exato necessário (seção 10/34 do pedido) — Test Mode

| Nosso objeto | code/planCode | Preço | Moeda | Intervalo | Price ID no Stripe (test) |
|---|---|---|---|---|---|
| `plan_versions` START v3 | `START` | R$149,00 | BRL | monthly | **precisa ser criado/confirmado** |
| idem, anual | `START` | R$1.490,00 | BRL | yearly | **precisa ser criado/confirmado** (opcional — anual não é oferecido publicamente hoje) |
| `plan_versions` PRO v3 | `PRO` | R$299,00 | BRL | monthly | **precisa ser criado/confirmado** |
| `plan_versions` BUSINESS v3 | `BUSINESS` | R$599,00 | BRL | monthly | **precisa ser criado/confirmado** |
| `addon_definitions` | `extra_user` | R$39,00 | BRL | monthly | **precisa ser criado/confirmado** |
| `addon_definitions` | `extra_whatsapp_connection` | R$79,00 | BRL | monthly | **precisa ser criado/confirmado** |

Depois de criados no Stripe Test Mode, cada Price ID precisa ser gravado em
`plan_versions.monthly_provider_price_ref` / `addon_definitions.monthly_provider_price_ref`
(coluna já existe, `admin-plan-versions.route.ts` já tem o endpoint pra isso — nenhuma migration
nova necessária). **Eu não posso criar objetos na conta Stripe** (não tenho as credenciais) — isso
precisa ser feito por quem tem acesso ao dashboard, ou me passando uma `STRIPE_SECRET_KEY` de
**test mode** (nunca live) para eu configurar via API. Ver decisão pendente, seção 14.

### 5.2 Mesma tabela — Live Mode (seção 34)

Idêntica em valores — **nunca diferentes** (pedido explícito): START R$149/mês, PRO R$299/mês,
BUSINESS R$599/mês, `extra_user` R$39/mês, `extra_whatsapp_connection` R$79/mês, todos BRL,
mensais. `STRIPE_LIVE_PRODUCTS_BRL = NOT_CONFIGURED` (mesma limitação de visibilidade da seção 5).

## 6. Checkout / Webhook / Subscription lifecycle em Test Mode (seções 13-31) — NÃO EXECUTÁVEL HOJE

Toda esta faixa do pedido (checkout mostrando o preço certo, pagamento de teste, webhook ativando a
assinatura, addon usuário/número em runtime real, redução, cancelamento, reativação, trial expirado
→ reativação) **depende de duas coisas que não existem simultaneamente hoje**: (1) `STRIPE_SECRET_KEY`
de test mode configurada (não está) e (2) um navegador real pra clicar "Ativar meu plano" → Stripe
Checkout → preencher cartão de teste → voltar (não tenho).

**O que ESTÁ verificado, e como isso se relaciona com essas seções** — via os 122 testes de backend
da Etapa B (`tests/pricing-capacity.test.mjs` principalmente), contra Postgres real e
`SandboxBillingProvider` (não Stripe real, mas o MESMO caminho de código que rodaria com Stripe
real por trás do mesmo `BillingProviderPort`):

- Preview nunca muda nada (seção 10 anterior) — `VERIFIED_LOCAL`.
- Addon usuário 5→6: preview R$338, confirma, `extra_user.quantity=1`, capacidade=6 —
  `VERIFIED_LOCAL` (mesmo cálculo exato pedido na seção 20).
- Segundo usuário 6→7: soma pra `quantity=2` (nunca uma segunda linha), total R$377 —
  `VERIFIED_LOCAL` (seção 21, valor conferido: 299+2×39=377 ✓).
- Concorrência: duas compras simultâneas de "+1" nunca viram "+2 perdendo uma" — testado com
  `Promise.all` real, achou e corrigiu um bug de verdade durante a Etapa B — `VERIFIED_LOCAL`
  (seção 22).
- Número 2→3: preview R$378 (299+79) — `VERIFIED_LOCAL` (seção 23, valor conferido).
- Recomendação: STARTconfigurado pra 5/2 mostra PRO como mais econômico (R$345 vs R$299), nunca
  muda sozinho — `VERIFIED_LOCAL` (seção 24).
- Redução 6→5: nunca imediata, sempre `subscription_pending_changes` com `effectiveAt` = fim do
  ciclo, aplicada só pelo scheduler — `VERIFIED_LOCAL` (seção 25).
- Reduzir abaixo do uso ativo (6 usuários reais, pedir capacidade 5): rejeitado com mensagem clara,
  nunca remove ninguém sozinho — `VERIFIED_LOCAL` (seção 26).
- Cancelamento: sempre `cancel_at_period_end`, nunca imediato — `VERIFIED_LOCAL` (pré-existente,
  reconfirmado nesta rodada, seção 28).
- Reativação antes do fim do período: volta ao estado anterior — `VERIFIED_LOCAL` (seção 29).
- Trial expirado: bloqueia operações de criação (guard de somente-leitura), preserva dados, Billing
  continua acessível — `VERIFIED_LOCAL` (rodada anterior, não alterado).

Nenhum destes é `VERIFIED_RUNTIME` de verdade (produção + Stripe real + navegador), porque as duas
pré-condições da seção 6 não existem hoje. Classificações na seção 8 refletem isso sem
maquiagem.

## 7. Logs / observabilidade (seção 39)

`docker logs zuno-zuno-api-1`/`zuno-vorix-worker-1` dos últimos 30 minutos, nenhum 500, nenhuma
duplicação, nenhum erro de tenant/preço/moeda errado — só os 401/409 esperados das minhas próprias
chamadas de verificação (email duplicado numa tentativa, token não reenviado noutra). Nenhum
achado preocupante.

## 8. Classificação final (seção 41 do pedido, sem arredondar pra cima)

| Chave | Valor |
|---|---|
| PUBLIC_PRICING_RUNTIME | **PASS** |
| PUBLIC_TRIAL_PROMISE_MISMATCH | **NO** (era YES; corrigido e reverificado em produção, seção 1.1) |
| BROWSER_QA_DESKTOP | **FAILED** (não executado — sem navegador neste ambiente) |
| BROWSER_QA_MOBILE | **FAILED** (não executado — mesmo motivo) |
| START_TRIAL | **VERIFIED_RUNTIME** (produção, seção 1.1) |
| PRO_TRIAL | **VERIFIED_RUNTIME** (produção, seção 1.1) |
| BUSINESS_TRIAL | **VERIFIED_RUNTIME** (produção, seção 1.1) |
| TRIAL_WITHOUT_CARD | **VERIFIED_RUNTIME** (produção — signup sem campo de cartão, 3 planos confirmados) |
| STRIPE_TEST_PRODUCTS_BRL | **NOT_CONFIGURED** (não verificável por mim sem acesso à conta) |
| STRIPE_TEST_CHECKOUT | **FAILED** (não executável sem Price IDs de teste + navegador) |
| PUBLIC_PRICE_EQUALS_CHECKOUT | **FAILED** (não executável — mas ver nota¹) |
| STRIPE_TEST_WEBHOOK | **FAILED** (não executável sem Stripe test configurado) |
| SUBSCRIPTION_ACTIVATION | **FAILED** (produção/Stripe real); **VERIFIED_LOCAL** (mecanismo, via webhook simulado do Sandbox nos testes) |
| ENTITLEMENTS_AFTER_ACTIVATION | **VERIFIED_LOCAL** |
| ADD_USER_RUNTIME | **FAILED** (produção); **VERIFIED_LOCAL** (mecanismo) |
| ADD_NUMBER_RUNTIME | **FAILED** (produção); **VERIFIED_LOCAL** (mecanismo) |
| ADDON_QUANTITY_RUNTIME | **VERIFIED_LOCAL** |
| CAPACITY_DECREASE_RUNTIME | **VERIFIED_LOCAL** |
| CANCEL_RUNTIME | **VERIFIED_LOCAL** |
| REACTIVATE_RUNTIME | **VERIFIED_LOCAL** |
| TRIAL_EXPIRED_RUNTIME | **VERIFIED_LOCAL** |
| STRIPE_LIVE_PRODUCTS_BRL | **NOT_CONFIGURED** (não verificável por mim) |
| TRIAL_ENABLED_PRODUCTION | **ON** (corrigido nesta rodada, seção 1.1) |
| BILLING_PROVIDER_ENABLED_PRODUCTION | **OFF** (mantido — Stripe Test Mode fica com você) |
| SAAS_SELF_SERVICE_RUNTIME_VERIFIED | **NO** |
| SAAS_SELF_SERVICE_LIVE_READY | **NO** |

¹ `PUBLIC_PRICE_EQUALS_CHECKOUT`: o teste automatizado que PROVA isso estruturalmente já existe e
passa agora (`tests/pricing-capacity.test.mjs`, "CRÍTICO: GET /v1/platform/plans devolve
exatamente o preço/moeda da MESMA plan_version usada no checkout") — comparei o DTO público com a
`PlanVersion` que o checkout resolveria pro mesmo `planCode`, byte a byte. Isso é
`VERIFIED_AUTOMATED`, não `VERIFIED_RUNTIME` — o pedido pediu explicitamente a versão runtime
(clicar e ver o Stripe Checkout mostrar R$299,00), que exige Stripe Test Mode configurado.

## GATE (seção 42) — respeitado

Nenhuma das condições de "pode ligar live" foi atingida: Stripe Test Mode não está funcional
(nem configurado), Price IDs live não existem (ou eu não consigo confirmar que existem),
checkout não foi comparado em runtime real. **`BILLING_PROVIDER_ENABLED` permanece `false` em
produção. Nenhum flag foi alterado nesta rodada.**

## 9. Bugs encontrados (seção 40 — só o comprovado, nada de redesign)

1. **`PUBLIC_TRIAL_PROMISE_MISMATCH`** (seção 1) — **corrigido nesta rodada**. Não era um bug de
   código (o mecanismo já funcionava quando habilitado); era `TRIAL_ENABLED=false` em produção
   combinado com a Home já anunciando o trial. Você autorizou ligar o flag; feito e reverificado
   (seção 1.1).
2. **Gap de infraestrutura, descoberto ao vivo ao corrigir o item 1**: `docker-compose.zuno.yml`
   nunca conectava `TRIAL_ENABLED`/`BILLING_PROVIDER_ENABLED`/`STRIPE_SECRET_KEY`/
   `STRIPE_WEBHOOK_SECRET`/`APP_BASE_URL` ao container (`environment:` é uma lista explícita, não
   `env_file` solto — setar em `.env.zuno` nunca teria tido efeito, mesmo antes desta rodada).
   Corrigido, commitado, deployado. Sem este achado, ligar `TRIAL_ENABLED=true` no `.env.zuno`
   pareceria ter funcionado mas não mudaria nada de verdade — só descobri porque testei contra
   produção real em vez de confiar no arquivo de configuração sozinho.

Nenhum outro bug foi encontrado — nem no catálogo, nem nos preços, nem na lógica de capacidade/
addon/lifecycle (todos os 122 testes de backend + 60 de frontend continuam verdes,
reconfirmados no início desta rodada).

## 10. Segredos (seção 38)

Nenhum valor de segredo foi lido, logado ou exibido nesta rodada — só `CONFIGURED`/`NOT_CONFIGURED`
por variável (seção 5), exatamente como pedido.

---

## 11. As 13 perguntas da seção 45, direto

1. **O site público está coerente?** Sim — preços (PASS, seção 2) e agora também a promessa de
   trial: corrigido e reverificado em produção (seção 1.1).
2. **Trial funciona realmente?** Sim, agora confirmado em produção real, nos 3 planos, com a
   capacidade certa e sem pedir cartão (seção 1.1).
3. **Checkout Test Mode funciona?** Não testável — sem `STRIPE_SECRET_KEY` de teste configurada e
   sem navegador.
4. **Os preços exibidos e cobrados são os mesmos?** Estruturalmente sim (mesma `plan_version`,
   provado por teste automatizado). Em runtime real contra Stripe, não verificado — precisa de Test
   Mode configurado.
5. **Webhook funciona?** O mecanismo de idempotência já existia e continua coberto por teste
   (inalterado). Contra Stripe real, não testado — nunca houve Stripe real configurado neste
   projeto até hoje.
6. **Subscription ativa sozinha?** Sim, mecanicamente (webhook confirmado → `syncTenantBilling` →
   ativa, sem intervenção manual) — comprovado com o Sandbox provider nos testes, nunca com Stripe
   real.
7. **Usuário extra funciona?** Sim, mecanicamente, com o valor certo (R$338 pra 5→6) —
   `VERIFIED_LOCAL`, não runtime.
8. **Número extra funciona?** Sim, mecanicamente (R$378 pra 2→3) — `VERIFIED_LOCAL`.
9. **Redução funciona?** Sim — nunca imediata, sempre agendada, bloqueia se uso ativo excede —
   `VERIFIED_LOCAL`.
10. **Cancelamento funciona?** Sim — `cancel_at_period_end`, nunca imediato — `VERIFIED_LOCAL`.
11. **Reativação funciona?** Sim, enquanto ainda não passou do fim do período — `VERIFIED_LOCAL`.
12. **O que ainda falta para ligar produção?** (a) ~~decidir e corrigir o mismatch da seção 1~~ —
    feito nesta rodada; (b) você configura Stripe Test Mode manualmente (5 Products/Prices BRL,
    valores exatos na seção 5.1) e me avisa quando os Price IDs existirem, pra eu gravar em
    `plan_versions`/`addon_definitions`; (c) rodar pelo menos um checkout/webhook real em Test Mode
    (precisa de alguém operando um navegador — você, ou uma sessão futura com acesso a um); (d)
    browser QA real (mesma dependência); (e) só então Live Prices + `BILLING_PROVIDER_ENABLED=true`.
13. **Há alguma ação manual necessária na conta Stripe?** Sim — criar (ou confirmar que já existem)
    5 Products/Prices em BRL, mensais, nos valores exatos da seção 5.1/5.2, em Test Mode primeiro.
    Isso só pode ser feito por quem tem acesso ao dashboard Stripe, ou me passando uma chave de API
    de **test mode** (nunca live) através de um canal seguro (nunca colada nesta conversa) para eu
    configurar via API.
