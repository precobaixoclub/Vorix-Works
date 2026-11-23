-- Guarda o id/URL do post na rede em cada envio e indexa por destino. Permite ao roteador social
-- saber que um destino JÁ foi publicado e nunca reenviar (incidente de 22/11/2026: a reserva de 60s
-- da fila vencia durante o upload de carrossel no Instagram e o mesmo post saiu até 4 vezes).
alter table social_publish_log add column if not exists external_post_id text;
alter table social_publish_log add column if not exists external_url text;
create index if not exists social_publish_log_target_started on social_publish_log (target_id, started_at desc);
