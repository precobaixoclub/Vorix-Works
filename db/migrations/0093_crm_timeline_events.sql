-- 0093 — CRM/Comercial, Fase 1: Timeline genérica. Deliberadamente separada do pipeline de
-- Analytics (auditoria, seção 17: Analytics é métrica agregada por janela de tempo, com
-- `eventType` fechado em ~28 valores de publicação/execução — não serve como narrativa por
-- entidade). `entity_type`/`entity_id` genéricos permitem contato, negócio, conversa, proposta e
-- tarefa converergirem na MESMA timeline sem duplicar o payload inteiro de cada evento de origem.

create table if not exists timeline_events (
  id            text primary key,
  tenant_id     text not null,
  workspace_id  text not null references workspaces (id) on delete cascade,
  entity_type   text not null check (entity_type in ('contact', 'deal', 'conversation', 'proposal', 'task')),
  entity_id     text not null,
  event_type    text not null,
  actor_type    text not null check (actor_type in ('user', 'ai', 'automation', 'system')),
  actor_id      text,
  payload       jsonb not null default '{}',
  occurred_at   timestamptz not null default now()
);

create index if not exists timeline_events_entity_idx on timeline_events (entity_type, entity_id, occurred_at desc);
create index if not exists timeline_events_tenant_workspace_idx on timeline_events (tenant_id, workspace_id, occurred_at desc);
