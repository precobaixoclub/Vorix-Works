-- 0141 -- Creative Engine commercial entitlement.
-- Workspace-scoped, fail-closed by default. Existing customers are not enabled by this migration.

create table if not exists creative_engine_global_settings (
  id text primary key default 'singleton' check (id = 'singleton'),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into creative_engine_global_settings (id, enabled)
values ('singleton', true)
on conflict (id) do nothing;

create table if not exists creative_engine_workspace_entitlements (
  tenant_id text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  capability text not null default 'creative_engine' check (capability = 'creative_engine'),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  reason text,
  primary key (tenant_id, workspace_id, capability)
);

create index if not exists creative_engine_workspace_entitlements_enabled_idx
  on creative_engine_workspace_entitlements (tenant_id, workspace_id)
  where enabled;

create index if not exists creative_engine_workspace_entitlements_workspace_idx
  on creative_engine_workspace_entitlements (workspace_id);

create table if not exists creative_engine_entitlement_audit_log (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  capability text not null check (capability = 'creative_engine'),
  old_value boolean,
  new_value boolean not null,
  actor_user_id text,
  reason text,
  occurred_at timestamptz not null default now()
);

create index if not exists creative_engine_entitlement_audit_tenant_workspace_idx
  on creative_engine_entitlement_audit_log (tenant_id, workspace_id, occurred_at desc);
