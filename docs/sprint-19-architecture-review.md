# Sprint 19 - Revisao Arquitetural

Status: aguardando aprovacao. Nenhum codigo funcional da Sprint 19 foi implementado.

Esta revisao atende a Fase 1 do Prompt 19. O objetivo da sprint e governanca operacional, credenciais, auditoria e compliance para publicacao externa. Production continua bloqueada e nenhum novo provider deve ser criado.

## 1. OAuth

Estado atual:

- `MetaPagesOAuthService` implementa begin, callback, token exchange, long-lived token, resolucao de page e disconnect.
- O state OAuth e aleatorio, expira em 10 minutos e fica em memoria.
- O token e salvo no `LocalPublicationSecretStore`; o dominio Publication recebe apenas `PublicationCredentialReference` com metadata nao secreta.
- O status OAuth retorna credential references nao secretas e telemetria em memoria.

Riscos:

- State em memoria nao sobrevive restart, nao e assinado e nao tem trilha de auditoria imutavel.
- Callback OAuth exige `publication:admin`, mas o Prompt 19 pede permissoes especificas `credential:connect` e `credential:disconnect`.
- Erros de OAuth incrementam telemetria, mas nao geram audit trail consultavel.
- Nao existe comando administrativo "reconnect"; reconnect hoje seria uma nova chamada ad hoc para connect.
- Token refresh ainda acontece apenas durante callback inicial; nao ha workflow de refresh/rotacao administrativa.

Gate antes de implementacao:

- Mover OAuth administrativo para o novo dominio Credential.
- Auditar begin, callback success/failure, disconnect, reconnect e rotacao.
- Fazer o callback produzir `CredentialReference` independente de Publication.
- Manter Meta Pages Sandbox como unico provider.

## 2. Secret Resolver

Estado atual:

- `PublicationSecretStoragePort` possui `put`, `get`, `delete` e `health`.
- `LocalPublicationSecretStore` e in-memory.
- `CompositePublicationSecretResolver` direciona `dry_run`/`fake` para fake resolver e demais providers para stored resolver.

Riscos:

- Secret store ainda esta dentro de `application/publication`; o Prompt 19 exige dominio Credential independente.
- `delete` remove o segredo local, mas nao ha tombstone/auditoria para provar revogacao.
- Nao ha health por credential: token valido, escopos, expiracao, provider subject e ultimo refresh.
- Resolver retorna segredo por `credentialReferenceId`, mas reconciliation/verification ainda chamam resolver sem credential reference em alguns caminhos.

Gate antes de implementacao:

- Criar uma porta `CredentialSecretStorePort` fora de Publication.
- Publication deve depender apenas de `CredentialReferenceId` e de uma porta de resolucao governada.
- Resolver deve validar status, expiry, scopes e policy antes de entregar segredo ao adapter.

## 3. Credential Reference

Estado atual:

- `PublicationCredentialReference` esta no dominio Publication.
- Estados atuais: `active`, `disabled`, `revoked`.
- Metadata atual: environment, providerSubjectId, scopes, expiresAt, lastRefreshedAt, revokedAt.
- Migration `0044` adicionou metadata nao secreta em `publication_credential_references`.

Riscos:

- Prompt 19 exige dominio independente: `Credential`, `CredentialReference`, `CredentialBinding`, `CredentialStatus`, `CredentialRotation`, `CredentialAudit`, `CredentialPolicy`, `CredentialHealth`.
- Estados pedidos nao existem: `pending`, `connected`, `expiring`, `expired`, `invalid`, `rotation_pending`.
- `createCredentialReference` faz upsert logico na pratica dos adapters, mas sem historico formal de rotacao.
- Ainda nao ha binding explicito entre credential e publication provider/workspace/canary.

Gate antes de implementacao:

- Introduzir tabelas e modelos independentes de Credential.
- Manter tabela antiga Publication como compatibilidade temporaria ou migrar para reference-only.
- PublicationOutbox deve guardar o id da credential reference usada para preservar receipts antigos.

## 4. Publication Provider

Estado atual:

- Provider real unico: `meta_pages_sandbox`.
- `MetaPagesSandboxProvider` implementa publish, getStatus, verifyReceipt, health e capabilities.
- Production esta bloqueada por config/policy.
- Adapter captura rate limit generico e telemetria segura em memoria.

Riscos:

- Health atual do provider nao valida token/credential especifica.
- Adapter nao conhece `requiredScopes` nem compara `grantedScopes`.
- Erros oficiais da Meta sao mapeados em categorias internas, mas sem auditoria de admin action/policy result.
- Status lookup depende de `providerPublicationId`; unknown outcome sem external id continua inconclusivo.

Gate antes de implementacao:

- Health de provider deve aceitar contexto de credential.
- Governance policy deve bloquear publish quando credential estiver expirada, faltando scope, revogada, disabled ou fora de binding.
- Nao adicionar segundo provider.

## 5. Outbox

Estado atual:

- Durable Outbox existe com claim, lease, fencing, retry, unknown outcome sem retry cego, dead letter e reprocessamento.
- Manual retry e reprocessamento existem em rotas de Publication.

Riscos:

- Retry manual e reprocessamento nao geram audit event administrativo.
- Admin action nao passa por uma policy engine central; passa por RBAC da rota e por logica local.
- Outbox nao registra quem disparou retry/reprocess como audit trail imutavel.
- Reprocessamento pode reabrir uma mensagem sem registrar justificativa de compliance.

Gate antes de implementacao:

- Criar comandos administrativos auditados para retry/reprocess.
- Exigir `AuditContext` com actor, reason, requestId, tenantId, workspaceId.
- Registrar policy allow/deny para cada acao administrativa.

## 6. Reconciliation

Estado atual:

- `PublicationReconciliationService` consulta provider, confirma published/not published ou marca inconclusive.
- Receipt verification cria registros novos e nao altera receipt.

Riscos:

- `reconcile` resolve secret sem `credentialReferenceId`; apos rotacao/revogacao pode usar a credencial errada.
- `verifyReceipts` tambem resolve secret sem referencia explicita do receipt.
- Reconciliation manual nao e auditada.
- Inconclusive nao tem workflow administrativo governado.

Gate antes de implementacao:

- Reconciliation deve usar credential binding historico quando houver external verification.
- Rotacao nao pode apagar a referencia antiga usada por receipts.
- Reconcile/verify devem ser administrative actions auditadas com permissao granular.

## 7. Receipt Verification

Estado atual:

- Verification e append-only: cria `PublicationReceiptVerification`.
- Receipt nao e mutado.

Riscos:

- Verification nao registra actor quando disparada por rota administrativa.
- Nao ha exportacao de publication history/receipt verification.
- Nao ha compliance report validando ausencia de tokens em receipt/event/failure/log.

Gate antes de implementacao:

- Vincular verification a audit event.
- Exportar verification e receipt history em JSON/CSV.
- Adicionar checks de compliance sobre payloads e tokens.

## 8. Canary

Estado atual:

- `PublicationProviderPolicy` valida provider, feature flag, tenant, workspace e production.
- Fora do canary, create publication cai para `dry_run`.

Riscos:

- Mudancas de canary sao variaveis de ambiente, sem endpoint e sem audit trail.
- Policy atual nao valida credential, scopes, approval, RBAC nem admin action.
- O nome/mensagem ainda referencia Sprint 18.

Gate antes de implementacao:

- Criar `PublicationGovernancePolicy` central.
- Incluir policy decisions auditaveis: allowed/denied, reason, actor, resource.
- Sem endpoint de mudar canary nesta sprint a menos que seja auditado e coberto por RBAC.

## 9. RBAC

Estado atual:

- Permissoes de Publication existem: read, create, approve, publish, cancel, operate, reconcile, admin.
- Owner/admin possuem todos os poderes de publication.
- Editor cria publication, viewer le.

Lacunas frente ao Prompt 19:

- Nao existem `credential:read`, `credential:update`, `credential:rotate`, `credential:revoke`, `credential:connect`, `credential:disconnect`.
- Nao existe `audit:read`.
- Nao existe `provider:operate`.
- RBAC denial retorna 403, mas nao grava audit event de denial/policy violation.

Gate antes de implementacao:

- Expandir `Permission` e `ROLE_PERMISSIONS`.
- Mapear permissoes de forma conservadora: viewer sem credential/audit por default; admin/owner com credential/admin; provider operations restritas.
- Auditar RBAC denial para rotas de governanca.

## 10. Auditoria Existente

Estado atual:

- `AuditLogPort` registra eventos de identidade: login success/failure, logout, refresh, refresh replay e tenant switch.
- `auth_audit_log` e append-only por comportamento: ha insert, nao update.
- Nao existe consulta/exportacao de audit events na API.

Riscos:

- Tipo de evento e constraint SQL sao fechados para identidade.
- Falta modelo generico `AuditEvent`, `AuditActor`, `AuditResource`, `AuditContext`, `AuditResult`.
- Falta audit immutability formal: nao ha API de update, mas tambem nao ha policy/constraint/documentacao para eventos operacionais.
- Administrative actions de Publication/OAuth nao sao auditadas.
- Logs atuais de erro podem conter stack em logs internos; compliance precisa avaliar segredo/log/payload.

Gate antes de implementacao:

- Criar audit log operacional separado ou generalizar sem quebrar auth audit existente.
- Inserir apenas; correcoes devem gerar novo evento.
- Criar `GET /v1/audit` com `audit:read` e filtros por tenant/workspace/resource.

## 11. Riscos de Credenciais

- Token local em memoria e perdido no restart.
- Revogacao apaga segredo e faz upsert de reference, mas sem historico robusto.
- Credencial antiga pode ser necessaria para verificar receipts antigos.
- Scope insuficiente nao e detectado antes do publish.
- Expiracao nao bloqueia publish por policy hoje.
- Rotacao manual/agendada nao existe.

Mitigacoes propostas:

- Credential domain append-friendly.
- `CredentialRotation` com old/new reference preservadas.
- Health por credential e policy deny antes de dispatch.
- Required/granted/missing scopes persistidos.

## 12. Riscos de Auditoria

- Acoes administrativas atuais nao deixam trilha imutavel.
- Retry/reprocess/reconcile podem alterar estado operacional sem justificativa.
- Mudancas de policy/canary via env nao sao auditaveis.
- Auditoria de identidade nao e suficiente para compliance de provider externo.

Mitigacoes propostas:

- `AuditEvent` generico para admin/governance.
- Toda acao admin deve receber actor, reason e contexto.
- Denials de RBAC/policy tambem devem virar audit events.

## 13. Riscos de Acesso Privilegiado

- `publication:admin` agrega connect/disconnect/dead-letter reprocess.
- Owner/admin tem permissao ampla sem separacao de duties.
- Nao ha confirmacao/justificativa obrigatoria para rotacao/revogacao/reprocess.

Mitigacoes propostas:

- Permissoes granulares de credential/audit/provider.
- Comandos administrativos com reason obrigatorio.
- Export auditavel de historico administrativo.

## 14. Lacunas de Compliance

- Nao ha relatorio LGPD/retencao/anonimizacao.
- Nao ha scanner de tokens em audit/events/receipts/failures.
- Nao ha export CSV/JSON.
- Nao ha retention policy por recurso.
- Nao ha classificacao de payload sensivel em Publication history.

Gate antes de implementacao:

- Criar `ComplianceReport` com checks deterministicos.
- Exportar audit, credential history e publication history sem segredos.
- Testar que tokens nao aparecem em banco de dominio, audit, receipts, events ou exports.

## 15. Modelo Proposto para Fase 2+

Dominios novos:

- `Credential`: identidade operacional da integracao por tenant/workspace/provider.
- `CredentialReference`: referencia opaca usada por Publication.
- `CredentialBinding`: vinculo tenant/workspace/provider/environment/canary.
- `CredentialRotation`: historico de old/new reference, reason, actor, status.
- `CredentialAudit`: ponte para AuditEvent ou eventos de credential.
- `CredentialPolicy`: required scopes, rotation window, allowed environment, max age.
- `CredentialHealth`: connected, token valid, expiration, scopes, provider, refresh, last sync.

Audit generico:

- `AuditEvent`;
- `AuditActor`;
- `AuditResource`;
- `AuditContext`;
- `AuditResult`.

Policy:

- `PublicationGovernancePolicy` deve validar tenant, workspace, provider, environment, canary, credential, approval e RBAC.

## 16. Sequenciamento Recomendado

1. Criar modelos e portas de Credential e Audit operacional.
2. Criar migrations append-only para credential/audit/compliance export.
3. Migrar OAuth Meta Pages Sandbox para criar credential independente.
4. Fazer Publication referenciar `CredentialReference` novo.
5. Implementar Credential health/scopes/rotation/revocation.
6. Implementar administrative commands auditados.
7. Adicionar API `/v1/credentials`, `/v1/audit`, `/v1/compliance`.
8. Adicionar frontend Governanca.
9. Cobrir testes e executar todos os checks pedidos.

## 17. Decisao Requerida

Para iniciar implementacao, aprovar explicitamente:

1. Criar dominio independente `Credential`, sem dependencia de Publication.
2. Manter `meta_pages_sandbox` como unico provider.
3. Manter production bloqueada.
4. Criar audit log operacional append-only separado do `auth_audit_log` ou generalizado de forma compativel.
5. Adicionar permissoes granulares de credential/audit/provider.
6. Exigir audit context/reason em comandos administrativos.
7. Permitir secret store local nesta sprint, sem secret manager real.

Sem essa aprovacao, a Sprint 19 permanece somente em revisao arquitetural.
