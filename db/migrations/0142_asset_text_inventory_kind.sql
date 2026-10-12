-- 0142 — Inventário de texto por TIPO de asset (screenshot, logo).
-- Aditiva: coluna nova com default; linhas existentes são inventários de screenshot. O inventário da
-- LOGO oficial (tagline/slogan impressos no próprio arquivo) usa a mesma tabela e o mesmo isolamento
-- (tenant + workspace + hash + versão). Só proveniência para o Quality Gate — nunca fato comercial.

alter table screenshot_text_inventories
  add column if not exists asset_kind text not null default 'screenshot';
