-- 0076 — Fase 5 (Instagram DM Automation): roteamento de webhook inbound por conta.
--
-- O webhook da Meta é ÚNICO por App — todo evento de toda conta do Instagram conectada por
-- qualquer tenant/workspace chega no MESMO endpoint (`POST /webhooks/instagram`), identificando só
-- a conta de origem (`entry[].id`, o id da conta profissional do Instagram). Não existe, no
-- domínio de publicação já existente (`publication_credential_references`), uma forma de resolver
-- "qual tenant/workspace é dono desta conta" sem já saber o tenant — `listCredentialReferences`
-- exige tenantId+workspaceId como filtro, nunca busca global. Em vez de alargar aquele port
-- compartilhado (arriscado — é usado por TikTok/YouTube/Kwai/Instagram/Facebook), esta tabela
-- pequena e isolada guarda só o vínculo necessário pro roteamento, preenchida no momento da conexão
-- OAuth (ver `instagram.route.ts`, callback de `/publication-providers/meta/oauth/callback`).

create table if not exists instagram_dm_account_routes (
  instagram_business_account_id text primary key,
  tenant_id                     text not null,
  workspace_id                  text not null references workspaces (id) on delete cascade,
  updated_at                    timestamptz not null default now()
);

create index if not exists instagram_dm_account_routes_workspace_idx on instagram_dm_account_routes (workspace_id);
