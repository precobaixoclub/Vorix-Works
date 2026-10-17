-- 0155 — Sales Engine (Vorix Conversas), fases 1–4: catálogo com preços formais (custo, tabela,
-- mínimo), tabelas de preço, variações, itens da oportunidade com snapshot comercial, política
-- comercial + aprovações, fechamento (ganho/perda) com snapshot definitivo, motivos e concorrentes.
-- Tudo aditivo: nenhuma coluna existente muda de significado. `products.price_cents` continua
-- sendo o PREÇO DE TABELA; `deals.value_cents` continua sendo o valor da oportunidade (agora pode
-- ser calculado pelos itens quando `value_mode = 'calculated'`).

-- 1. Catálogo -----------------------------------------------------------------------------------
alter table products
  add column if not exists code text,
  add column if not exists category text,
  add column if not exists item_type text not null default 'product',
  add column if not exists unit text,
  add column if not exists billing_type text not null default 'one_time',
  add column if not exists cost_cents bigint,
  add column if not exists minimum_price_cents bigint,
  add column if not exists commission_type text,
  add column if not exists commission_value bigint,
  add column if not exists tax_metadata jsonb not null default '{}';

do $$ begin
  alter table products add constraint products_item_type_check check (item_type in ('product', 'service'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table products add constraint products_billing_type_check check (billing_type in ('one_time', 'monthly', 'quarterly', 'annual', 'per_unit', 'per_hour', 'custom'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table products add constraint products_commission_type_check check (commission_type is null or commission_type in ('percent', 'fixed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table products add constraint products_prices_non_negative check (coalesce(cost_cents, 0) >= 0 and coalesce(minimum_price_cents, 0) >= 0);
exception when duplicate_object then null; end $$;

create table if not exists product_variants (
  id                  text primary key,
  tenant_id           text not null,
  workspace_id        text not null references workspaces (id) on delete cascade,
  product_id          text not null references products (id) on delete cascade,
  name                text not null,
  code                text,
  cost_cents          bigint,
  list_price_cents    bigint not null default 0,
  minimum_price_cents bigint,
  active              boolean not null default true,
  position            integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists product_variants_product_idx on product_variants (product_id, position);

create table if not exists price_books (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  name         text not null,
  description  text,
  currency     text not null default 'BRL',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists price_books_workspace_idx on price_books (tenant_id, workspace_id);

create table if not exists price_book_items (
  id                  text primary key,
  price_book_id       text not null references price_books (id) on delete cascade,
  product_id          text not null references products (id) on delete cascade,
  variant_id          text references product_variants (id) on delete cascade,
  list_price_cents    bigint not null check (list_price_cents >= 0),
  minimum_price_cents bigint check (minimum_price_cents is null or minimum_price_cents >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists price_book_items_unique_idx on price_book_items (price_book_id, product_id, coalesce(variant_id, ''));

-- 2. Etapas: probabilidade, estagnação, campos obrigatórios ---------------------------------------
alter table pipeline_stages
  add column if not exists probability integer,
  add column if not exists stale_after_days integer,
  add column if not exists required_fields text[] not null default '{}';
do $$ begin
  alter table pipeline_stages add constraint pipeline_stages_probability_check check (probability is null or probability between 0 and 100);
exception when duplicate_object then null; end $$;

-- 3. Oportunidade: status explícito, modo de valor, forecast, snapshot de fechamento ---------------
alter table deals
  add column if not exists status text not null default 'open',
  add column if not exists value_mode text not null default 'manual',
  add column if not exists probability integer,
  add column if not exists forecast_category text not null default 'pipeline',
  add column if not exists price_book_id text references price_books (id) on delete set null,
  add column if not exists discount_cents bigint not null default 0,
  add column if not exists contract_months integer,
  add column if not exists custom_fields jsonb not null default '{}',
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by_user_id text,
  add column if not exists credited_owner_user_id text,
  add column if not exists credited_team_id text,
  add column if not exists won_reason text,
  add column if not exists close_comment text,
  add column if not exists competitor_id text,
  add column if not exists final_snapshot jsonb,
  add column if not exists final_value_cents bigint,
  add column if not exists final_cost_cents bigint,
  add column if not exists final_gross_profit_cents bigint,
  add column if not exists final_margin_bp integer,
  add column if not exists final_mrr_cents bigint,
  add column if not exists final_arr_cents bigint,
  add column if not exists final_tcv_cents bigint,
  add column if not exists won_proposal_id text;
do $$ begin
  alter table deals add constraint deals_status_check check (status in ('open', 'won', 'lost', 'cancelled'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table deals add constraint deals_value_mode_check check (value_mode in ('manual', 'calculated'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table deals add constraint deals_forecast_category_check check (forecast_category in ('pipeline', 'best_case', 'commit', 'closed', 'omitted'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table deals add constraint deals_probability_check check (probability is null or probability between 0 and 100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table deals add constraint deals_contract_months_check check (contract_months is null or contract_months between 1 and 600);
exception when duplicate_object then null; end $$;

-- Backfill: negócios já ganhos/perdidos ganham status e crédito a partir do que existia.
update deals set status = 'won', closed_at = coalesce(closed_at, won_at), credited_owner_user_id = coalesce(credited_owner_user_id, owner_user_id),
  credited_team_id = coalesce(credited_team_id, team_id), final_value_cents = coalesce(final_value_cents, value_cents), forecast_category = 'closed'
  where won_at is not null and status = 'open';
update deals set status = 'lost', closed_at = coalesce(closed_at, lost_at), forecast_category = 'omitted'
  where lost_at is not null and status = 'open';

create index if not exists deals_status_closed_idx on deals (tenant_id, workspace_id, status, closed_at);
create index if not exists deals_credited_owner_idx on deals (workspace_id, credited_owner_user_id) where status = 'won';

create table if not exists deal_items (
  id                           text primary key,
  tenant_id                    text not null,
  workspace_id                 text not null references workspaces (id) on delete cascade,
  deal_id                      text not null references deals (id) on delete cascade,
  product_id                   text references products (id) on delete set null,
  variant_id                   text references product_variants (id) on delete set null,
  position                     integer not null default 0,
  product_name_snapshot        text not null,
  product_code_snapshot        text,
  billing_type_snapshot        text not null default 'one_time',
  unit_snapshot                text,
  quantity                     numeric(14, 3) not null check (quantity > 0),
  unit_cost_cents_snapshot     bigint,
  list_price_cents_snapshot    bigint not null default 0,
  minimum_price_cents_snapshot bigint,
  proposed_unit_price_cents    bigint not null check (proposed_unit_price_cents >= 0),
  subtotal_list_cents          bigint not null default 0,
  subtotal_proposed_cents      bigint not null default 0,
  subtotal_cost_cents          bigint,
  discount_cents               bigint not null default 0,
  gross_profit_cents           bigint,
  gross_margin_bp              integer,
  commission_type_snapshot     text,
  commission_value_snapshot    bigint,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);
create index if not exists deal_items_deal_idx on deal_items (deal_id, position);
create index if not exists deal_items_product_idx on deal_items (workspace_id, product_id);

create table if not exists deal_participants (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  deal_id      text not null references deals (id) on delete cascade,
  contact_id   text not null references contacts (id) on delete cascade,
  role         text not null default 'other' check (role in ('decision_maker', 'influencer', 'user', 'financial', 'other')),
  created_at   timestamptz not null default now(),
  unique (deal_id, contact_id)
);

create table if not exists deal_custom_field_definitions (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  key          text not null,
  label        text not null,
  field_type   text not null check (field_type in ('text', 'number', 'currency', 'date', 'select', 'multi_select', 'boolean')),
  options      jsonb not null default '[]',
  position     integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, key)
);

-- 4. Motivos de ganho/perda/recusa e concorrentes (configuráveis por workspace) -------------------
create table if not exists sales_close_reasons (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  kind         text not null check (kind in ('won', 'lost', 'proposal_decline')),
  label        text not null,
  position     integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists sales_close_reasons_workspace_idx on sales_close_reasons (workspace_id, kind, position);

create table if not exists sales_competitors (
  id           text primary key,
  tenant_id    text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  name         text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create unique index if not exists sales_competitors_name_idx on sales_competitors (workspace_id, lower(name));

-- 5. Configuração comercial do workspace + política de autonomia + aprovações ------------------------
create table if not exists commercial_settings (
  workspace_id               text primary key references workspaces (id) on delete cascade,
  tenant_id                  text not null,
  sellers_can_view_cost      boolean not null default false,
  sellers_can_view_margin    boolean not null default true,
  deal_visibility            text not null default 'all' check (deal_visibility in ('all', 'team', 'own')),
  proposal_accept_auto_win   boolean not null default false,
  proposal_whatsapp_template text,
  proposal_reminder_template text,
  default_contract_months    integer check (default_contract_months is null or default_contract_months between 1 and 600),
  ranking_enabled            boolean not null default false,
  updated_at                 timestamptz not null default now()
);

create table if not exists commercial_policies (
  id                  text primary key,
  tenant_id           text not null,
  workspace_id        text not null references workspaces (id) on delete cascade,
  scope_type          text not null check (scope_type in ('workspace', 'role', 'team', 'user')),
  scope_id            text,
  min_margin_bp       integer check (min_margin_bp is null or min_margin_bp between -100000 and 10000),
  max_discount_bp     integer check (max_discount_bp is null or max_discount_bp between 0 and 10000),
  allow_below_minimum boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists commercial_policies_scope_idx on commercial_policies (workspace_id, scope_type, coalesce(scope_id, ''));

create table if not exists commercial_approval_requests (
  id                   text primary key,
  tenant_id            text not null,
  workspace_id         text not null references workspaces (id) on delete cascade,
  deal_id              text not null references deals (id) on delete cascade,
  proposal_id          text references proposals (id) on delete set null,
  requested_by_user_id text not null,
  status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  justification        text,
  terms_fingerprint    text not null,
  reasons              text[] not null default '{}',
  snapshot             jsonb not null default '{}',
  decided_by_user_id   text,
  decided_at           timestamptz,
  decision_reason      text,
  approved_value_cents bigint,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists commercial_approvals_workspace_idx on commercial_approval_requests (tenant_id, workspace_id, status, created_at desc);
create index if not exists commercial_approvals_deal_idx on commercial_approval_requests (deal_id, created_at desc);
create unique index if not exists commercial_approvals_one_pending_idx on commercial_approval_requests (deal_id, terms_fingerprint) where status = 'pending';
