-- 0115 — Módulo Conversas: corrige a identidade canônica de uma conversa (bug estrutural, ver
-- docs/conversas-canonical-chat-identity.md). Até aqui uma InboxConversation era o par
-- (connection_id, contact_id) — ou seja, a identidade da CONVERSA era o REMETENTE de UMA
-- mensagem. Isso quebra em dois casos reais:
--   1. GRUPO: cada participante que manda mensagem tem um `contact_id` diferente → cada um cria
--      sua própria conversa, fragmentando um único grupo do WhatsApp em N conversas.
--   2. DM (privado): o self-echo que o WuzAPI/whatsmeow emite quando o Vorix (ou o próprio celular
--      pareado) manda uma mensagem tem `Sender` = o número do próprio bot, não o do contato — vira
--      um "contato" e uma "conversa" fantasma, fragmentando inbound/outbound do MESMO par em duas
--      conversas.
--
-- Correção: a identidade da conversa passa a ser (connection_id, external_chat_id) — o chat_id
-- canônico devolvido pelo provider (JID do grupo `@g.us` ou JID do peer `@s.whatsapp.net`/telefone
-- normalizado), nunca o remetente de uma mensagem específica. `contact_id` continua existindo (é
-- útil pra CRM/nome/avatar em conversas diretas) mas agora é OPCIONAL — grupo não tem um único
-- contato (ver seção 8 do relatório: grupo nunca é fundido automaticamente com um Contact do CRM).
--
-- Migration ADITIVA — nenhuma linha é apagada. Backfill: toda conversa hoje é necessariamente
-- `direct` (grupo nunca foi suportado), então `external_chat_id` é preenchido a partir do
-- `phone_normalized` do contato já associado — o mesmo valor que já era usado como destino de envio
-- (`contact.phoneNormalized` em `processOutboundMessage`), preservando o comportamento outbound
-- existente sem exigir reconciliação imediata de histórico (essa é uma etapa separada, ver
-- `scripts/reconcile-inbox-conversations.mjs`).

alter table inbox_conversations
  add column if not exists chat_type text not null default 'direct' check (chat_type in ('direct', 'group')),
  add column if not exists external_chat_id text,
  add column if not exists group_name text;

alter table inbox_conversations
  alter column contact_id drop not null;

update inbox_conversations c
set external_chat_id = ct.phone_normalized
from inbox_contacts ct
where ct.id = c.contact_id
  and c.external_chat_id is null;

-- Defesa: qualquer linha que por algum motivo não tenha backfillado (não deveria acontecer —
-- `contact_id` era `not null` até este migration) usa o próprio `id` da conversa como fallback,
-- só para nunca deixar `external_chat_id` nulo antes da constraint `not null` abaixo. Nunca deveria
-- disparar em produção; existe só para a migration nunca falhar por um dado inconsistente.
update inbox_conversations set external_chat_id = id where external_chat_id is null;

alter table inbox_conversations
  alter column external_chat_id set not null;

-- Troca a identidade única: de "(conexão, contato-remetente)" para "(conexão, chat canônico)".
alter table inbox_conversations drop constraint if exists inbox_conversations_connection_id_contact_id_key;
create unique index if not exists inbox_conversations_connection_chat_key on inbox_conversations (connection_id, external_chat_id);

create index if not exists inbox_conversations_chat_type_idx on inbox_conversations (chat_type);

-- Atribuição por mensagem — quem dentro do chat mandou esta mensagem específica. Em DM é
-- redundante com o contato da conversa (mas barato de gravar e útil para consistência); em grupo é
-- a ÚNICA forma de saber quem, dos N participantes, mandou cada mensagem (a conversa em si já não
-- carrega mais essa informação — ela é do grupo inteiro).
alter table inbox_messages
  add column if not exists sender_external_id text,
  add column if not exists sender_display_name text;
