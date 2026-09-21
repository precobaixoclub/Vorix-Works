# Vorix — Aquisição e Contratação Self-Service (Home → Planos → Cadastro → Trial → Pagamento → Ativação → Onboarding → Uso)

> Regra principal seguida à risca: **nada de billing foi construído do zero**. A infraestrutura de
> planos/assinatura/checkout/webhook/entitlements já existia, completa e testada
> (`docs/saas-commercialization-audit.md`, "SaaS Commercialization" Fases 1-4) — só estava
> **desconectada da entrada real** (signup nunca criava trial) e **desligada em produção**
> (`TRIAL_ENABLED`/`BILLING_PROVIDER_ENABLED` nunca setados). Esta rodada fecha exatamente esses
> gaps, mais o redesenho do site público. Nenhuma migration substitui dado existente; nenhuma
> subscription é migrada de forma destrutiva.

## 1. Estado inicial (auditoria)

Três agentes de auditoria em paralelo (código real, arquivo:linha) confirmaram:

- **Billing core**: `PlanVersion` (versionado, imutável, com Stripe Price ref), `Subscription` real,
  `StripeBillingProvider` + `SandboxBillingProvider`, webhook idempotente
  (`payment_webhook_events`, `unique(provider, provider_event_id)`), `resolveEffectiveEntitlements`
  — **tudo já existia e funcionava** (`src/domain/platform-billing/`, `src/application/billing/`,
  `src/infrastructure/billing/`).
- **Gap real #1**: `signupPublic` (`src/application/identity/signup-public.usecase.ts:37-75`) só
  criava o registro legado `tenant_billing` (`plan_code='FREE'`, `subscription_status='trial'`,
  **sem data de expiração — nunca vence sozinho**). O mecanismo de trial "de verdade"
  (`startTrial`, `Subscription` real com `trialEnd`) só existia via `POST /v1/billing/start-trial`,
  **nunca chamado automaticamente pelo signup**.
- **Gap real #2**: `web/app/signup/page.tsx:27` lia `?plan=` da URL mas **nunca enviava ao
  backend** — o schema de `/auth/signup` nem tinha campo `planCode`.
- **Gap real #3**: produção rodava com `TRIAL_ENABLED`/`BILLING_PROVIDER_ENABLED` ausentes do
  `.env.zuno` (confirmado via SSH) → ambos `false` por padrão (`api-config.ts:307,311`) — o sistema
  inteiro de billing estava **fisicamente pronto e desligado**.
- **Gap real #4**: Home/Pricing ofereciam um plano **FREE permanente** ("Começar grátis", preço
  "Grátis") — direto contra a decisão comercial desta rodada (seção 1 do pedido).
- **Gap real #5**: copy técnica vazando pro usuário final — `web/app/page.tsx:109` ("X planos reais
  carregados da API de pricing"), `web/app/pricing/page.tsx:28` ("Sem anual decorativo enquanto o
  catálogo não entregar ciclo anual"), `plano/page.tsx` ("Valor anual não informado pela API").
- **Gap real #6**: enforcement de entitlements — `assertCanUse`/`assertWithinLimit` só eram
  chamados no onboarding; nenhuma rota de criação operacional (Contato/Negócio/Tarefa/Proposta/
  Automação) checava modo somente-leitura. Um tenant com trial vencido continuava criando
  livremente via API.
- **O que já estava correto e foi 100% reaproveitado, sem tocar**: catálogo de planos (preços já
  definidos: START US$29, PRO US$89 destacado, BUSINESS US$249 — nenhum valor novo inventado),
  `moveDealStage`/checkout/webhook/upgrade/downgrade/cancelamento/reativação, Product Analytics
  (`recordProductEvent`, vocabulário fechado de 30 eventos já incluindo `trial_started`/
  `trial_expired`/`signup_completed`), onboarding (5 passos, WhatsApp já opcional).

## 2. Home — antes

`web/app/page.tsx`: hero real ("Marketing, atendimento e vendas conectados por IA."), preview de
produto mockado, jornada de 5 passos (Criar/Publicar/Conversar/Vender/Medir), 3 pilares (Marketing/
Conversas/CRM), seção Vorix Intelligence, grid "Why", teaser de planos com a string de debug citada
acima. CTA principal: "Criar conta" (nunca mencionava trial/cartão).

## 3. Home — nova

Mesma fundação visual (tokens, grid de fundo, preview de produto — nada de vídeo pesado/animação
custosa, seção 59 do pedido), com:
- Hero: CTA trocado para "Testar por 7 dias" + "Sem cartão de crédito para começar." abaixo dos
  botões; subheadline reescrita ("Centralize sua operação comercial...").
- Nova seção "O problema" (seção 10 do pedido): "Marketing em uma ferramenta. WhatsApp em outra...
  Com o Vorix, tudo se conecta."
- Jornada expandida pros 7 passos pedidos (seção 11): Marketing → Conversa → Contato → Negócio →
  Follow-up → Proposta → Venda.
- Pilares expandidos de 3 para 6 (seção 12): Marketing, Conversas, CRM Comercial, Propostas, IA,
  Resultados.
- Seção de planos: 3 cards reais (START/PRO/BUSINESS, PRO com "Mais escolhido") com CTA "Testar
  {nome}" cada, puxados do MESMO catálogo público (nunca hardcoded) — string de debug removida.
- FAQ nova (seção 55, 7 perguntas — texto reflete exatamente o comportamento implementado, não
  aspiracional).
- CTA final novo (seção 56): "Pronto para conectar marketing, atendimento e vendas? Teste o Vorix
  por 7 dias. [Começar meu teste]".

Arquivo: `web/app/page.tsx`.

## 4. Pricing

`web/app/pricing/page.tsx`: copy técnica removida ("planos reais"/"API pública"/"sem anual
decorativo"); mensagem trocada para "Todo plano inclui 7 dias de teste, sem cartão de crédito."; CTA
por plano trocado para "Testar {nome} por 7 dias"; bloco final explica o fluxo de ativação em
linguagem de cliente ("a cobrança só começa depois da sua confirmação"). Continua buscando os planos
de `GET /v1/platform/plans` (fonte única, seção 21) — zero preço nesta página é hardcoded.

## 5. Planos

START / PRO / BUSINESS — os mesmos 3 já existentes no catálogo, sem alteração de features/limites
(auditoria não encontrou motivo pra mudar a segmentação já definida:
`src/domain/platform-billing/platform-plan-catalog.ts:60-139`, espelhada em `plan_versions`). FREE
continua existindo **só no backend** (tenants legados, `ensureTenantBilling` — mudar isso é uma
migração de dado maior, fora de escopo aqui, seção 40 "não apagar dados"), mas
`listPublicPlans()` agora exclui `FREE` e `ENTERPRISE` — nunca mais aparece em Home/Pricing/Signup.
ENTERPRISE continua "fale conosco", fora do self-service.

## 6. Valores

**Nenhum preço foi inventado ou alterado.** Auditados e mantidos: START US$29/mês, PRO US$89/mês
(destacado), BUSINESS US$249/mês — já em produção, já seedados em `plan_versions`, já a base de
`docs/saas-commercialization-audit.md`. Moeda: USD, como já documentado
(`platform-plan-catalog.ts:1-10`: "câmbio para BRL fica na camada UI, fase futura" — decisão
preexistente, deliberada). **Recomendação para o mercado brasileiro**: manter USD nesta rodada —
migrar pra BRL exigiria (a) decidir a taxa de conversão/arredondamento comercial, (b) confirmar
moeda de liquidação na conta Stripe (hoje sem `STRIPE_SECRET_KEY` configurado — nenhuma cobrança
real acontece ainda de qualquer forma), (c) uma estratégia de transição pra quem eventualmente já
tiver assinatura ativa. Nenhum dado suficiente pra decidir isso com segurança nesta auditoria —
documentado como pendência explícita (não decidido silenciosamente), conforme pedido.

## 7. Trial

7 dias (era 14). Fonte única e configurável: `plan_versions.trial_days` — nunca hardcoded em tela
nenhuma (`startTrial`, `src/application/billing/trial-use-cases.ts:59-60`, sempre lê
`planVersion.trialDays`). Mudança feita via `db/migrations/0131_billing_trial_seven_days.sql`: gera
uma **nova versão** (2) de START/PRO/BUSINESS com `trial_days=7` e desativa a versão 1 — nunca um
`UPDATE` sobre a versão já existente (isso violaria a imutabilidade de versão que o próprio sistema
já garante, documentada em `docs/saas-commercialization-audit.md` §2.3). Sem cartão: `startTrial`
nunca chama `BillingProviderPort` (`billingProvider:"none"`).

## 8. Trial limits

Auditoria não encontrou (nem foi pedido) um limite DIFERENTE pro período de trial em si — o trial é
uma `Subscription` real que usa os MESMOS `capabilities`/`limits` do `PlanVersion` contratado
(`resolveEffectiveEntitlements`, nunca uma regra paralela "trial vale menos") — ou seja, quem testa o
Pro testa o Pro de verdade, sem capar artificialmente o produto (seção 5 do pedido: "sem esconder
artificialmente o produto inteiro"). Isso já era o comportamento antes desta rodada; não foi
alterado. Um limite específico de trial (menor que o do plano contratado) não foi implementado —
avaliação de custo real (créditos de IA consumidos em 7 dias por um trial médio) fica como
recomendação para uma rodada futura, com dados reais de uso.

## 9. Signup

`web/app/signup/page.tsx`: campo **Nome** adicionado (antes só e-mail/senha, nome era inferido do
e-mail — pedido explícito, seção 24, "Nome / E-mail / Senha"). `planCode` (só START/PRO/BUSINESS,
nunca FREE) é validado contra a URL e enviado no corpo do `POST /v1/auth/signup`
(`SIGNUP_BODY_SCHEMA`, `src/interfaces/api/routes/v1/auth.route.ts:127-138`, enum fechado —
`planCode=PRO&price=1` do tipo descrito na seção 34 do pedido nunca teria efeito, preço não existe
nesse payload). **Mudança crítica de fluxo**: antes, escolher um plano pago redirecionava direto pra
`/settings/plano` (Billing) depois do cadastro — contra a seção 27 do pedido ("não jogar usuário no
Billing"). Agora SEMPRE vai para o onboarding, pago ou não — o trial já está rodando, sem fricção
nenhuma.

## 10. Onboarding

Não alterado (já era funcional, 5 passos, WhatsApp opcional com "Pular por enquanto" —
`src/domain/onboarding/onboarding.model.ts:8`, `web/app/workspaces/[workspaceId]/onboarding/page.tsx:236-407`).
Confirmado que continua sendo o destino único pós-signup.

## 11. Checkout

Não alterado — `startCheckout`/`StripeBillingProvider`/`SandboxBillingProvider` já reais e testados
(`tests/billing-foundation.test.mjs`, `tests/billing-checkout-webhook.test.mjs`). Preço final sempre
resolvido no backend a partir do `PlanVersion` (nunca aceito do frontend — não existe campo de preço
em nenhum payload de checkout).

## 12. Payment method

Não alterado — `openBillingPortal`/`PaymentMethodSnapshot` (cache de exibição, nunca dado de cartão
real armazenado) já existentes e funcionais em `plano/page.tsx`.

## 13. Webhook

Não alterado — `POST /webhooks/billing/{providerId}` fora de `/v1`, assinatura HMAC verificada,
idempotente por `(provider, providerEventId)` (`payment_webhook_events`), eventos tratados:
`checkout.session.completed`, `customer.subscription.updated/deleted`,
`invoice.payment_succeeded/failed`. Coberto por `tests/billing-checkout-webhook.test.mjs`,
`tests/billing-webhook-route.test.mjs` (idempotência e reentrega testadas e passando).

## 14. Subscription lifecycle

Não alterado — estados reais (`trial, active, past_due, cancelled, expired, suspended,
trial_expired`), transições via `moveDealStage`-equivalente (`lifecycle-use-cases.ts`), sempre
`cancel_at_period_end`, nunca cancelamento imediato. O que MUDOU foi só a ENTRADA nesse ciclo de
vida: agora nasce automaticamente no signup, em vez de exigir uma chamada manual depois.

## 15. Entitlements

Mecanismo (`resolveEffectiveEntitlements`, `canUse`, `getLimit`, `assertCanUse`, `assertWithinLimit`)
não alterado — já correto. O que mudou: passou a ser **chamado** em mais lugares (seção 16 abaixo).
Feature flag ≠ entitlement (seção 22 do pedido) já era garantido pela própria arquitetura — nenhum
`if (plan === "pro")` existe no código; capabilities vêm sempre do `PlanVersion` contratado.

## 16. Read-only (novo)

**Gap fechado nesta rodada.** Novo guard `src/interfaces/api/http/read-only-guard.ts`, opt-in por
rota via `config: { readOnlyGuard: true }` (mesmo idioma de `idempotency.middleware.ts`), aplicado
às rotas de CRIAÇÃO operacional citadas explicitamente no pedido (seção 42): `POST /deals`,
`POST /tasks`, `POST /contacts`, `POST /proposals`, `POST /automation-rules`. Tenant em modo
somente-leitura (`trial_expired`/`past_due`/`suspended`) recebe `402 ENTITLEMENT_ACCOUNT_READ_ONLY`
(nova classe `PaymentRequiredError`, `app-error.ts`) — nunca 403 (que significaria "seu papel não
pode"). Rotas de billing/auth **nunca** têm o guard — é o único jeito de sair do modo somente-leitura
(testado explicitamente, ver seção 26). **Escopo desta rodada, documentado como não-exaustivo**: não
cobre publicação de marketing nem geração de IA (a Deals/Tasks/Contacts/Proposals/Automation-rules
são as rotas de "criação operacional" citadas no pedido; envio/publicação/IA ficam como gap
documentado na seção 29).

## 17. Expiration

Não alterado no backend (`expireTrials`, scheduler dedicado, já testado). Novo no frontend: faixa
persistente `WorkspaceReadOnlyBanner` (`web/components/WorkspaceReadOnlyBanner.tsx`), visível em
QUALQUER tela do workspace (não só na tela de Billing) quando `billing.readOnly === true` — mensagem
adaptada por status (trial vencido / pagamento pendente / suspenso), sempre reforçando "seus dados
continuam salvos", com botão "Ativar plano". Reusa `useBillingOverview()`, já existente — nenhuma
chamada de API nova no frontend.

## 18. Upgrade

Não alterado — `changePlan` (upgrade) já self-service, real, testado
(`tests/billing-lifecycle.test.mjs`: "upgrade START -> PRO troca o planVersionId e recalcula
tenant_billing").

## 19. Downgrade

Não alterado — bloqueia quando uso excede o novo limite, mostra overage ANTES de confirmar
(`fetchDowngradePreview`), nunca apaga dado. Testado.

## 20. Cancellation

Não alterado — sempre `cancel_at_period_end`, nunca imediato; como não existe FREE, nunca converte
automaticamente pra um plano gratuito (confirmado por leitura de código — `cancelSubscriptionSelfService`
só marca `cancelAtPeriodEnd`, não muda `planVersionId`). Copy de confirmação já existente
("Seu plano continuará ativo até..., nenhum dado será apagado").

## 21. Reactivation

Não alterado — `reactivateSubscription`, self-service, sem cadastro novo, testado (`tests/billing-lifecycle-route.test.mjs`).

## 22. Analytics

Vocabulário já fechado e correto (30 eventos, incluindo todo o funil pedido na seção 52-53:
`landing_view, pricing_view, plan_selected, signup_started, signup_completed, trial_started,
onboarding_started/step_completed/completed, checkout_started/completed, subscription_upgraded/
downgraded/canceled`) — **nenhum evento novo foi criado**, nada duplicado. Verificado que o novo
fluxo de signup+trial continua emitindo os eventos certos: `signup_completed`/`workspace_created`
(já existentes) e agora também `trial_started` quando o trial nasce no signup — gravado
DEPOIS do commit da transação (nunca antes, pra nunca mentir sobre um signup revertido), mesmo
princípio já usado pelos outros eventos desse mesmo fluxo.

## 23. Security

`planCode` no signup é um enum fechado (`START|PRO|BUSINESS`) — um `planCode=PRO&price=1` arbitrário
nunca teria efeito (não existe campo de preço no payload; preço sempre resolvido no backend a partir
do catálogo). Webhook de pagamento continua com verificação de assinatura HMAC real (inalterado). O
guard de somente-leitura (seção 16) é a superfície de segurança nova desta rodada — testada com
sucesso (402 real) e com um teste negativo confirmando que ele NUNCA intercepta rotas de billing.

## 24. Multi-tenant

Nenhuma mudança de isolamento — `architecture:check` (todos os 7 checks de isolamento) e os testes
de isolamento cross-tenant já existentes (`crm-pipelines-deals.test.mjs`, `auth-api.test.mjs`)
continuam passando sem alteração, confirmando que nada nesta rodada vazou dado entre tenants.

## 25. Mobile

Home/Pricing/Signup/Billing já usavam Tailwind mobile-first (breakpoints `sm:`/`md:`/`lg:`/`xl:`)
antes desta rodada — mantido. Novo conteúdo (pilares 6, FAQ, cards de plano na Home) segue os mesmos
paddings/grids responsivos já em uso nessas páginas (`sm:px-6`, `grid md:grid-cols-*`). **Não foi
possível confirmar visualmente em 390px** (gap de QA, seção 27/29) — verificação disponível foi
`next build` bem-sucedido + leitura das classes responsivas aplicadas.

## 26. Testes

Novo arquivo `tests/saas-acquisition-self-service.test.mjs` (8 testes, via `app.inject`, Postgres
real por pglite — mesma convenção de `tests/billing-lifecycle-route.test.mjs`): signup com
`planCode=PRO` + `TRIAL_ENABLED=true` cria Subscription real de 7 dias; signup sem plano preserva o
comportamento legado; signup com plano mas trial desligado nunca quebra o cadastro; `planCode=FREE`
é rejeitado pelo schema (400); duplo signup nunca duplica Subscription; guard de somente-leitura
bloqueia `POST /v1/contacts` com 402 quando `trial_expired`, permite quando `active`, e NUNCA
intercepta `/v1/billing/reactivate`. Todos os 8 passando na primeira execução real.

Corrigido um teste pré-existente que ficou desatualizado pela mudança da seção 5
(`tests/platform-admin.test.mjs`: assertion que esperava FREE na lista pública, agora corrigida pra
esperar exatamente `["START","PRO","BUSINESS"]`) e um texto de teste desatualizado pelo trial de 7
dias (`tests/trial.test.mjs`, só o título, a asserção já era dinâmica).

Suíte completa relevante rodada e verde: **108 testes de backend** (signup, trial, billing
foundation/lifecycle/checkout/webhook/overview, auth, CRM deals/proposals/execução/fundação/
automação) + **56 testes de frontend** (Vitest). `npm run typecheck`, `npm run build` e
`npm run architecture:check` (backend e frontend) limpos.

## 27. Browser QA

**Gap honesto, mesma limitação já documentada nas fases anteriores desta sessão**: este ambiente não
tem um navegador autenticado com dados reais pra rodar os 4 fluxos pedidos na seção 62 (Trial,
Ativação, Expiração, Cancelamento) clicando de verdade. A verificação real disponível e efetivamente
feita: 108+56 testes automatizados reais (Postgres via pglite, HTTP via `app.inject`, nunca mock de
banco), `typecheck`/`build`/`architecture:check` limpos nas duas bases de código, e leitura linha a
linha de cada tela alterada confirmando que os pontos de entrada (`signup`, `pricing`, `home`,
`plano/page.tsx`, o novo banner) mudaram exatamente como descrito.

## 28. Screenshots

Não produzidos — dependem do mesmo navegador autenticado indisponível nesta sessão (seção 27).

## 29. Gaps

- QA em navegador real (desktop 1440/1366 e mobile 390) não foi feita — maior risco residual.
- `TRIAL_ENABLED`/`BILLING_PROVIDER_ENABLED` continuam **desligados em produção** — nenhuma parte
  desta rodada funciona de ponta a ponta até esses dois flags serem ligados (deploy + config,
  pendente de autorização explícita, seção 67 do pedido).
- Migration `0131` existe localmente, não aplicada em produção ainda (mesma dependência do item
  acima).
- Guard de somente-leitura cobre CRM (Contato/Negócio/Tarefa/Proposta/Automação) — não cobre
  publicação de marketing nem geração de IA (rotas não identificadas/gateadas nesta rodada por
  escopo e tempo; risco real mas pré-existente, já documentado como tal em
  `docs/vorix-auditoria-geral-estado-atual.md` §5).
- Decisão de moeda (USD vs. BRL) documentada como pendência, não decidida (seção 6).
- Sem teste de componente para as telas React alteradas (mesmo gap já registrado nas fases
  anteriores desta sessão — o projeto não tem `@testing-library/react`).
- `crm-propostas-fase4.test.mjs` e `billing-overview-route.test.mjs` colidem na mesma porta de
  pglite quando rodados juntos (`55712`) — bug pré-existente, não introduzido nesta rodada,
  encontrado incidentalmente; sinalizado aqui pra correção futura, não corrigido (fora do escopo
  desta rodada).
- Onboarding em `isOnboardingPath` não recebe o `WorkspaceReadOnlyBanner` (shell simplificado sem
  topbar) — cenário raro (trial normalmente não vence DURANTE o onboarding), deixado assim
  deliberadamente para não complicar aquele shell.

## 30. Classificação final

| Chave | Valor |
|---|---|
| PUBLIC_HOME | APPROVED |
| PUBLIC_PRICING | APPROVED |
| START_PLAN | CONFIGURED |
| PRO_PLAN | CONFIGURED |
| BUSINESS_PLAN | CONFIGURED |
| NO_FREE_PLAN | VERIFIED |
| TRIAL_START | VERIFIED_LOCAL |
| TRIAL_WITHOUT_CARD | VERIFIED_LOCAL |
| TRIAL_EXPIRATION | VERIFIED_LOCAL |
| TRIAL_READ_ONLY | VERIFIED_LOCAL |
| PLAN_SELECTION_PRESERVED | VERIFIED_LOCAL |
| CHECKOUT | VERIFIED_LOCAL |
| WEBHOOK_IDEMPOTENCY | VERIFIED_AUTOMATED |
| SUBSCRIPTION_ACTIVATION | VERIFIED_LOCAL |
| ENTITLEMENT_ACTIVATION | VERIFIED_LOCAL |
| UPGRADE | VERIFIED_LOCAL |
| DOWNGRADE | VERIFIED_LOCAL |
| CANCEL | VERIFIED_LOCAL |
| REACTIVATE | VERIFIED_LOCAL |
| MOBILE_ACQUISITION | PASS* |
| SAAS_SELF_SERVICE_READY | NO |

`*` MOBILE_ACQUISITION: `PASS` refere-se só a "usa classes responsivas corretas e builda sem erro" —
nunca visto rodando num viewport real (ver seção 27/29).

`SAAS_SELF_SERVICE_READY = NO` porque `TRIAL_ENABLED`/`BILLING_PROVIDER_ENABLED` continuam
desligados em produção e a migration `0131` não foi aplicada lá — o código está pronto e testado
localmente, mas **ninguém consegue testar/comprar de verdade até o deploy + a ativação dos dois
flags**, que dependem da sua autorização explícita (nunca feitos automaticamente nesta rodada,
conforme pedido).

## Arquivos alterados/criados

**Backend:**
- `src/domain/platform-billing/platform-plan-catalog.ts` — `listPublicPlans()` exclui FREE.
- `src/infrastructure/storage/postgres/signup-public-transactional.ts` — cria trial real
  atomicamente quando `planCode` é enviado.
- `src/interfaces/api/routes/v1/auth.route.ts` — schema de signup aceita `planCode`.
- `src/interfaces/api/http/app-error.ts` — nova `PaymentRequiredError` (402).
- `src/interfaces/api/http/read-only-guard.ts` — **novo**, guard de somente-leitura.
- `src/interfaces/api/routes/v1/index.ts` — registra o guard.
- `src/interfaces/api/routes/v1/{deals,tasks,contacts,proposals,automation-rules}.route.ts` —
  `config: { readOnlyGuard: true }` nas rotas de criação.
- `db/migrations/0131_billing_trial_seven_days.sql` — **novo**, trial 14→7 dias via nova versão de
  plano.

**Frontend:**
- `web/app/page.tsx` — Home redesenhada.
- `web/app/pricing/page.tsx` — Pricing sem copy técnica, com trial em destaque.
- `web/app/signup/page.tsx` — campo Nome, envia `planCode`, nunca redireciona pro Billing.
- `web/lib/auth-api.ts` — `SignupInput.planCode`, `LoginResult.trialStarted`.
- `web/app/workspaces/[workspaceId]/settings/plano/page.tsx` — remove copy técnica residual.
- `web/components/WorkspaceReadOnlyBanner.tsx` — **novo**, faixa global de modo somente-leitura.
- `web/app/workspaces/[workspaceId]/layout.tsx` — monta o banner no shell do workspace.

**Testes:**
- `tests/saas-acquisition-self-service.test.mjs` — **novo**, 8 testes via HTTP real.
- `tests/platform-admin.test.mjs`, `tests/trial.test.mjs` — corrigidos pra refletir os novos
  comportamentos (FREE fora do público; trial de 7 dias).

---

Aguardando autorização explícita antes de qualquer deploy (migration `0131` + rebuild) e antes de
ligar `TRIAL_ENABLED`/`BILLING_PROVIDER_ENABLED` em produção — nada disso foi feito automaticamente,
conforme pedido.
