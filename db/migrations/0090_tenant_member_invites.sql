-- 0090 — CRM/Comercial, Fase 1: convite de membro por e-mail. Fecha o gap real encontrado na
-- auditoria (docs/crm-omnichannel-architecture-audit.md, seção 3): hoje só existe signup
-- (auto-cadastro) e listagem read-only — nenhum fluxo de convidar/aceitar existia. `token_hash`
-- segue o mesmo padrão de segurança de RefreshToken (nunca o valor bruto persistido).

create table if not exists tenant_member_invites (
  id                  text primary key,
  tenant_id           text not null,
  email               text not null,
  role                text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  token_hash          text not null,
  status              text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by_user_id  text not null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  accepted_at         timestamptz
);

create index if not exists tenant_member_invites_tenant_idx on tenant_member_invites (tenant_id);

-- Nunca dois convites pendentes pro mesmo e-mail no mesmo tenant ao mesmo tempo.
create unique index if not exists tenant_member_invites_pending_email_idx
  on tenant_member_invites (tenant_id, email)
  where status = 'pending';
