-- PreparedCommand — Sprint 07 (Fase 9/11). Criado SÓ depois de confirmação válida; nunca
-- executado nesta sprint. validated_inputs/source_references guardam só o necessário para uma
-- sprint futura decidir o que fazer — nunca aciona Caio/Arthur legado/Skills.
create table prepared_commands (
  id                          text primary key,
  tenant_id                   text not null,
  workspace_id                text not null references workspaces (id) on delete cascade,
  conversation_id             text not null references conversations (id) on delete cascade,
  briefing_id                 text not null references briefings (id) on delete cascade,
  briefing_revision           int not null,
  schema_type                 text not null,
  intent                      text not null,
  validated_inputs            jsonb not null,
  source_references           jsonb not null,
  unresolved_optional_fields  text[] not null default '{}',
  status                      text not null,
  created_at                  timestamptz not null,
  superseded_at               timestamptz,

  constraint prepared_commands_status_check check (status in ('prepared', 'superseded'))
);

create index prepared_commands_briefing_id_idx on prepared_commands (briefing_id);

-- Unicidade lógica exigida na Sprint 07B (Fase 9): "uma confirmação repetida sem mudança deve
-- retornar o MESMO PreparedCommand" — a busca de idempotência (getByBriefingRevision) e esta
-- constraint garantem a mesma coisa em duas camadas (aplicação + banco).
create unique index prepared_commands_briefing_revision_type_uq on prepared_commands (briefing_id, briefing_revision, schema_type);
