-- Bloco "urgente" (pedido explícito do usuário em produção: "criar uma opção de marcar como
-- urgente tambem onde fica um foguinho do lado da conversa") — flag manual, nunca inferida
-- automaticamente (sem heurística de palavra-chave/SLA nesta rodada). `not null default false`
-- para não exigir migração de dados nas conversas já existentes.
alter table inbox_conversations
  add column if not exists is_urgent boolean not null default false;
