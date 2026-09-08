-- 0096 — CRM/Comercial, Fase 3: Tarefas (follow-up). Ligação opcional com `contacts`/`deals` —
-- uma tarefa solta (sem contato/negócio) também é válida.

create table if not exists tasks (
  id            text primary key,
  tenant_id     text not null,
  workspace_id  text not null references workspaces (id) on delete cascade,
  contact_id    text references contacts (id) on delete set null,
  deal_id       text references deals (id) on delete set null,
  type          text not null check (type in ('ligacao', 'whatsapp', 'reuniao', 'enviar_proposta', 'follow_up', 'personalizada')),
  title         text not null,
  description   text,
  due_at        timestamptz,
  status        text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  owner_user_id text,
  team_id       text references teams (id) on delete set null,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists tasks_tenant_workspace_idx on tasks (tenant_id, workspace_id);
create index if not exists tasks_owner_idx on tasks (owner_user_id) where owner_user_id is not null;
create index if not exists tasks_deal_idx on tasks (deal_id) where deal_id is not null;
create index if not exists tasks_contact_idx on tasks (contact_id) where contact_id is not null;
create index if not exists tasks_due_pending_idx on tasks (due_at) where status = 'pending';
