-- 0092 — CRM/Comercial, Fase 1: identidade por canal + backfill não-destrutivo dos contatos do
-- WhatsApp. Princípio (auditoria, seção 4): `inbox_contacts` NUNCA muda de forma nem de FK com
-- `inbox_conversations` — só ganha uma coluna nova opcional apontando pra cima. Nenhuma fusão
-- automática entre contatos: cada `inbox_contacts` existente vira exatamente um `contacts` novo
-- (1:1), nunca dois `inbox_contacts` são combinados num só sem sinal de confiança explícito.

create table if not exists contact_identities (
  id             text primary key,
  contact_id     text not null references contacts (id) on delete cascade,
  tenant_id      text not null,
  workspace_id   text not null references workspaces (id) on delete cascade,
  channel        text not null check (channel in ('whatsapp', 'instagram', 'facebook', 'tiktok')),
  external_id    text not null,
  connection_id  text,
  created_at     timestamptz not null default now(),

  -- Mesma identidade de canal nunca aponta pra dois contatos diferentes.
  unique (channel, external_id)
);

create index if not exists contact_identities_contact_idx on contact_identities (contact_id);

alter table inbox_contacts add column if not exists contact_id text references contacts (id) on delete set null;

-- Backfill: um `contacts` + uma `contact_identities` por `inbox_contacts` ainda não ligado.
-- Idempotente (roda de novo sem duplicar — `where contact_id is null` nunca re-processa uma
-- linha já ligada) e nunca fusiona duas linhas de `inbox_contacts` existentes.
insert into contacts (id, tenant_id, workspace_id, name, origin, created_at, updated_at, last_interaction_at)
select
  'contact-bf-' || ic.id,
  ic.tenant_id,
  ic.workspace_id,
  coalesce(nullif(ic.name, ''), ic.phone_normalized),
  'whatsapp',
  ic.created_at,
  ic.updated_at,
  ic.updated_at
from inbox_contacts ic
where ic.contact_id is null;

insert into contact_identities (id, contact_id, tenant_id, workspace_id, channel, external_id, created_at)
select
  'identity-bf-' || ic.id,
  'contact-bf-' || ic.id,
  ic.tenant_id,
  ic.workspace_id,
  'whatsapp',
  ic.id,
  ic.created_at
from inbox_contacts ic
where ic.contact_id is null;

update inbox_contacts set contact_id = 'contact-bf-' || id where contact_id is null;
