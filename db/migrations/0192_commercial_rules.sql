-- Additive: no changes to catalog prices, historical totals or existing settings.
create table if not exists commerce_rules (
 id text primary key, tenant_id text not null, workspace_id text not null, site_id text not null,
 definition jsonb not null check(jsonb_typeof(definition)='object'),
 revision integer not null default 1 check(revision>0),
 created_by_user_id text not null, updated_by_user_id text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(tenant_id,site_id) references tenant_sites(tenant_id,id) on delete cascade
);
create index if not exists commerce_rules_scope_idx on commerce_rules(tenant_id,workspace_id,site_id);
create unique index if not exists commerce_rules_coupon_idx on commerce_rules(site_id,upper(definition->>'couponCode')) where definition->>'couponCode' is not null;
create table if not exists commerce_rule_audit (
 id text primary key, tenant_id text not null, workspace_id text not null, site_id text not null,
 rule_id text not null, actor_user_id text not null, action text not null check(action in ('CREATE','UPDATE','DELETE')),
 revision integer not null, definition jsonb not null, created_at timestamptz not null default now()
);
create index if not exists commerce_rule_audit_scope_idx on commerce_rule_audit(tenant_id,workspace_id,site_id,created_at);
alter table site_carts add column if not exists coupon_code text;
alter table commerce_order_items add column if not exists pricing_snapshot jsonb;
