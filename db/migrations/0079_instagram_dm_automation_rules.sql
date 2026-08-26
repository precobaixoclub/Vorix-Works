-- 0079 — Fase 5 (Instagram DM Automation): regras de resposta automática por palavra-chave.
--
-- `reply_mode='ai'` gera a resposta com um provider de texto isolado (`generate-ai-dm-reply.ts`,
-- instância dedicada do mesmo `OpenAiIcaroTextProvider` usado pelo Ícaro, nunca a orquestração
-- inteira do `IcaroAIBrain` — é uma chamada de texto avulsa, não uma tarefa roteada por tipo).

create table if not exists instagram_dm_automation_rules (
  id                             text primary key,
  tenant_id                      text not null,
  workspace_id                   text not null references workspaces (id) on delete cascade,
  instagram_business_account_id  text not null,
  name                           text not null,
  enabled                        boolean not null default true,
  match_type                     text not null check (match_type in ('contains', 'exact', 'starts_with')),
  keywords                       jsonb not null default '[]'::jsonb,
  reply_mode                     text not null check (reply_mode in ('fixed', 'ai')),
  reply_text                     text,
  ai_instructions                text,
  -- Regras são avaliadas em ordem crescente; a primeira que casar vence (nunca duas respostas
  -- pra uma mensagem só).
  priority                       int not null default 0,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

create index if not exists instagram_dm_automation_rules_lookup_idx on instagram_dm_automation_rules (workspace_id, instagram_business_account_id, enabled, priority);
