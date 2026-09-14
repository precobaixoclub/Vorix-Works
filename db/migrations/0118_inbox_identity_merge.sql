-- 0118 — Módulo Conversas: merge automático de identidade por evidência forte (bloco "réplica de
-- identidade", padrão "tombstone" — mesmo racional documentado pelo usuário no relatório do
-- CMDesk/desk-spark-ai, seção 4.2/5.1). O perdedor de um merge NUNCA é apagado — fica marcado como
-- `merge_status = 'merged'`, com um ponteiro pro vencedor, preservando `id` (qualquer referência
-- antiga continua resolvendo) e histórico completo em `inbox_identity_merge_log`.
--
-- Migration ADITIVA. Os índices únicos existentes de `inbox_contacts`/`inbox_conversations`
-- precisam ser recriados como PARCIAIS, excluindo linhas já mescladas — senão o tombstone nunca
-- libera o valor (telefone/LID/chat) para o contato/conversa vencedor reutilizar.

alter table inbox_contacts
  add column if not exists merge_status text check (merge_status is null or merge_status = 'merged'),
  add column if not exists merged_into_contact_id text references inbox_contacts (id),
  add column if not exists merged_at timestamptz;

alter table inbox_conversations
  add column if not exists merge_status text check (merge_status is null or merge_status = 'merged'),
  add column if not exists merged_into_conversation_id text references inbox_conversations (id),
  add column if not exists merged_at timestamptz;

-- inbox_contacts: troca a unique constraint original (0081) por um índice único PARCIAL
-- equivalente, excluindo contatos já mesclados.
alter table inbox_contacts drop constraint if exists inbox_contacts_workspace_id_phone_normalized_key;
create unique index if not exists inbox_contacts_workspace_phone_active_key
  on inbox_contacts (workspace_id, phone_normalized)
  where merge_status is null;

-- inbox_contacts: os índices parciais de alias (0116) ganham a mesma exclusão.
drop index if exists inbox_contacts_workspace_whatsapp_pn_key;
create unique index if not exists inbox_contacts_workspace_whatsapp_pn_key
  on inbox_contacts (workspace_id, whatsapp_pn)
  where whatsapp_pn is not null and merge_status is null;

drop index if exists inbox_contacts_workspace_whatsapp_lid_key;
create unique index if not exists inbox_contacts_workspace_whatsapp_lid_key
  on inbox_contacts (workspace_id, whatsapp_lid)
  where whatsapp_lid is not null and merge_status is null;

-- inbox_conversations: idem pro índice de identidade canônica de chat (0115).
drop index if exists inbox_conversations_connection_chat_key;
create unique index if not exists inbox_conversations_connection_chat_key
  on inbox_conversations (connection_id, external_chat_id)
  where merge_status is null;

create index if not exists inbox_contacts_merged_into_idx on inbox_contacts (merged_into_contact_id) where merged_into_contact_id is not null;
create index if not exists inbox_conversations_merged_into_idx on inbox_conversations (merged_into_conversation_id) where merged_into_conversation_id is not null;

-- Auditoria de todo merge executado — nunca silencioso. `snapshot` guarda o estado do PERDEDOR
-- antes do merge (id, telefone, LID, waId, nome, contagem de mensagens movidas) para permitir
-- revisão humana ou reversão manual determinística depois, mesmo racional de
-- `ContactMergeHistory` no relatório do CMDesk.
create table if not exists inbox_identity_merge_log (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null references workspaces (id) on delete cascade,
  entity_type text not null check (entity_type in ('contact', 'conversation')),
  winner_id text not null,
  loser_id text not null,
  -- Única razão possível hoje: evidência forte do provider (Info.SenderAlt/RecipientAlt) resolveu
  -- um telefone que já pertencia a outro registro. O Vorix nunca faz merge por heurística fraca
  -- (nome parecido etc.) — essa fonte de evidência não existe neste sistema, de propósito.
  reason text not null check (reason = 'identity_link_strong_evidence'),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists inbox_identity_merge_log_workspace_idx on inbox_identity_merge_log (workspace_id, created_at desc);
