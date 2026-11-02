-- Preflight READ ONLY, before migration 0187. Supply tenant_id/workspace_id with psql -v.
begin read only;
select status,count(*) as proposals from proposals
 where tenant_id=:'tenant_id' and workspace_id=:'workspace_id' group by status order by status;

select count(*) as accepted_without_deal from proposals
 where tenant_id=:'tenant_id' and workspace_id=:'workspace_id' and status='accepted' and deal_id is null;

select count(*) as accepted_with_missing_or_out_of_scope_deal from proposals p
 left join deals d on d.id=p.deal_id and d.tenant_id=p.tenant_id and d.workspace_id=p.workspace_id
 where p.tenant_id=:'tenant_id' and p.workspace_id=:'workspace_id' and p.status='accepted' and p.deal_id is not null and d.id is null;

select count(*) as historical_won_acceptances_without_matching_winning_version
 from proposals p join deals d on d.id=p.deal_id and d.tenant_id=p.tenant_id and d.workspace_id=p.workspace_id
 where p.tenant_id=:'tenant_id' and p.workspace_id=:'workspace_id' and p.status='accepted' and d.status='won' and d.won_proposal_id is distinct from p.id;

select count(*) as deals_with_multiple_accepted_proposals from (
 select d.id from deals d join proposals p on p.deal_id=d.id and p.tenant_id=d.tenant_id and p.workspace_id=d.workspace_id
 where d.tenant_id=:'tenant_id' and d.workspace_id=:'workspace_id' and d.status='open' and p.status='accepted'
 group by d.id having count(*)>1
) duplicates;

select count(*) as pipelines_with_duplicate_billing_stage_names from (
 select s.pipeline_id from pipeline_stages s join pipelines p on p.id=s.pipeline_id
 where p.tenant_id=:'tenant_id' and p.workspace_id=:'workspace_id' and lower(trim(s.name))='aguardando faturamento'
 group by s.pipeline_id having count(*)>1
) duplicates;

select count(*) as historical_contacts_without_declared_phone from contacts
 where tenant_id=:'tenant_id' and workspace_id=:'workspace_id' and nullif(trim(custom_fields->>'phone'),'') is null;
rollback;
