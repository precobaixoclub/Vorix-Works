-- Usuário real, autenticável — Sprint 05. Sem FK para tenant (User não pertence a nenhum Tenant
-- por si só; ganha acesso via tenant_members).
create table users (
  id             text primary key,
  email          text not null,
  password_hash  text not null,
  name           text not null,
  status         text not null,
  created_at     timestamptz not null,
  updated_at     timestamptz not null,
  last_login_at  timestamptz,

  constraint users_status_check check (status in ('active', 'disabled'))
);

-- Email é o identificador de login — único, comparado sem diferenciar maiúsculas/minúsculas
-- (índice funcional sobre lower(email), não uma coluna redundante).
create unique index users_email_uq on users (lower(email));
