-- 0162 — Fotos do produto (catálogo estilo vitrine no menu Produtos do Conversas). Guarda as URLs
-- canônicas (sem assinatura) dos objetos enviados em `assets/<tenant>/<workspace>/products/`; a
-- primeira é a capa. As respostas autenticadas saem assinadas pelo hook de URLs do storage.

alter table products
  add column if not exists image_urls jsonb not null default '[]'::jsonb;
