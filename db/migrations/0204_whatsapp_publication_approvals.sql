-- Aprovação de publicações pelo WhatsApp (25/11/2026).
-- Nível CONTA: um número (conexão de qualquer espaço de trabalho da conta) envia os pedidos.
-- Nível MARCA: cada espaço de trabalho decide se exige aprovação, quem aprova e o que fazer sem resposta.
-- Só acréscimos: nenhuma tabela existente muda.

create table if not exists whatsapp_approval_settings (
  tenant_id text primary key,
  enabled boolean not null default false,
  connection_id text,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists whatsapp_approval_rules (
  tenant_id text not null,
  workspace_id text not null,
  enabled boolean not null default false,
  approver_user_id text,
  approver_phone text,
  on_timeout text not null default 'skip' check (on_timeout in ('skip', 'publish')),
  -- Só publicações criadas depois de ativar entram no fluxo (nada antigo dispara pedidos).
  enabled_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, workspace_id)
);

create table if not exists publication_approval_requests (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  publication_id text not null unique,
  code text not null,
  connection_id text not null,
  approver_phone text not null,
  approver_user_id text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'decided', 'applied', 'expired', 'failed')),
  decision text check (decision in ('approve', 'reject')),
  reason text,
  detail text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  decided_at timestamptz,
  applied_at timestamptz
);

create index if not exists publication_approval_requests_reply_idx
  on publication_approval_requests (connection_id, approver_phone, status);
create index if not exists publication_approval_requests_status_idx
  on publication_approval_requests (status, created_at);
