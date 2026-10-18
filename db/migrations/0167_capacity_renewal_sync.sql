-- Reduções novas já atualizam o preço no gateway ao salvar; o scheduler só libera a quota antiga.
alter table subscription_pending_changes add column if not exists billing_synced boolean not null default false;
alter table subscription_items add column if not exists provider_price_ref text;
