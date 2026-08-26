-- 0073 — Fase 4 do módulo Meta Ads Manager: públicos customizados e semelhantes (lookalike).
--
-- `subtype` é gravado como o texto cru que a Marketing API devolve, SEM check constraint — o
-- valor real que este app cria é `CUSTOM` (lista de clientes hasheada, `customer_file_source`) ou
-- `LOOKALIKE`, mas o sync também traz públicos criados fora daqui (Business Manager), cujo
-- `subtype` pode ser qualquer um dos ~15 valores da API (`WEBSITE`, `ENGAGEMENT`,
-- `OFFLINE_CONVERSION`, `APP`, `PARTNER`...) — uma lista fixa aqui quebraria o sync no primeiro
-- público com um subtype fora do que foi adivinhado na hora de escrever esta migration.
--
-- `lookalike_*` só é preenchido pra subtype='LOOKALIKE'; `lookalike_origin_audience_id` referencia
-- outra linha desta MESMA tabela (o público de origem), com `on delete set null` — se o público de
-- origem for removido daqui, o lookalike continua existindo de verdade na Meta, só perde o
-- vínculo local.
--
-- Nunca guarda dado de PII (e-mail/telefone, hasheado ou não) — só o `approximate_count` que a
-- Meta calcula e devolve. O upload da lista hasheada (`create-meta-custom-audience.ts`) manda os
-- hashes direto pra Marketing API e descarta em seguida.

create table if not exists meta_custom_audiences (
  id                          text primary key,
  tenant_id                   text not null,
  workspace_id                text not null references workspaces (id) on delete cascade,
  ad_account_id               text not null references meta_ad_accounts (id) on delete cascade,
  audience_id                 text not null,
  name                        text not null,
  subtype                     text not null,
  description                 text,
  approximate_count           bigint,
  operation_status            jsonb,
  delivery_status             jsonb,
  lookalike_origin_audience_id text references meta_custom_audiences (id) on delete set null,
  lookalike_ratio             numeric(4, 3),
  lookalike_country           text,
  last_synced_at              timestamptz,
  deleted_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  unique (ad_account_id, audience_id)
);

create index if not exists meta_custom_audiences_tenant_id_idx on meta_custom_audiences (tenant_id);
create index if not exists meta_custom_audiences_ad_account_idx on meta_custom_audiences (ad_account_id) where deleted_at is null;
create index if not exists meta_custom_audiences_lookalike_origin_idx on meta_custom_audiences (lookalike_origin_audience_id);
