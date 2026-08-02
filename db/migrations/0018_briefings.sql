-- Briefing — Sprint 07 (Fase 11). Container do fluxo de coleta progressiva de contexto.
-- `schema_type`/`schema_version`/`revision` são persistidos; a DEFINIÇÃO do schema (campos,
-- regras, DSL) fica só em código (`src/domain/briefing/schemas/*`), nunca no banco.
create table briefings (
  id              text primary key,
  tenant_id       text not null,
  workspace_id    text not null references workspaces (id) on delete cascade,
  conversation_id text not null references conversations (id) on delete cascade,
  schema_type     text not null,
  status          text not null,
  schema_version  int not null,
  revision        int not null default 1,
  created_at      timestamptz not null,
  updated_at      timestamptz not null,
  completed_at    timestamptz,
  cancelled_at    timestamptz,

  constraint briefings_schema_type_check check (schema_type in (
    'campaign_creation', 'campaign_edit', 'content_request', 'knowledge_query', 'asset_search', 'generic_task'
  )),
  constraint briefings_status_check check (status in (
    'collecting', 'awaiting_confirmation', 'ready', 'completed', 'cancelled', 'expired'
  )),
  constraint briefings_revision_positive check (revision >= 1)
);

-- Consulta principal: buscar o Briefing ativo de uma conversa (GetActiveBriefing).
create index briefings_conversation_id_idx on briefings (conversation_id);

-- Invariante: no máximo um Briefing ATIVO por conversa ao mesmo tempo — 'completed'/'cancelled'/
-- 'expired' saem do índice parcial e liberam a conversa para um novo Briefing.
create unique index briefings_one_active_per_conversation
  on briefings (conversation_id)
  where status not in ('completed', 'cancelled', 'expired');
