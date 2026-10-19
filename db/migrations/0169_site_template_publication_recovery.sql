-- Recuperação da publicação anterior sem alterar o modelo ou conteúdo publicado.
alter table tenant_sites add column if not exists previous_published jsonb;
alter table tenant_sites add column if not exists updated_by_user_id text;
alter table tenant_sites add column if not exists published_by_user_id text;
