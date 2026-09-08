-- 0098 — CRM/Comercial, Fase 3: Propostas. `items` congela nome/preço no momento (nunca uma
-- referência viva a `products`, que pode mudar de preço depois). `public_token_hash` é o único
-- registro do token de acesso público (`/p/:token`) — o token bruto nunca é persistido, só o hash
-- (mesmo padrão de `tenant_member_invites.token_hash`).

create table if not exists proposals (
  id                text primary key,
  tenant_id         text not null,
  workspace_id      text not null references workspaces (id) on delete cascade,
  deal_id           text references deals (id) on delete set null,
  contact_id        text references contacts (id) on delete set null,
  title             text not null,
  items             jsonb not null default '[]',
  discount_cents    bigint not null default 0,
  total_cents       bigint not null default 0,
  currency          text not null default 'BRL',
  valid_until       date,
  conditions        text,
  status            text not null default 'draft' check (status in ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired')),
  public_token_hash text not null unique,
  sent_at           timestamptz,
  viewed_at         timestamptz,
  responded_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists proposals_tenant_workspace_idx on proposals (tenant_id, workspace_id);
create index if not exists proposals_deal_idx on proposals (deal_id) where deal_id is not null;
