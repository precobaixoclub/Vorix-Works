-- 0111 — Onboarding guiado (self-service). Progresso de onboarding pertence ao WORKSPACE, nunca
-- ao tenant/usuário (um tenant com dois workspaces tem dois onboardings independentes — ver
-- auditoria: não existia nenhuma estrutura equivalente antes desta migration). Nunca semeado por
-- outra migration — nasce sob demanda (`POST /onboarding/start`), mesmo padrão de
-- `ensureDefaultPipeline` (índice único + idempotência na aplicação, nunca um valor fixo).

create table if not exists workspace_onboarding (
  id              text primary key,
  tenant_id       text not null,
  workspace_id    text not null references workspaces (id) on delete cascade,
  status          text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  current_step    text not null default 'company' check (current_step in ('company', 'channel', 'team', 'commercial', 'brand', 'done')),
  -- Etapas que o usuário efetivamente concluiu (não inclui as puladas) — usado pelo checklist de
  -- ativação da Home (seção 19) para saber o que ainda está pendente, distinto de "pulou".
  completed_steps jsonb not null default '[]',
  company_segment text,
  company_size    text,
  primary_goal    text check (primary_goal is null or primary_goal in ('content', 'support', 'sales', 'all')),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  updated_at      timestamptz not null default now(),
  unique (workspace_id)
);

create index if not exists workspace_onboarding_tenant_idx on workspace_onboarding (tenant_id);
