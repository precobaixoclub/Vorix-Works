-- 0128 — Instagram DM vira canal de primeira classe do módulo Conversas/Inbox (pedido explícito do
-- usuário: "junte só a tela, contabilizando no kanban também essas conversas" — decisão tomada foi
-- a opção completa, reaproveitando toda a pipeline já existente do WhatsApp em vez de manter um
-- módulo paralelo). `messaging_connections.provider` ganha 'instagram' ao lado de 'wuzapi'.
--
-- Achado de revisão (mesma lição já documentada na migration 0125): o enum TypeScript
-- (MessagingProviderId) é só metade da fonte de verdade — o banco tem a outra metade via CHECK
-- constraint. Esquecer de estender ESTA constraint junto faz todo `connectionRepository.create({
-- provider: "instagram", ... })` falhar em runtime com violação de constraint, nunca um erro de
-- compilação.

alter table messaging_connections drop constraint if exists messaging_connections_provider_check;
alter table messaging_connections add constraint messaging_connections_provider_check
  check (provider in ('wuzapi', 'instagram'));

-- Idempotência — uma conexão Instagram é criada/reencontrada por `external_session_id`
-- (= instagramBusinessAccountId), nunca por QR/pareamento como o WhatsApp; sem índice, cada evento
-- de webhook faria um full scan pra checar "essa conta já tem conexão?".
create index if not exists messaging_connections_provider_session_idx
  on messaging_connections (provider, external_session_id) where external_session_id is not null;
