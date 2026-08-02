# Sprint 20 - Revisao Arquitetural

Status: aguardando aprovacao para implementacao.

Data: 2026-07-30

## Objetivo Da Revisao

Preparar a plataforma para multiplos providers, webhooks, sincronizacao de status, event store e operacao multicanal sem habilitar publicacao em producao.

Esta revisao cumpre apenas a Fase 1 do Prompt 20. Nenhum codigo de implementacao foi escrito.

## Estado Atual

### Provider Registry

O `PublicationProviderRegistry` registra adapters por `providerId`, lista descriptors, resolve provider habilitado e valida capabilities basicas: canal, content type, modo, tamanho de payload e quantidade de assets.

O descriptor atual ja contem:

- `providerId`
- `providerVersion`
- `displayName`
- `enabled`
- `supportedChannels`
- `supportedContentTypes`
- flags de idempotencia/status/delete/update/scheduling/receipt verification
- limites de payload/assets

Lacunas para Sprint 20:

- nao ha `oauthType` no descriptor;
- nao ha `status` semantico separado de `enabled`;
- health nao expõe contrato padronizado para latencia, OAuth, rate limit, webhook e ultima sincronizacao;
- o registry aceita providers estaticos, mas a composicao no DI ainda instancia apenas DryRun/Fake e Meta Pages Sandbox quando configurado;
- LinkedIn Sandbox e X Sandbox ainda nao existem nem como estrutura.

### Credential Domain

O dominio de Credential ja e independente de Publication e modela `Credential`, `CredentialReference`, `CredentialBinding`, `CredentialRotation` e `CredentialHealth`.

Pontos positivos:

- isolamento por tenant/workspace/provider;
- secret fica fora do dominio persistido;
- credential mirror em Publication e apenas compatibilidade operacional;
- rotacao, revoke, disable, enable e health-check ja existem.

Riscos para multiplos providers:

- `CredentialGovernanceService` recebe `requiredScopes` como dependencia unica global; isso precisa virar configuracao por provider.
- `credentialIdFor()` usa uma credencial por tenant/workspace/provider, o que atende a Sprint 20, mas limita multiplas contas do mesmo provider no mesmo workspace.
- `binding` atual usa `canary` booleano e `environment`; para multiplos providers sera necessario expressar provider rollout/canary por provider, nao apenas sandbox=true.
- health atual valida secret, expiracao e scopes, mas nao mede latencia, OAuth refresh, rate limit, webhook status ou ultima sync real.

### OAuth

O OAuth real atual esta concentrado em `MetaPagesOAuthService`.

Riscos:

- tipos de OAuth diferem por provider: Meta usa pages/account exchange; LinkedIn tende a user/org scopes; X pode usar OAuth 2.0 PKCE ou OAuth 1.0a conforme operacao.
- `POST /v1/credentials/connect` hoje inicia Meta Pages implicitamente; Sprint 20 precisa `POST /v1/providers/:id/connect`.
- callback/status/disconnect ainda estao acoplados ao provider Meta Pages nas rotas antigas.
- telemetry de OAuth esta em memoria no service Meta; nao ha event store duravel para OAuth success/failure por provider.

### Publication

Publication ja tem plano, target por canal/provider, outbox duravel, attempts, receipts, receipt verification e reconciliation.

Impactos de multiplos providers:

- `PublicationProvider` enum ja inclui `linkedin` e `x`, mas sem adapters sandbox.
- capability discovery precisa influenciar criacao/validacao dos targets antes do outbox.
- um plano multicanal pode produzir targets com providers diferentes; a governanca deve ser avaliada por target, nao apenas por plano.
- receipts precisam aceitar updates de webhook e status sync append-only, sem mutar historico de eventos externos.
- eventos normalizados devem alimentar Publication por porta de aplicacao, sem Webhook importar Publication internamente.

### Dispatch

Dispatch usa registry, valida capability, resolve secret e grava receipt/outbox state.

Riscos:

- validacao de credential ainda consulta o mirror `publication_credential_references`, nao diretamente Credential Domain.
- para providers reais, outbox exige `credentialReferenceId`; isso esta correto, mas precisa resolver credencial por provider e target de forma explicita.
- provider result e uniforme o suficiente para publish, mas nao cobre delete/update/analytics.
- unknown outcome ja existe e e bom ponto de entrada para sync/webhook.

### Reconciliation

Reconciliation consulta providers por `getStatus()` e verifica receipts por `verifyReceipt()`.

Riscos:

- `secretResolver.resolve()` em reconciliation e receipt verification nao passa `credentialReferenceId`; com multiplos providers, isso pode selecionar credencial errada se houver mais de uma reference ativa ou rotacao recente.
- reconciliation e polling-only; nao ha consumo de webhooks.
- nao registra auditoria operacional no `OperationalAuditRepository`.
- `not_found` vira failure `provider_unavailable`, categoria imprecisa para rejeicao/delecao externa.

### Audit

Audit operacional append-only existe e cobre credenciais/RBAC/governanca administrativa.

Lacunas:

- nao ha tipos/eventos especificos para webhook recebido, webhook rejeitado, normalizacao, status sync ou receipt update.
- audit export existe, mas event store operacional de provider/webhook deve ser separado ou claramente integrado com `OperationalAuditRepository`.
- eventos brutos de provider nao devem ir para audit se contiverem payload sensivel; audit deve receber metadados sanitizados e references.

### Compliance

ComplianceService faz scans simples contra dominio de credenciais, audit, publication events e receipts.

Lacunas:

- nao cobre raw webhook payload storage;
- nao cobre HMAC/replay/timestamp/nonce;
- nao cobre retencao de eventos externos;
- nao diferencia provider payload safe reference de payload bruto.

### Governance Policy

`PublicationGovernancePolicy` bloqueia production, exige canario unico Meta, RBAC, credencial, binding, health e aprovacao.

Riscos:

- canary policy atual possui `providerId` unico; Sprint 20 precisa matriz provider -> tenants/workspaces habilitados.
- policy retorna `provider_mismatch` para qualquer provider externo diferente de Meta Pages Sandbox.
- `binding.canary` booleano nao representa rollout por provider/canal/capability.
- policy nao avalia capability de webhook/status sync por provider.

## Riscos Principais

1. Selecionar credencial errada em reconciliation ou receipt verification se nao houver `credentialReferenceId` historico associado ao receipt/reconciliation.
2. Processar webhook invalido antes da verificacao de assinatura/timestamp/nonce.
3. Tratar payload bruto de webhook como audit log e vazar token, user data ou headers sensiveis.
4. Acoplar Webhook diretamente a Publication, quebrando o limite pedido: Publication deve consumir eventos normalizados.
5. Modelar capability como booleans soltos demais e depois nao conseguir adaptar fluxo por canal/provider.
6. Usar canario global unico e bloquear evolucao para LinkedIn/X sandbox.
7. Normalizar eventos sem idempotencia/replay protection, gerando receipt update duplicado.
8. Confundir status externo `deleted/rejected/not_found` com falha operacional de provider.
9. Registrar event store mutavel; Prompt 20 exige append-only para Webhook Events, Provider Events, Synchronization Events e Receipt Updates.
10. Habilitar production acidentalmente por provider novo se config default nao for explicitamente sandbox/disabled.

## Proposta De Arquitetura Para Implementacao

### Multi Provider Registry

Evoluir `PublicationProviderDescriptor` para incluir:

- `status`: `enabled | disabled | sandbox_only | degraded`
- `oauthType`: `none | oauth2_auth_code | oauth2_pkce | oauth1a | manual`
- `capabilities`: objeto estruturado com publish/image/video/carousel/scheduling/update/delete/status/analytics/webhooks
- `healthSignals`: latencia, rate limit, oauth, webhook, lastSync

Manter DryRun e Fake sempre disponiveis; registrar Meta Pages Sandbox, LinkedIn Sandbox e X Sandbox como adapters sandbox/estrutura, com production bloqueada.

### Webhook Domain

Criar dominio independente em `src/domain/webhook`:

- `Webhook`
- `WebhookEvent`
- `WebhookDelivery`
- `WebhookVerification`
- `WebhookStatus`
- `WebhookSignature`
- `WebhookProcessing`
- `ProviderEvent`
- `NormalizedProviderEvent`

O dominio Webhook nao deve importar Publication. Ele deve expor eventos normalizados por porta.

### Webhook Receiver

Endpoint recomendado:

- `POST /webhooks/:provider`

Fluxo:

1. identificar provider;
2. capturar headers minimos;
3. validar timestamp dentro da janela;
4. validar nonce unico por provider/tenant quando disponivel;
5. validar HMAC sobre payload bruto;
6. persistir raw event sanitizado/referenciado;
7. normalizar;
8. enfileirar processamento/sync;
9. auditar resultado seguro.

Webhook invalido deve persistir apenas registro minimo de rejeicao, sem acionar normalizer nem Publication.

### Event Normalization

Criar `ProviderEventNormalizer` com saida fechada:

- `PublicationStatusChanged`
- `ReceiptUpdated`
- `PublicationDeleted`
- `PublicationRejected`
- `PublicationRecovered`

Cada normalizer deve ser provider-specific, mas retornar contrato comum.

### Publication Synchronization

Criar `PublicationSynchronizationService` como camada de aplicacao:

- consome eventos normalizados;
- consulta providers quando necessario;
- atualiza receipt/verifications/reconciliations via `PublicationRepositoryPort`;
- registra audit operacional;
- grava sync events append-only.

Ele deve ser o unico ponto que toca Publication a partir de webhooks.

### Credentials Multi Provider

Manter uma credencial por tenant/workspace/provider como regra Sprint 20.

Ajustes necessarios:

- `requiredScopes` por provider;
- provider subject por provider;
- OAuth service interface generica;
- credential health por provider;
- mirror Publication mantido apenas para dispatch legado/compatibilidade.

### Provider Health

Criar health composto:

- provider adapter health;
- OAuth telemetry duravel;
- credential health;
- rate limit snapshot;
- webhook verification stats;
- sync stats;
- last successful sync.

### API

Adicionar sem remover rotas atuais:

- `GET /v1/providers`
- `GET /v1/providers/:id`
- `GET /v1/providers/:id/health`
- `POST /v1/providers/:id/connect`
- `POST /v1/providers/:id/disconnect`
- `GET /v1/webhooks`
- `GET /v1/publication-sync`

Rotas de connect/disconnect devem usar `credential:connect`/`credential:disconnect` ou permissao equivalente, com RBAC auditado.

### Frontend

Criar painel `Providers` ou evoluir `Governanca` com tabs:

- Providers
- Webhooks
- Health
- OAuth
- Credenciais
- Sincronizacao
- Eventos
- Status

Interface deve ser operacional, densa e focada em diagnostico.

## Evidencia Operacional Esperada

Teste end-to-end recomendado:

Provider conectado -> OAuth -> Credential registrada -> Publication real sandbox -> Webhook assinado -> Normalizacao -> Synchronization -> Receipt atualizado -> Audit registrado.

Tambem testar:

- Meta Pages Sandbox + LinkedIn Sandbox estrutural coexistindo no registry;
- credenciais isoladas por provider;
- webhook HMAC invalido rejeitado;
- replay por nonce bloqueado;
- timestamp antigo rejeitado;
- sync polling funcionando quando provider suporta status;
- production permanece bloqueada.

## Ordem Recomendada De Implementacao

1. Evoluir descriptor/capabilities/registry sem mudar dispatch.
2. Criar adapters sandbox estruturais LinkedIn/X com publish desabilitado ou fake sandbox controlado.
3. Criar dominio Webhook e event store append-only.
4. Criar verifier HMAC/timestamp/nonce e receiver generico.
5. Criar normalizers provider-specific.
6. Criar `PublicationSynchronizationService`.
7. Integrar sync com PublicationRepository e OperationalAudit.
8. Evoluir CredentialGovernance para scopes por provider.
9. Adicionar APIs e frontend.
10. Cobrir evidencias obrigatorias com testes.

## Decisao Necessaria

Antes de escrever codigo, preciso de aprovacao para seguir com a implementacao da Sprint 20 nesta arquitetura.

Pontos que merecem decisao explicita:

- LinkedIn/X Sandbox devem ser adapters estruturais sem chamada externa, ou com simulação local igual ao Fake Provider?
- O event store de Webhook deve ficar em dominio proprio (`webhook_*`) e audit apenas com resumo seguro?
- Manter uma credencial por tenant/workspace/provider, sem multiplas contas do mesmo provider, conforme Prompt 20?

## Fora De Escopo Mantido

- analytics completos;
- billing;
- multiplas publicacoes simultaneas;
- rollback remoto;
- publicacao em producao;
- multiplos providers reais ativos simultaneamente.
