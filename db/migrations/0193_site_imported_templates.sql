-- Modelos de site importados (Pacote de Modelo Vorix). O pacote já validado é guardado como JSON
-- seguro: árvore das seções (nunca HTML cru), CSS restrito ao site, tema e conteúdo de exemplo.
create table if not exists site_imported_templates (
 id text primary key,
 tenant_id text not null,
 workspace_id text not null,
 site_id text not null,
 name text not null,
 version text not null,
 package jsonb not null,
 report jsonb not null,
 created_by_user_id text,
 created_at timestamptz not null default now(),
 foreign key (tenant_id, site_id) references tenant_sites (tenant_id, id) on delete cascade
);
create index if not exists site_imported_templates_site_idx on site_imported_templates (site_id, created_at desc);
