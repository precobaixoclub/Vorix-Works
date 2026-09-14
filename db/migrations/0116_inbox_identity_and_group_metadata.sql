-- 0116 — Módulo Conversas: bloco "Identity UX" da experiência completa de WhatsApp (ver
-- docs/conversas-whatsapp-experience-completion.md). Aditiva, sem apagar nada.
--
-- PESSOA (telefone, pivô comercial) — `inbox_contacts` ganha aliases técnicos explícitos de
-- WhatsApp (PN/LID), reportados pelo próprio provider via `Info.SenderAlt`/`Info.RecipientAlt`
-- (evidência real, ver `src/domain/inbox/whatsapp-identity.ts`) — nunca inferidos por heurística.
-- `phone_normalized` continua sendo a identidade CANÔNICA da pessoa (já era antes desta migration);
-- `whatsapp_pn`/`whatsapp_lid` são só os aliases técnicos que resolveram pra essa pessoa.
alter table inbox_contacts
  add column if not exists whatsapp_pn text,
  add column if not exists whatsapp_lid text;

-- Um mesmo alias técnico nunca pode apontar pra dois contatos DIFERENTES no mesmo workspace — mas
-- pode ficar nulo em qualquer contato que ainda não teve esse alias observado (índice parcial).
create unique index if not exists inbox_contacts_workspace_whatsapp_pn_key on inbox_contacts (workspace_id, whatsapp_pn) where whatsapp_pn is not null;
create unique index if not exists inbox_contacts_workspace_whatsapp_lid_key on inbox_contacts (workspace_id, whatsapp_lid) where whatsapp_lid is not null;

-- METADADOS DE GRUPO — hoje `group_name` (migration 0115) só é preenchido quando um evento de
-- mensagem eventualmente traz o campo (raro/nunca no formato de mensagem do whatsmeow); esta
-- migration acrescenta o resto do metadata mínimo (seção 9 do pedido original) sem exigir um
-- sistema completo de administração de grupo.
alter table inbox_conversations
  add column if not exists group_avatar_url text,
  add column if not exists group_participant_count integer,
  add column if not exists group_metadata_updated_at timestamptz;

-- Telefone resolvido de quem mandou ESTA mensagem (seção 11 do pedido original: "senderPhone
-- quando resolvido") — complementa `sender_external_id` (sempre o JID cru, PN ou LID) sem
-- substituí-lo; `undefined`/`null` quando só o LID é conhecido e o provider nunca mandou o alias.
alter table inbox_messages
  add column if not exists sender_phone_e164 text;
