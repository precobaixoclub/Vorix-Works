-- 0106 — SaaS Commercialization, Fase 1: contadores de uso periódico. Só para recursos que não
-- são uma contagem direta de linhas de uma tabela existente (ver `usage-counter.model.ts`).

create table if not exists usage_counters (
  tenant_id    text not null,
  workspace_id text,
  resource     text not null check (resource in ('users', 'workspaces', 'messaging_connections', 'contacts', 'ai_credits', 'storage_mb', 'automations')),
  period       text not null,
  used         bigint not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, resource, period)
);

create index if not exists usage_counters_tenant_idx on usage_counters (tenant_id);
