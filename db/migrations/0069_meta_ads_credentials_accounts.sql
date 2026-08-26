-- 0069 — Fase 1 do módulo Meta Ads Manager (gestão de campanhas/anúncios via Marketing API).
--
-- DELIBERADAMENTE separado do domínio de publicação de conteúdo (`publication_*`, migrations
-- 0043/0044): uma conta de anúncios não é uma "publicação" — não tem candidato, alvo, outbox nem
-- recibo. Reaproveita só a TABELA física `publication_credential_references` (já é um armazém
-- genérico de referência de credencial por tenant/workspace/provider, sem nenhuma FK/CHECK
-- amarrando `provider_id` ao vocabulário de publicação — ver migration 0043), nunca o PORT
-- `PublicationRepositoryPort`, cujo `PublicationCredentialReference.providerId` é tipado ao union
-- fechado `PublicationProvider` (só canais de conteúdo). Um port novo e estreito
-- (`MetaAdsCredentialRepositoryPort`) evita que "meta_ads"/"instagram_dm" vazem pra dentro da
-- lógica de roteamento de publicação, que não tem nada a ver com anúncios pagos.
--
-- `meta_ad_accounts` é o equivalente de `facebook_ad_accounts` do pacote de referência analisado
-- (bittencourtthulio/meta-graph-api-integration) — mas sem tabela `facebook_integrations` própria,
-- porque o Vorix já tem essa camada genérica (credential_references + operational_secrets +
-- credential governance). O valor do token (usuário de longa duração + Page Access Token, quando
-- aplicável) fica cifrado em `operational_secrets`, nunca em coluna de texto aqui.

create table if not exists meta_ad_accounts (
  id                      text primary key,
  tenant_id               text not null,
  workspace_id            text not null references workspaces (id) on delete cascade,
  credential_reference_id text not null references publication_credential_references (credential_reference_id) on delete cascade,
  -- Formato exigido pela Marketing API: "act_<digits>". Normalizado em código
  -- (`toActAccountId`/`toRawAccountId`, ver `meta-graph-client.ts`) — nunca assumido já correto.
  account_id              text not null,
  name                    text not null,
  currency                text not null default 'USD',
  -- Código numérico da Meta (1 = ACTIVE; ver `account_status` na documentação da Marketing API) —
  -- guardado cru, nunca traduzido/interpretado aqui; a UI decide o rótulo.
  account_status          int,
  business_name           text,
  timezone_name           text,
  spend_cap               numeric(14, 2),
  balance                 numeric(14, 2),
  disable_reason          text,
  is_active               boolean not null default true,
  last_synced_at          timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (workspace_id, credential_reference_id, account_id)
);

create index if not exists meta_ad_accounts_tenant_id_idx on meta_ad_accounts (tenant_id);
-- Query dominante: "todas as contas de anúncio ativas deste workspace" (tela de conexão + seletor
-- de conta no builder de campanha).
create index if not exists meta_ad_accounts_workspace_active_idx on meta_ad_accounts (workspace_id, is_active);
create index if not exists meta_ad_accounts_credential_reference_idx on meta_ad_accounts (credential_reference_id);
