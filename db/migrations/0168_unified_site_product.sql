-- Site é o produto único. Preserva preços, códigos de adicionais, assinaturas e auditoria antiga.
-- Uma revogação explícita de Site prevalece sobre a concessão legada de Commerce.
with migrated as (
 insert into solution_entitlements(tenant_id,solution_key,enabled,source,limits,reason,updated_by)
 select tenant_id,'site',enabled,source,limits,'Unificação de Commerce no Vorix Site','migration-0168'
 from solution_entitlements where solution_key='commerce'
 on conflict(tenant_id,solution_key) do nothing
 returning tenant_id,enabled,source
)
insert into solution_entitlement_audit_log(id,tenant_id,solution_key,old_enabled,new_enabled,source,actor_user_id,reason)
select 'solaudit-0168-'||md5(tenant_id),tenant_id,'site',null,enabled,source,'migration-0168','Unificação de Commerce no Vorix Site'
from migrated;

update plan_versions
set capabilities=(capabilities-'commerce') || jsonb_build_object('site',coalesce((capabilities->>'site')::boolean,false) or coalesce((capabilities->>'commerce')::boolean,false))
where capabilities ? 'commerce';

update addon_definitions
set resource='site',name=replace(name,'Vorix Commerce','Vorix Site')
where resource='commerce';
