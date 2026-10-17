-- 0161 — Relatórios: modelos do cliente (manuais ou criados com IA) e operações de IA de
-- relatório. Um modelo é só uma lista de seções do catálogo fechado (`report-catalog.ts`).

create table if not exists report_templates (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  name text not null,
  description text,
  sections jsonb not null default '[]'::jsonb,
  source text not null default 'manual' check (source in ('manual', 'ai')),
  ai_request text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists report_templates_workspace_idx on report_templates (tenant_id, workspace_id, created_at desc);

insert into ai_operation_types (code, label, capability, credits_cost, default_provider_code, default_model_id)
values
  ('report_ai_analysis', 'Relatórios — análise com IA (destaques, riscos e recomendações)', 'text_generation', 2, 'anthropic', 'claude-haiku-4-5-20251001'),
  ('report_template_builder', 'Relatórios — criar modelo de relatório com IA', 'text_generation', 1, 'anthropic', 'claude-haiku-4-5-20251001')
on conflict (code) do nothing;
