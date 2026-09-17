-- Bloco "etiquetas" (pedido explícito do usuário: "criar e configurar etiquetas dentro do
-- sistema e nas conversas ser possível adicionar mais do que uma"). Ver InboxTag em
-- src/domain/inbox/inbox.model.ts.

create table if not exists inbox_tags (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  name text not null,
  color text not null default 'emerald',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create index if not exists inbox_tags_workspace_idx on inbox_tags (workspace_id);

-- N:N conversa <-> etiqueta. `on delete cascade` nos dois lados: excluir a conversa ou a etiqueta
-- nunca deixa uma linha órfã aqui (mesmo racional das outras tabelas satélite do módulo Conversas).
create table if not exists inbox_conversation_tags (
  conversation_id text not null references inbox_conversations (id) on delete cascade,
  tag_id text not null references inbox_tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, tag_id)
);

create index if not exists inbox_conversation_tags_tag_idx on inbox_conversation_tags (tag_id);
