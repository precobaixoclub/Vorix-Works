-- 0114 — Módulo Conversas: correção de bug real encontrado em homologação de runtime. `sendInboxMessage`
-- commitava `inbox_messages.status = 'queued'` e SÓ DEPOIS publicava no RabbitMQ; se o publish
-- falhasse (broker indisponível), a linha ficava `queued` para sempre — nada a distinguia de uma
-- mensagem normal aguardando processamento, então nenhum mecanismo existente (retry ladder, DLQ,
-- redelivery) jamais a alcançava, mesmo depois do broker voltar. Reproduzido em runtime real antes
-- desta correção (ver docs/conversas-homologacao-runtime-relatorio.md, seção 1-B).
--
-- Estas três colunas são DELIBERADAMENTE separadas de `attempt_count`/`last_error`/
-- `failure_category` (que já existem, mas são da camada de ENVIO AO PROVIDER — WhatsApp/WuzAPI):
-- publicar no broker e enviar ao provider são camadas diferentes (broker = infraestrutura interna
-- do Vorix; provider = falha real de entrega), nunca devem ser misturadas na mesma contagem —
-- confundir as duas tornaria impossível diagnosticar QUAL camada está falhando.

alter table inbox_messages add column if not exists outbound_published_at timestamptz;
alter table inbox_messages add column if not exists publish_attempts integer not null default 0;
alter table inbox_messages add column if not exists last_publish_error text;

-- Índice parcial pro reconciliador: só mensagens outbound genuinamente órfãs (nunca confirmadas
-- publicadas) precisam ser encontradas rapidamente — mesmo padrão de índice parcial já usado para
-- o claim de IA (`0088`, `ai_claim_status`).
create index if not exists inbox_messages_orphaned_outbound_idx
  on inbox_messages (created_at)
  where direction = 'outbound' and status = 'queued' and outbound_published_at is null;
