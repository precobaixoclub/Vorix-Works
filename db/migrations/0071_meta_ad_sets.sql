-- 0071 — `meta_ad_sets`, nível intermediário da hierarquia (campanha → ad set → ad). FK real pra
-- `meta_ad_campaigns` com CASCADE — ver comentário de 0070 sobre o defeito de UUID solto do
-- pacote de referência analisado, nunca reproduzido aqui.
--
-- `targeting` fica em jsonb — a estrutura de segmentação da Marketing API é profundamente
-- aninhada e cresce livremente (geo_locations, interests, custom_audiences, exclusions...);
-- replicar em colunas relacionais seria reinventar um schema que já existe e muda com a API.

create table if not exists meta_ad_sets (
  id                    text primary key,
  tenant_id             text not null,
  workspace_id          text not null references workspaces (id) on delete cascade,
  campaign_id           text not null references meta_ad_campaigns (id) on delete cascade,
  ad_account_id         text not null references meta_ad_accounts (id) on delete cascade,
  ad_set_id             text not null,
  name                  text not null,
  status                text not null check (status in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED')),
  effective_status      text,
  optimization_goal     text,
  billing_event         text,
  bid_amount            numeric(14, 2),
  daily_budget          numeric(14, 2),
  lifetime_budget       numeric(14, 2),
  targeting             jsonb,
  spend                 numeric(14, 2),
  impressions           bigint,
  clicks                bigint,
  reach                 bigint,
  insights              jsonb,
  start_time            timestamptz,
  end_time              timestamptz,
  meta_created_time     timestamptz,
  last_synced_at        timestamptz,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (ad_account_id, ad_set_id)
);

create index if not exists meta_ad_sets_tenant_id_idx on meta_ad_sets (tenant_id);
create index if not exists meta_ad_sets_campaign_idx on meta_ad_sets (campaign_id) where deleted_at is null;
create index if not exists meta_ad_sets_ad_account_idx on meta_ad_sets (ad_account_id);
