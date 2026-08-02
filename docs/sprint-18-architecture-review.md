# Sprint 18 - Revisao Arquitetural

Status: aguardando aprovacao. Nenhum codigo funcional da Sprint 18 foi implementado.

Esta revisao atende a Fase 1 do Prompt 18 e inclui uma recomendacao de provider para a Fase 2, sem iniciar OAuth, adapter real, secret storage real, frontend ou migrations.

## Fontes Oficiais Consultadas

- Meta for Developers - Build and Test / Test Users / Test Pages: `https://developers.facebook.com/documentation/development/build-and-test` e `https://developers.facebook.com/documentation/development/build-and-test/test-users`
- Meta for Developers - Graph API Explorer: `https://developers.facebook.com/docs/graph-api/guides/explorer/`
- LinkedIn Marketing API Program Access Tiers: `https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-tiers?view=li-lms-2026-07`
- LinkedIn Community Management API: `https://developer.linkedin.com/product-catalog/marketing/community-management-api`
- LinkedIn Documents / Posts API: `https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/documents-api?view=li-lms-2026-07`

## 1. Provider Registry

Estado atual:

- `PublicationProviderRegistry` registra adapters, lista descriptors, resolve provider, valida capabilities e expoe health por provider.
- `resolve` bloqueia provider desconhecido ou desabilitado.
- Descriptors suportam canais, tipos de conteudo, idempotency, status lookup, delete, update, scheduling, receipt verification, limites de payload e assets.

Risco para provider real:

- O registry ainda e montado em composition root; `publication_provider_descriptors` existe no banco, mas nao e fonte operacional sincronizada.
- Habilitar um provider real apenas no registry nao basta. Ele precisa ser protegido por sandbox policy, canary policy, feature flag e environment policy.
- `PublicationProvider` ainda contem ids de providers reais no dominio. Isso e aceitavel como identificador operacional, mas nenhum adapter real deve ser registrado por default.

Gate antes de codigo:

- Definir `providerId` unico para Sprint 18.
- Registrar adapter real somente atras de config explicita e fail-closed.
- Manter `dry_run` e `fake` como default para todos os tenants/workspaces nao autorizados.

## 2. Adapter Contract

Estado atual:

- `PublicationProviderAdapterPort` expoe `publish`, `getStatus`, `verifyReceipt`, `capabilities` e `health`.
- `PublicationProviderCallResult` ja discrimina `published`, `rejected`, `transient_failure`, `permanent_failure`, `authentication_failure`, `rate_limited` e `unknown_outcome`.
- O contrato nao importa SDK externo e fica na application layer.

Risco para provider real:

- O contrato ainda nao modela rate-limit headers de forma estruturada (`remaining`, `reset`, `retry-after`) fora de `retryAfter`.
- `PublicationProviderStatusResult` tem status simplificado; provider real pode ter estados intermediarios como processing, unpublished, deleted, rejected, unavailable.
- `PublicationReceipt` ainda nao tem campo explicito para `providerRequestId` e `externalIdentifiers`; hoje `providerPublicationId`, `url`, `checksum` e `idempotencyKey` cobrem parte do receipt.

Gate antes de codigo:

- Estender contratos sem tocar dominio Execution.
- Decidir como mapear request id real: receipt/event/reconciliation sem mutar receipt.
- Garantir timeout interno por chamada e conversao de excecoes para `unknown_outcome` quando a chamada pode ter chegado ao provider.

## 3. Secret Resolver

Estado atual:

- `PublicationSecretResolverPort` resolve credenciais apenas durante a chamada do adapter.
- Implementacoes atuais sao in-memory/fake.
- Dispatch ja exige credential reference para provider nao sintetico e valida status ativo quando a referencia existe.

Risco para OAuth/credenciais:

- `InMemoryPublicationSecretResolver` devolve segredo fake quando nao recebe credentialReferenceId; isso precisa permanecer restrito a `dry_run`/`fake`.
- Tokens OAuth exigem expiracao, refresh, revogacao, rotacao e sanitizacao de logs.
- Se refresh token expirar/revogar, o dispatch deve virar `authentication_failure`, nao retry infinito.

Gate antes de codigo:

- Criar uma interface de secret storage estavel para vaults futuros.
- Implementacao local pode persistir material criptografado fora do dominio, mas nunca em `PublicationCredentialReference`, receipt, event, failure, metricas ou logs.
- Toda serializacao de secrets deve ser proibida por teste.

## 4. Credential Reference

Estado atual:

- `PublicationCredentialReference` contem `credentialReferenceId`, `tenantId`, `workspaceId`, `providerId`, `status`, `createdAt`, `updatedAt`.
- Migration `0043` nao persiste access token, refresh token, client secret, senha, chave privada ou segredo bruto.

Risco:

- Ainda falta vincular credential reference a OAuth account, scopes concedidos, expiresAt e ambiente (`sandbox` vs `production`) sem vazar segredo.
- Uma referencia ativa mas com secret ausente deve falhar de modo controlado.

Gate antes de codigo:

- Modelar metadata operacional nao secreta: scopes, sandbox account/page id, provider subject id, expiresAt, lastRefreshedAt, revokedAt.
- Manter o token fora do dominio e fora do repository de Publication.

## 5. Durable Outbox

Estado atual:

- Outbox e fonte duravel de dispatch.
- Fila em memoria e reconstruivel.
- `unknown_outcome` nao e retryado cegamente.
- Commits criticos Postgres foram endurecidos com transacoes locais e fencing.

Risco:

- Provider real aumenta o risco de sucesso externo seguido de falha local.
- Startup recovery ainda depende de chamada explicita, nao de lifecycle do servidor.
- Shutdown com drain completo ainda e divida tecnica.

Gate antes de codigo:

- Integrar lifecycle de worker/scheduler/recovery antes de chamadas externas reais.
- Em caso de timeout apos envio, marcar `unknown_outcome` e reconciliar.
- Production deve continuar bloqueada mesmo se houver outbox real.

## 6. Dispatch

Estado atual:

- Dispatch faz claim, valida payload/capability/credential reference, resolve secret, chama adapter e persiste resultado.

Risco:

- Provider real precisa de timeout por chamada, abort control, retry budget, rate-limit local e mapeamento de headers.
- Um adapter que lance excecao apos escrever no provider deve virar `unknown_outcome` quando houver ambiguidade.

Gate antes de codigo:

- Adapter real deve retornar resultado discriminado; excecoes cruas nao podem atravessar para o worker.
- Todo publish externo deve carregar idempotency key quando o provider suportar; quando nao suportar, deduplicacao local + canary + reconciliation.

## 7. Reconciliation

Estado atual:

- Reconciliation consulta `getStatus`, confirma published/not published/inconclusive e cria receipt/verification sem mutar receipt.

Risco:

- Nem todo provider suporta consulta por idempotency key ou request id.
- Se o provider escolhido so retorna status por external post id, `unknown_outcome` sem external id pode ficar inconclusivo.

Gate antes de codigo:

- Escolher provider com status lookup oficial em sandbox/test environment.
- Persistir provider request id/external id suficiente para reconciliar.
- Inconclusive deve permanecer pendente ou demandar operacao administrativa, nunca retry cego.

## 8. Receipt Verification

Estado atual:

- Verification cria registros novos (`verified`, `mismatch`, `not_supported`, `unverified`) e nao altera receipt.

Risco:

- Provider real pode alterar/deletar/ocultar conteudo, ou URLs podem expirar.
- Checksum local nao necessariamente equivale ao que o provider renderiza.

Gate antes de codigo:

- Definir checksum como checksum do payload enviado, nao da renderizacao externa.
- Verification deve comparar external id/status/author/page/workspace esperado.

## 9. Idempotencia

Estado atual:

- Semantica formal: at-least-once dispatch + deduplicacao local + reconciliacao externa.

Risco:

- LinkedIn/Meta podem nao oferecer idempotency key nativa para publish social.
- Repetir uma chamada POST sem idempotencia externa pode duplicar publicacao.

Gate antes de codigo:

- Se provider nao tiver idempotency key nativa, usar canary estrito, content checksum, target, provider, attempt generation e reconciliation antes de novo POST.
- Unknown outcome bloqueia retry ate consulta externa conclusiva.

## 10. PublicationPolicy

Estado atual:

- Policy controla allowed providers, allowed channels, require approval, mode e max retries.

Risco:

- Policy atual nao diferencia `sandbox` e `production`.
- Policy atual nao inclui canary de tenant/workspace/feature flag.

Gate antes de codigo:

- Criar `PublicationCanaryPolicy`.
- Criar `PublicationProviderEnvironmentPolicy` com `sandbox` permitido e `production` bloqueado.
- Defaults devem continuar dry_run.

## 11. Environment Policy

Estado atual:

- Execution ja possui environment policy propria.
- Publication ainda nao tem uma policy explicita de sandbox/production.

Risco:

- Um provider real registrado sem environment guard pode publicar fora de sandbox.

Gate antes de codigo:

- `production` deve falhar fechado.
- `sandbox` deve exigir tenant/workspace autorizado, feature flag ativa, provider habilitado e credential reference sandbox.

## 12. Riscos de OAuth

- CSRF/state ausente ou nao validado.
- Redirect URI incorreta ou aberta.
- Scope excessivo.
- Token exchange logando payload sensivel.
- Refresh token persistido no banco de dominio.
- Revogacao nao detectada.
- Token de test user/page confundido com conta real.

Mitigacoes propostas:

- `state` assinado e curto.
- Redirect URI allowlist.
- Scopes minimos.
- Secret storage fora de Publication domain.
- Eventos somente com safeMessage e ids opacos.
- Endpoint de status OAuth sem secrets.

## 13. Riscos de Credenciais

- Vazamento por logs, traces, receipts, failures, metricas ou resposta HTTP.
- Secret local sem criptografia.
- Rotacao criando duas referencias ativas concorrentes.
- Tenant/workspace cross-leak.

Mitigacoes propostas:

- Interface de secret storage com provider local substituivel.
- Testes de ausencia de secrets no banco e logs.
- `tenantId/workspaceId/providerId/credentialReferenceId` sempre no lookup.
- Revogacao atomica de referencia antiga durante rotacao.

## 14. Riscos de Publicacao Duplicada

- Retry apos timeout pode duplicar.
- Worker antigo pode retornar tarde.
- Usuario pode clicar publish varias vezes.
- Reprocess de dead letter pode reabrir outbox ja publicada.

Mitigacoes existentes:

- Fencing token.
- Receipt dedupe por idempotency local.
- Unknown outcome sem retry cego.
- Publish API passa pela outbox.

Mitigacoes faltantes:

- Status lookup real antes de re-POST.
- Idempotency externa se suportada.
- Canary com volume minimo.

## 15. Limitacoes dos Providers Avaliados

### LinkedIn

Pontos positivos:

- Documentacao de Posts/Documents API tem endpoints oficiais de criar e consultar post.
- Community Management API e um encaixe conceitual bom para publicacao social.

Limitacoes:

- Community Management API exige produto e revisao/acesso.
- Documentacao de Marketing API informa que chamadas em todos os niveis de acesso usam dados de producao para Advertising API, embora exista test ad account para Ads.
- Sandbox claro para post organico social e menos direto que Meta test users/pages.

Conclusao:

- Nao e a melhor primeira escolha se o objetivo principal e provar publicacao externa sem risco de producao.

### Meta

Pontos positivos:

- Meta oferece test users e test pages para simular Pages em desenvolvimento.
- Graph API Explorer ajuda a validar chamadas e tokens de apps em que o usuario tem papel.
- Development mode limita acesso a usuarios/testers/admins do app, reduzindo risco de publico real.

Limitacoes:

- Instagram Graph API e Pages API podem exigir app setup, permissions, roles e objetos de teste corretos.
- Rate limits de test users diferem de usuarios reais.
- Publicacao canario deve usar Facebook Page de teste primeiro, nao Instagram real.

Conclusao:

- Melhor escolha para Sprint 18: Meta Graph API com Facebook Test Page/Test User em development/sandbox mode.

## 16. Provider Escolhido

Recomendacao: `meta_pages_sandbox`.

Motivos:

- Permite ambiente oficial de teste com test users/test pages.
- Evita usar LinkedIn quando a propria documentacao de Advertising API destaca uso de dados de producao nos niveis de acesso.
- Tem Graph API Explorer e mecanismos oficiais de development mode.
- Permite validar OAuth, credential reference, secret resolver, outbox, dispatch, receipt e reconciliation sem abrir producao.

Escopo recomendado:

- Um unico provider: Meta Pages sandbox/test page.
- Um unico canal inicial: `facebook`.
- Sem Instagram, sem LinkedIn, sem ads, sem production.

## 17. Decisao Requerida

Para iniciar implementacao, aprovar explicitamente:

1. Provider unico: `meta_pages_sandbox`.
2. Canal unico: Facebook Page de teste.
3. Production bloqueada.
4. Canary apenas para tenant/workspace autorizados por feature flag.
5. Secret storage local substituivel, sem secrets no dominio.
6. Nenhum segundo provider nesta sprint.

Sem essa aprovacao, a Sprint 18 permanece somente em revisao arquitetural.
