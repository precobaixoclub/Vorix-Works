-- 0136 — Mensagens outbound agendadas no módulo Conversas.
-- Enquanto `scheduled_at` estiver preenchido, a mensagem permanece queued e não entra na fila
-- RabbitMQ. O worker reivindica atomicamente mensagens vencidas, zera o campo e então publica.

alter table inbox_messages add column if not exists scheduled_at timestamptz;

create index if not exists inbox_messages_scheduled_due_idx
  on inbox_messages (scheduled_at)
  where direction = 'outbound' and status = 'queued' and scheduled_at is not null;
