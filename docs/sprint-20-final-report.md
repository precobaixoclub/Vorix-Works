# Sprint 20 - Relatorio Final

Data: 2026-07-30

## 1. Revisao Arquitetural

- Revisao registrada em `docs/sprint-20-architecture-review.md`.
- A Sprint 20 foi implementada sem fundir Webhook, Credential e Publication em um unico dominio.
- Publication segue como owner de planos, alvos, outbox, receipts e eventos de publicacao.
- Webhook/Event Sync ficou isolado em `src/domain/webhook` e `src/application/webhook`.
- Credential segue como owner de credenciais, referencias, health, rotacao, revoke, auditoria e compliance.

## 2. Multi Provider Registry

- Registry agora suporta `meta_pages_sandbox`, `linkedin_sandbox` e `x_sandbox`.
- Descriptors de provider foram estendidos com `status`, `oauthType` e `capabilities`.
- Providers sandbox novos implementam conectividade estrutural, publish sandbox, health e receipt verification.
- Policy de canario passou a permitir os tres providers sandbox externos, mantendo producao bloqueada.

## 3. Webhook Domain

- Criado dominio independente para:
  - `WebhookEvent`
  - `WebhookVerification`
  - `ProviderEvent`
  - `NormalizedProviderEvent`
  - `SynchronizationEvent`
  - `WebhookMetrics`
- Nenhuma entidade de Webhook conhece detalhes internos de Publication.

## 4. Webhook Receiver

- Criado receiver publico `POST /webhooks/:provider`.
- Receiver valida HMAC SHA256, timestamp e nonce antes de aceitar o evento.
- Eventos invalidos sao persistidos como verificacao rejeitada, sem normalizar nem sincronizar estado.

## 5. Event Normalization

- Criado normalizer para eventos de provider.
- Eventos externos sao convertidos para eventos canonicos:
  - `PublicationStatusChanged`
  - `ReceiptUpdated`
  - `PublicationDeleted`
  - `PublicationRejected`
  - `PublicationRecovered`
- Metadata e payloads sao sanitizados para reduzir risco de persistencia de secrets.

## 6. Status Synchronization

- Criado `PublicationSynchronizationService` como unica ponte entre eventos normalizados e Publication.
- Sincronizacao atualiza target, plano, receipts e eventos de dominio via portas existentes.
- Eventos rejeitados/deletados marcam falha operacional e registram auditoria.
- Eventos publicados/recuperados podem concluir plano quando todos os targets ficam publicados.

## 7. Multi Credentials

- Connect/disconnect agora existe por provider em `POST /v1/providers/:id/connect` e `POST /v1/providers/:id/disconnect`.
- Meta Pages preserva fluxo OAuth sandbox.
- LinkedIn e X sandbox criam credenciais governadas e synthetic secret no secret store, sem token real em persistencia.
- Escopos obrigatorios agora sao resolvidos por provider.

## 8. Provider Health

- Criado `GET /v1/providers/:id/health`.
- Health usa o contrato do provider adapter.
- Painel web exibe estado do provider selecionado.

## 9. Capability Discovery

- Criado `GET /v1/providers` e `GET /v1/providers/:id`.
- API expõe capacidades por provider: formatos, maximo de midias, agendamento, webhooks, status sync, receipt verification e producao.
- Frontend usa discovery em vez de hardcodear apenas um provider.

## 10. Event Store

- Criada porta `WebhookEventRepositoryPort`.
- Implementados stores em memoria e Postgres.
- Migration `0046_webhook_provider_event_sync.sql` cria tabelas append-oriented para webhook, verificacao, nonce, provider event, normalized event e sync event.

## 11. API

- Novas rotas administrativas:
  - `GET /v1/providers`
  - `GET /v1/providers/:id`
  - `GET /v1/providers/:id/health`
  - `POST /v1/providers/:id/connect`
  - `POST /v1/providers/:id/disconnect`
  - `GET /v1/webhooks`
  - `GET /v1/publication-sync`
  - `POST /v1/publication-sync/run`
- Nova rota publica:
  - `POST /webhooks/:provider`

## 12. Frontend

- Criado painel `web/app/workspaces/[workspaceId]/providers/page.tsx`.
- Criados clients e hooks em `web/features/providers`.
- Sidebar agora inclui entrada `Providers`.
- Tela exibe registry, provider detail, connect/disconnect, health, webhook metrics, eventos normalizados e sync events.

## 13. Observabilidade

- Webhook metrics expõem recebidos, processados, rejeitados, invalid signatures, replays, normalizados e sincronizados.
- Sync events registram status `pending`, `processed`, `ignored` ou `failed`.
- Auditoria operacional registra `publication.sync`.

## 14. Seguranca

- HMAC cobre timestamp, nonce e payload canonico.
- Timestamp tem janela de tolerancia.
- Nonce replay e bloqueado por provider.
- Headers e payloads persistidos sao sanitizados.
- Compliance passou a considerar eventos de webhook no scan de secrets e em checks de seguranca.

## 15. Testes

- Adicionado teste integrado cobrindo:
  - discovery de providers
  - connect sandbox LinkedIn
  - publicacao externa sandbox
  - webhook assinado
  - normalizacao
  - sincronizacao de receipt
  - audit trail
  - rejeicao de assinatura invalida
  - rejeicao de replay por nonce
  - metricas operacionais

## 16. Evidencia Operacional

- `GET /v1/providers` retorna providers sandbox multi-canal com capacidades.
- `POST /v1/providers/linkedin_sandbox/connect` cria credencial governada.
- Publicacao em `linkedin_sandbox` executa em modo `real` apenas sob canario sandbox.
- `GET /v1/webhooks` mostra metricas e eventos recebidos/processados/rejeitados.

## 17. Evidencia de Sincronizacao

- Webhook `receipt_updated` assinado gera `ProviderEvent`, `NormalizedProviderEvent`, `SynchronizationEvent` e evento `receipt_updated` na publicacao.
- `GET /v1/publication-sync` lista eventos de sincronizacao processados.
- Replay do mesmo nonce e assinatura invalida sao rejeitados e contabilizados.

## 18. Evidencia de Isolamento Arquitetural

- Webhook nao importa adapters de provider nem governa credenciais.
- Credential nao depende de Publication para armazenar secrets.
- Publication nao valida HMAC nem conhece formato bruto de webhook.
- A integracao entre Webhook e Publication passa pelo service de sincronizacao e pelas portas existentes.

## 19. Riscos

- LinkedIn e X seguem como sandbox estrutural, sem chamadas reais de API.
- O update de receipt preserva idempotencia criando/retornando receipt existente; nao ha mutacao granular de receipt persistido.
- O payload bruto persistido e canonico via `JSON.stringify`, adequado ao sandbox; providers reais podem exigir raw body byte-for-byte.
- Health real depende dos contratos e limites de cada provider quando credenciais reais forem adicionadas.

## 20. Recomendacoes para Sprint 21

- Integrar um segundo provider real com OAuth e webhook oficial.
- Capturar raw body byte-for-byte no Fastify para webhooks reais.
- Adicionar scheduler de retry/reconcile de sync pendente.
- Promover metricas para Prometheus/OpenTelemetry.
- Adicionar replay tooling operacional para eventos normalizados.
- Manter producao bloqueada ate auditoria de provider real e runbook de incidentes.

## Validacao

- `npm run typecheck` - passou.
- `cd web && npm run typecheck` - passou.
- `npm run test:publication` - passou, 30 testes.
- `npm run architecture:check` - passou.
- `cd web && npm test` - passou, 11 testes.
- `npm test` - passou, 1733 testes.

## Fora de escopo preservado

- Nenhuma publicacao em producao foi habilitada.
- Nenhum provider real novo foi acionado fora de sandbox.
- Nenhuma etapa da Sprint 21 foi iniciada.
