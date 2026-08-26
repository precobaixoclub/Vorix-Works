-- 0072 — `meta_ads`, nível folha da hierarquia (campanha → ad set → AD). FK real pra
-- `meta_ad_sets` com CASCADE — mesmo raciocínio de 0070/0071.
--
-- `creative` fica em jsonb — a estrutura de criativo da Marketing API (`object_story_spec`, link,
-- imagem/vídeo, call_to_action) é aninhada e específica de cada tipo de anúncio (IMAGE/VIDEO/
-- CAROUSEL); replicar em colunas relacionais faria mais sentido só quando a Fase 3 (criação)
-- precisar montar o payload de criação — reavaliado nessa fase, não antes.

create table if not exists meta_ads (
  id                    text primary key,
  tenant_id             text not null,
  workspace_id          text not null references workspaces (id) on delete cascade,
  ad_set_id             text not null references meta_ad_sets (id) on delete cascade,
  campaign_id           text not null references meta_ad_campaigns (id) on delete cascade,
  ad_account_id         text not null references meta_ad_accounts (id) on delete cascade,
  ad_id                 text not null,
  name                  text not null,
  status                text not null check (status in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED')),
  effective_status      text,
  creative              jsonb,
  spend                 numeric(14, 2),
  impressions           bigint,
  clicks                bigint,
  reach                 bigint,
  -- Engajamento/vídeo — únicas métricas específicas do nível "ad" que valem a pena promover a
  -- coluna (a árvore de anúncios individuais ordena por elas com frequência); o resto vive em
  -- `insights`.
  video_completion_rate numeric(6, 4),
  negative_feedback     bigint,
  insights              jsonb,
  meta_created_time     timestamptz,
  last_synced_at        timestamptz,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (ad_account_id, ad_id)
);

create index if not exists meta_ads_tenant_id_idx on meta_ads (tenant_id);
create index if not exists meta_ads_ad_set_idx on meta_ads (ad_set_id) where deleted_at is null;
create index if not exists meta_ads_campaign_idx on meta_ads (campaign_id);
create index if not exists meta_ads_ad_account_idx on meta_ads (ad_account_id);
