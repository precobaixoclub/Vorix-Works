-- 0065 — Migração "Prompt Persistente de Produção + Materiais com Contexto para o GPT":
-- instruções criativas permanentes por workspace ("Prompt de Produção"/"Diretrizes Criativas"),
-- editáveis pelo usuário a qualquer momento sem deploy. Mesmo padrão 1:1 por workspace de
-- `brand_visual_profiles`/`asset_libraries` (id + workspace_id FK único). `production_prompt`
-- fica em `text` puro (não jsonb) — é literalmente um texto livre digitado pelo usuário, sem
-- estrutura aninhada. `version` é incrementado a cada update (nunca decrementado, nunca
-- resetado) só para dar um número estável de referência; o valor de auditoria real de qual
-- instrução foi usada em cada execução é o snapshot completo já gravado em
-- `creative_engine_runs.creative_context` (campo `productionInstructions`), não esta tabela —
-- nunca precisamos reconstruir uma versão antiga a partir daqui.

create table workspace_production_settings (
  id                          text primary key,
  workspace_id                text not null references workspaces (id) on delete cascade,
  production_prompt           text,
  version                     int not null default 1,
  prefer_real_assets          boolean not null default true,
  allow_fictional_interfaces  boolean not null default false,
  allow_generated_people      boolean not null default true,
  text_density                text not null default 'balanced',
  creative_freedom            text not null default 'medium',
  created_at                  timestamptz not null,
  updated_at                  timestamptz not null,
  constraint workspace_production_settings_text_density_check check (text_density in ('minimal', 'balanced', 'rich')),
  constraint workspace_production_settings_creative_freedom_check check (creative_freedom in ('low', 'medium', 'high'))
);

create unique index workspace_production_settings_workspace_id_uq on workspace_production_settings (workspace_id);
