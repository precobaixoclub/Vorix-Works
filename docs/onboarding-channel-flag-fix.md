# Onboarding — correção: feature flag do módulo Conversas

## Problema

A etapa "Canal" do onboarding guiado (`connectChannelDuringOnboarding`) chamava `createConnection`/
`listConnections` diretamente através de `inboxDeps`, sem nunca checar `CONVERSATIONS_MODULE_ENABLED`
(`app.zunoContainer.inboxFeatureFlags.enabled`). O kill switch do módulo Conversas só gate ava o
registro das rotas `/v1/inbox/*` (`routes/v1/index.ts`) — o caminho de onboarding contornava essa
proteção por completo, criando conexões reais mesmo com o módulo tecnicamente desligado.

## Correção

- `OnboardingUseCaseDeps` ganhou `inboxModuleEnabled: boolean`, computado uma vez na composição
  (`routes/v1/index.ts`) a partir de `app.zunoContainer.inboxFeatureFlags.enabled` — o MESMO valor
  que já gate a `/v1/inbox/*`, nunca uma segunda leitura de config.
- `connectChannelDuringOnboarding` checa essa flag **primeiro**, antes de qualquer leitura/escrita
  (`ONBOARDING_CHANNEL_MODULE_DISABLED`) — nunca cria conexão, nunca consulta entitlement, se o
  módulo estiver desligado.
- Feature flag e entitlement (`messaging_connections`) permanecem **independentes**: um plano que
  permitiria a conexão não contorna o módulo desligado; um módulo ligado não contorna o limite do
  plano. A operação só ocorre quando os dois permitirem — coberto por teste dedicado
  (`connectChannelDuringOnboarding: feature flag ... é checada de forma INDEPENDENTE do entitlement`).
- Toda resposta que devolve o progresso (`GET /onboarding`, `start`, `company`, `advance`,
  `complete`) agora anexa `channelModuleEnabled` (informativo, nunca persistido) — o frontend usa
  isto para esconder o CTA "Conectar WhatsApp" quando o módulo está desligado, mostrando em vez
  disso uma mensagem neutra + o botão "Continuar" (a etapa continua sendo opcional).
- Erro mapeado para `409 Conflict` (mesmo tratamento de `USAGE_LIMIT_REACHED`/
  `ENTITLEMENT_ACCOUNT_READ_ONLY`).

## UX — etapa "Equipe"

O título da etapa passou de "Quem vai trabalhar com você?" para **"Convide sua equipe"**, com a
descrição deixando explícito que a ação é convidar pessoas por e-mail com um papel de acesso
(`owner/admin/editor/viewer`) — nunca a criação de um Time (`Team`/`TeamMembership`) nomeado. Essa
lógica continua fora de escopo até o convidado possuir `userId` (ver auditoria do onboarding).

## Testes

- `tests/onboarding.test.mjs`: `connectChannelDuringOnboarding` com módulo desligado (rejeita, zero
  linhas criadas) e com módulo religado no mesmo workspace (funciona), provando a independência das
  duas checagens.
- `tests/onboarding-route.test.mjs`: `POST /onboarding/connect-channel` → 409 quando
  `CONVERSATIONS_MODULE_ENABLED` não está setado (padrão); `channelModuleEnabled: true` +
  conexão bem-sucedida quando `CONVERSATIONS_MODULE_ENABLED=true`.

Suíte específica: 19/19. Suíte relevante (signup, auth, inbox, billing, CRM, capabilities): 58/58.
Typecheck/build/architecture checks: limpos (backend e web).
