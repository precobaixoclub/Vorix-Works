create table if not exists credentials (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  provider_id text not null,
  environment text not null,
  status text not null,
  active_reference_id text,
  provider_subject_id text,
  required_scopes text[] not null default '{}',
  granted_scopes text[] not null default '{}',
  missing_scopes text[] not null default '{}',
  expires_at timestamptz,
  last_health_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credentials_environment_check check (environment in ('sandbox', 'production')),
  constraint credentials_status_check check (status in ('pending', 'connected', 'expiring', 'expired', 'revoked', 'invalid', 'disabled', 'rotation_pending'))
);

create index if not exists idx_credentials_tenant_workspace_provider on credentials(tenant_id, workspace_id, provider_id);
create index if not exists idx_credentials_status_expiry on credentials(status, expires_at);

create table if not exists credential_references (
  id text primary key,
  credential_id text not null,
  tenant_id text not null,
  workspace_id text not null,
  provider_id text not null,
  environment text not null,
  status text not null,
  provider_subject_id text,
  granted_scopes text[] not null default '{}',
  required_scopes text[] not null default '{}',
  missing_scopes text[] not null default '{}',
  expires_at timestamptz,
  last_refreshed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credential_references_environment_check check (environment in ('sandbox', 'production')),
  constraint credential_references_status_check check (status in ('pending', 'connected', 'expiring', 'expired', 'revoked', 'invalid', 'disabled', 'rotation_pending'))
);

create index if not exists idx_credential_references_credential on credential_references(credential_id, created_at);
create index if not exists idx_credential_references_tenant_workspace_provider on credential_references(tenant_id, workspace_id, provider_id);

create table if not exists credential_bindings (
  id text primary key,
  credential_id text not null,
  tenant_id text not null,
  workspace_id text not null,
  provider_id text not null,
  environment text not null,
  canary boolean not null default false,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credential_bindings_environment_check check (environment in ('sandbox', 'production')),
  constraint credential_bindings_status_check check (status in ('active', 'disabled'))
);

create index if not exists idx_credential_bindings_tenant_workspace_provider on credential_bindings(tenant_id, workspace_id, provider_id);

create table if not exists credential_rotations (
  id text primary key,
  credential_id text not null,
  tenant_id text not null,
  workspace_id text not null,
  provider_id text not null,
  old_credential_reference_id text,
  new_credential_reference_id text,
  mode text not null,
  status text not null,
  reason text not null,
  actor_user_id text not null,
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credential_rotations_mode_check check (mode in ('manual', 'scheduled')),
  constraint credential_rotations_status_check check (status in ('scheduled', 'running', 'completed', 'failed', 'cancelled'))
);

create index if not exists idx_credential_rotations_credential_created on credential_rotations(credential_id, created_at);

create table if not exists credential_health (
  credential_id text primary key,
  credential_reference_id text,
  tenant_id text not null,
  workspace_id text not null,
  provider_id text not null,
  status text not null,
  connected boolean not null,
  token_valid boolean not null,
  expires_at timestamptz,
  expiring boolean not null,
  expired boolean not null,
  granted_scopes text[] not null default '{}',
  required_scopes text[] not null default '{}',
  missing_scopes text[] not null default '{}',
  provider_subject_id text,
  last_synced_at timestamptz,
  checked_at timestamptz not null,
  safe_message text,
  constraint credential_health_status_check check (status in ('pending', 'connected', 'expiring', 'expired', 'revoked', 'invalid', 'disabled', 'rotation_pending'))
);

create index if not exists idx_credential_health_tenant_workspace on credential_health(tenant_id, workspace_id, checked_at);

create table if not exists operational_audit_events (
  id text primary key,
  tenant_id text not null,
  workspace_id text,
  event_type text not null,
  actor jsonb not null,
  resource jsonb not null,
  context jsonb not null,
  result jsonb not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_operational_audit_tenant_created on operational_audit_events(tenant_id, created_at);
create index if not exists idx_operational_audit_workspace_created on operational_audit_events(workspace_id, created_at);
create index if not exists idx_operational_audit_event_type on operational_audit_events(event_type);
