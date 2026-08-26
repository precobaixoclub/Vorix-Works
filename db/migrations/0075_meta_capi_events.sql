-- 0075 — Fase 4 do módulo Meta Ads Manager: log de auditoria de envios à Conversions API (CAPI).
--
-- Append-only, nunca UPDATE — cada linha é UMA tentativa de envio. Guarda só METADADOS do evento
-- (nome, horário, quais TIPOS de campo de user_data foram enviados — nunca o hash em si, nem o
-- valor original) e o resultado devolvido pela Meta (events_received, fbtrace_id) ou o erro. A
-- Marketing API já recebe e processa os hashes; não há motivo pra este app reter uma cópia deles
-- depois do envio — reter hash de PII sem necessidade é o tipo de coisa que vira problema de
-- compliance depois, mesmo sendo "só um hash".

create table if not exists meta_capi_events (
  id                text primary key,
  tenant_id         text not null,
  workspace_id      text not null,
  meta_pixel_id     text not null references meta_pixels (id) on delete cascade,
  pixel_id          text not null,
  event_name        text not null,
  event_time        timestamptz not null,
  event_id          text,
  action_source     text not null default 'website',
  -- Ex.: ["em", "ph"] — quais campos de user_data foram incluídos, nunca o valor.
  user_data_fields  jsonb not null default '[]'::jsonb,
  custom_data       jsonb,
  test_event_code   text,
  status            text not null check (status in ('sent', 'failed')),
  events_received   int,
  fbtrace_id        text,
  error_message     text,
  created_at        timestamptz not null default now()
);

create index if not exists meta_capi_events_tenant_id_idx on meta_capi_events (tenant_id);
create index if not exists meta_capi_events_pixel_idx on meta_capi_events (meta_pixel_id, created_at desc);
