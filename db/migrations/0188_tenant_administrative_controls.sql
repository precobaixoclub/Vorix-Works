create table tenant_administrative_controls (
  tenant_id text primary key references tenant_billing(tenant_id) on delete cascade,
  display_name text,
  access_mode text not null default 'inherit' check (access_mode in ('inherit','enabled','blocked')),
  capabilities jsonb not null default '{}',
  limits jsonb not null default '{}',
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create table tenant_administrative_control_changes (
  id text primary key,
  tenant_id text not null references tenant_billing(tenant_id) on delete cascade,
  actor_user_id text,
  reason text not null,
  before_controls jsonb not null,
  after_controls jsonb not null,
  occurred_at timestamptz not null default now()
);
create index tenant_administrative_changes_recent on tenant_administrative_control_changes(tenant_id,occurred_at desc);

-- A conta interna já opera esses recursos. Preserva seu acesso ao aplicar as guardas do contrato.
insert into tenant_administrative_controls(tenant_id,display_name,capabilities)
 select tenant_id,'Vorix','{"crm":true,"proposals":true,"automation":true,"ai_auto_reply":true,"advanced_analytics":true}'::jsonb
 from tenant_billing where tenant_id='tenant-vorix';
insert into tenant_administrative_control_changes(id,tenant_id,reason,before_controls,after_controls)
 select 'controls-internal-preservation-0188',tenant_id,
 'Preservar acesso operacional da conta interna na unificação dos controles administrativos',
 '{"accessMode":"inherit","capabilities":{},"limits":{},"version":0}'::jsonb,
 jsonb_build_object('tenantId',tenant_id,'displayName',display_name,'accessMode',access_mode,'capabilities',capabilities,'limits',limits,'version',version)
 from tenant_administrative_controls where tenant_id='tenant-vorix';
