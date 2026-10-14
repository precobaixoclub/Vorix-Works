-- Approved by the user and executed on 2026-10-14, exclusively in WSL2 vorix_homolog.
-- Restore the missing historical parent as archived; preserve account/session history unchanged.
begin;
do $$
begin
  if current_database() <> 'vorix_homolog' then
    raise exception 'Refusing repair outside vorix_homolog';
  end if;
  if exists (select 1 from workspaces where id = 'ws-prov-mv8et2f1' and tenant_id <> 'tenant-homolog-prov') then
    raise exception 'Historical workspace id belongs to a different tenant';
  end if;
end $$;
insert into workspaces (id, tenant_id, name, status, created_at, updated_at, archived_at)
values ('ws-prov-mv8et2f1', 'tenant-homolog-prov', 'Workspace histórico de homologação (referência restaurada)',
  'archived', now(), now(), now()) on conflict (id) do nothing;
select id, tenant_id, status from workspaces where id = 'ws-prov-mv8et2f1';
commit;
