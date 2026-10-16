-- Conversas: respostas rápidas (mensagens prontas acionadas por "/atalho" no composer) e notas
-- internas (registro só da equipe na timeline — NUNCA enviado ao WhatsApp). Ver
-- `InboxQuickReply` e o evento `note_added` em src/domain/inbox/inbox.model.ts.

create table if not exists inbox_quick_replies (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  shortcut text not null,
  body text not null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inbox_quick_replies_workspace_shortcut_idx on inbox_quick_replies (workspace_id, lower(shortcut));

-- Nota interna = evento da timeline (mesma tabela da auditoria), texto em `metadata.text`.
-- O enum TypeScript é só metade da fonte de verdade: a constraint precisa acompanhar (ver 0125).
alter table inbox_conversation_events drop constraint if exists inbox_conversation_events_type_check;
alter table inbox_conversation_events add constraint inbox_conversation_events_type_check
  check (type in (
    'assigned', 'unassigned', 'took_over', 'transferred', 'status_changed', 'ai_paused', 'ai_resumed',
    'ai_response_sent', 'ai_response_failed', 'ai_response_cancelled', 'ai_response_skipped_insufficient_credits',
    'kanban_phase_changed', 'note_added'
  ));
