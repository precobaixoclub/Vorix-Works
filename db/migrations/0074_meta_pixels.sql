-- 0074 — Fase 4 do módulo Meta Ads Manager: Pixels do Meta (rastreamento de conversão), a base
-- pra Conversions API (0075). Um pixel pode ser criado por este app ou já existir no Business
-- Manager — `sync-meta-pixels.ts` cobre os dois casos com o mesmo upsert de sempre.

create table if not exists meta_pixels (
  id               text primary key,
  tenant_id        text not null,
  workspace_id     text not null references workspaces (id) on delete cascade,
  ad_account_id    text not null references meta_ad_accounts (id) on delete cascade,
  pixel_id         text not null,
  name             text not null,
  last_fired_time  timestamptz,
  is_active        boolean not null default true,
  last_synced_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (ad_account_id, pixel_id)
);

create index if not exists meta_pixels_tenant_id_idx on meta_pixels (tenant_id);
create index if not exists meta_pixels_ad_account_idx on meta_pixels (ad_account_id);
