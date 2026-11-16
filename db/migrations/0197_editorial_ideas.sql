-- 0197 — Bolsão de pautas editoriais por workspace.
--
-- O Tanque de ideias da Produção vive no navegador (localStorage) e serve para ideias rápidas.
-- Pautas editoriais são outra coisa: um acervo planejado, importado em lote, com estado editorial
-- compartilhado pela equipe e data no calendário. Por isso ficam no banco, sempre presas a UM
-- workspace (nunca visíveis em outro), com `external_id` estável (ex.: "VWX-001") para que
-- reimportar o mesmo pacote nunca duplique nada.

create table if not exists editorial_ideas (
  id                    text primary key,
  tenant_id             text not null,
  workspace_id          text not null references workspaces (id) on delete cascade,
  external_id           text not null,
  title                 text not null,
  category              text not null,
  commercial_objective  text not null,
  target_audience       text not null,
  concept               text not null,
  key_message           text not null,
  format                text not null check (format in ('single_image', 'carousel', 'video')),
  approach              text not null,
  visual_direction      text not null,
  narrative_structure   text not null,
  carousel_script       jsonb,
  video_script          jsonb,
  caption               text not null,
  cta                   text not null,
  priority              text not null check (priority in ('high', 'normal')),
  status                text not null default 'available'
                        check (status in ('available', 'in_production', 'produced', 'approved', 'published', 'archived')),
  suggested_date        date,
  scheduled_date        date,
  execution_run_id      text,
  status_changed_at     timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists editorial_ideas_workspace_external_uq on editorial_ideas (workspace_id, external_id);
create index if not exists editorial_ideas_workspace_status_idx on editorial_ideas (workspace_id, status);
create index if not exists editorial_ideas_workspace_scheduled_idx on editorial_ideas (workspace_id, scheduled_date) where scheduled_date is not null;
