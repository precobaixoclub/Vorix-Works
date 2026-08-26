-- 0070 — Fase 2 do módulo Meta Ads Manager: sincronização de campanhas + árvore de gestão.
--
-- `meta_ad_campaigns`/`meta_ad_sets` (0071)/`meta_ads` (0072) espelham a hierarquia real da
-- Marketing API (campanha → ad set → ad), sempre com FKs reais e `ON DELETE CASCADE` — ao
-- contrário do pacote de referência analisado (bittencourtthulio/meta-graph-api-integration),
-- cujo `ad_sets`/`ads` originais tinham UUIDs soltos sem `REFERENCES` (apagar uma campanha
-- deixava ad sets/ads órfãos, invisíveis na UI mas ainda somando gasto em relatório — o mesmo
-- defeito que as migrations 10/11/12 daquele pacote corrigiam). Aqui nunca existiu essa versão
-- quebrada pra corrigir.
--
-- `status`/`effective_status` são os valores REAIS que a Marketing API devolve
-- (ACTIVE/PAUSED/DELETED/ARCHIVED + variantes de effective_status como
-- CAMPAIGN_PAUSED/ADSET_PAUSED/PENDING_REVIEW/DISAPPROVED...) — texto livre com CHECK nos valores
-- documentados, nunca um enum fechado inventado; a Meta adiciona valores de tempos em tempos.
--
-- `insights`/`targeting`/`promoted_object` ficam em jsonb — estruturas aninhadas e variáveis da
-- própria Meta, replicadas como a API devolve (a mesma filosofia de `creative_context`/
-- `creative_plan` no motor de criativos: nunca reinventar um schema relacional pra algo cujo
-- formato real pertence a um contrato externo). Campos escalares promovidos pra coluna real são
-- só os usados pra ordenar/filtrar a árvore sem precisar abrir o jsonb (nome, status, orçamento,
-- gasto — o que a UI da árvore mostra direto).

create table if not exists meta_ad_campaigns (
  id                  text primary key,
  tenant_id           text not null,
  workspace_id        text not null references workspaces (id) on delete cascade,
  ad_account_id       text not null references meta_ad_accounts (id) on delete cascade,
  -- id da campanha na Meta — nunca reutilizado entre contas diferentes, mas repetimos
  -- ad_account_id na UNIQUE porque duas linhas desta tabela nunca deveriam apontar pro mesmo par.
  campaign_id         text not null,
  name                text not null,
  objective           text,
  status              text not null check (status in ('ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED')),
  effective_status     text,
  buying_type         text,
  special_ad_categories text[],
  daily_budget        numeric(14, 2),
  lifetime_budget     numeric(14, 2),
  budget_remaining    numeric(14, 2),
  -- Métricas promovidas a coluna (a árvore ordena/filtra por gasto o tempo todo) — sempre a
  -- ÚLTIMA sincronização, nunca um agregado histórico (isso é análise, fora de escopo daqui).
  spend               numeric(14, 2),
  impressions         bigint,
  clicks               bigint,
  reach                bigint,
  -- Blob bruto da Meta (`insights{}` da chamada de sync) — todas as métricas que a Marketing API
  -- devolve, incluindo `actions`/conversões, preservado integralmente pra tela de detalhe.
  insights             jsonb,
  start_time           timestamptz,
  stop_time            timestamptz,
  meta_created_time    timestamptz,
  last_synced_at       timestamptz,
  -- Soft delete: a campanha sumiu da Meta (ou foi apagada) mas a linha fica pra histórico —
  -- nunca DELETE físico, mesmo raciocínio de `deleted_at` em `campaigns` (calendário editorial).
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (ad_account_id, campaign_id)
);

create index if not exists meta_ad_campaigns_tenant_id_idx on meta_ad_campaigns (tenant_id);
create index if not exists meta_ad_campaigns_workspace_status_idx on meta_ad_campaigns (workspace_id, status) where deleted_at is null;
create index if not exists meta_ad_campaigns_ad_account_idx on meta_ad_campaigns (ad_account_id);
