-- 0099 — CRM/Comercial, Fase 5: Sugestões do Copiloto Comercial (IA). Sempre ligada a um Contact
-- (nunca solta) e opcionalmente a um Deal. `evidence` guarda o trecho literal dos dados reais que
-- embasou a sugestão (auditoria anti-alucinação, mesmo racional de `briefing_field_extraction`).
-- Nunca executa nada sozinha — só `status = 'accepted'` (ação humana explícita) autoriza qualquer
-- efeito colateral (ver `application/crm/commercial-copilot-use-cases.ts`).

create table if not exists commercial_suggestions (
  id                 text primary key,
  tenant_id          text not null,
  workspace_id       text not null references workspaces (id) on delete cascade,
  contact_id         text not null references contacts (id) on delete cascade,
  deal_id            text references deals (id) on delete set null,
  title              text not null,
  rationale          text not null,
  evidence           text not null,
  confidence         real not null,
  suggested_action   text not null check (suggested_action in ('follow_up_task', 'reach_out', 'review_deal_stage', 'send_proposal', 'none')),
  status             text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);

create index if not exists commercial_suggestions_tenant_workspace_idx on commercial_suggestions (tenant_id, workspace_id);
create index if not exists commercial_suggestions_contact_idx on commercial_suggestions (contact_id);
create index if not exists commercial_suggestions_pending_idx on commercial_suggestions (workspace_id, status) where status = 'pending';
