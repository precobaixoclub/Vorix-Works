-- Manual operational invoicing. No fiscal document, payment or checkout changes.
alter table pipeline_stages add column is_awaiting_billing boolean not null default false;
create unique index pipeline_one_billing_stage on pipeline_stages(pipeline_id) where is_awaiting_billing;
alter table proposals drop constraint proposals_status_check;
alter table proposals add constraint proposals_status_check check (status in
 ('draft','pending_approval','approved','sent','viewed','accepted','invoiced','rejected','expired','cancelled','superseded'));
alter table proposals add column billed_at timestamptz, add column billed_by_user_id text,
 add column billing_source text, add column billing_voided_at timestamptz,
 add column billing_voided_by_user_id text, add column billing_void_reason text;
alter table deals add column billing_proposal_id text references proposals(id) on delete set null;
alter table proposal_events drop constraint proposal_events_event_type_check;
alter table proposal_events add constraint proposal_events_event_type_check check (event_type in
 ('created','approval_requested','approved','rejected_internally','sent','delivered','whatsapp_read','whatsapp_failed',
 'viewed','downloaded','accepted','invoiced','billing_voided','declined','expired','superseded','cancelled','reminder_sent','follow_up_task_created'));
create unique index proposal_invoiced_once on proposal_events(proposal_id) where event_type='invoiced';

create function vorix_ensure_billing_stage(pipeline text) returns text language plpgsql as $$
declare target text; pos integer; s record;
begin
 perform id from pipelines where id=pipeline for update;
 select id into target from pipeline_stages where pipeline_id=pipeline and is_awaiting_billing;
 if target is not null then return target; end if;
 select id into target from pipeline_stages where pipeline_id=pipeline and not is_won and not is_lost
  and lower(trim(name))='aguardando faturamento' order by position,id limit 1;
 if target is not null then
  update pipeline_stages set is_awaiting_billing=true,name='Aguardando faturamento' where id=target;
  return target;
 end if;
 select coalesce(min(position) filter(where is_won or is_lost), coalesce(max(position)+1,0)) into pos from pipeline_stages where pipeline_id=pipeline;
 for s in select id,position from pipeline_stages where pipeline_id=pipeline and position>=pos order by position desc loop
  update pipeline_stages set position=s.position+1 where id=s.id;
 end loop;
 target := 'stage-billing-' || md5(pipeline);
 insert into pipeline_stages(id,pipeline_id,name,position,is_won,is_lost,is_awaiting_billing)
 values(target,pipeline,'Aguardando faturamento',pos,false,false,true);
 return target;
end $$;

select vorix_ensure_billing_stage(id) from pipelines;

-- Keep historical sales closed. Classify only the actual winning proposal; no stock/event replay.
with classified as (update proposals p set status='invoiced', billed_at=coalesce(d.closed_at,d.won_at),
 billed_by_user_id=d.closed_by_user_id, billing_source='legacy_won'
from deals d where p.id=d.won_proposal_id and p.deal_id=d.id and p.tenant_id=d.tenant_id
 and p.workspace_id=d.workspace_id and p.status='accepted' and d.status='won' returning p.*),
events as (
 insert into proposal_events(id,tenant_id,workspace_id,proposal_id,event_type,payload)
 select 'billing-invoiced-'||id,tenant_id,workspace_id,id,'invoiced',jsonb_build_object('source','legacy_won','billedAt',billed_at,'userId',billed_by_user_id) from classified
)
insert into timeline_events(id,tenant_id,workspace_id,entity_type,entity_id,event_type,actor_type,payload)
select 'billing-invoiced-'||id,tenant_id,workspace_id,'proposal',id,'proposal_invoiced','system',
 jsonb_build_object('source','migration_0187','classification','legacy_won','billedAt',billed_at) from classified;

-- Proposal acceptance and its operational queue commit together, even if notification hooks fail.
create function vorix_proposal_billing_queue() returns trigger language plpgsql as $$
declare d deals%rowtype; target text;
begin
 if new.status='accepted' and old.status is distinct from new.status and new.deal_id is not null then
  select * into d from deals where id=new.deal_id and tenant_id=new.tenant_id and workspace_id=new.workspace_id for update;
  if not found or d.status<>'open' then raise exception 'PROPOSAL_BILLING_INVALID: a oportunidade precisa estar aberta.'; end if;
  if d.billing_proposal_id is not null and d.billing_proposal_id<>new.id then
   raise exception 'PROPOSAL_BILLING_INVALID: já existe uma proposta aceita aguardando faturamento.';
  end if;
  target:=vorix_ensure_billing_stage(d.pipeline_id);
  update deals set stage_id=target,billing_proposal_id=new.id,won_at=null,lost_at=null,last_stage_changed_at=now(),updated_at=now(),archived_at=null where id=d.id;
  insert into timeline_events(id,tenant_id,workspace_id,entity_type,entity_id,event_type,actor_type,payload)
   values('billing-accepted-'||new.id,new.tenant_id,new.workspace_id,'deal',d.id,'deal_awaiting_billing','system',
    jsonb_build_object('proposalId',new.id,'fromStageId',d.stage_id,'toStageId',target,'isWon',false,'previousWonAt',d.won_at,'previousLostAt',d.lost_at)) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger proposal_billing_queue after update of status on proposals for each row execute function vorix_proposal_billing_queue();

-- Winning through the invoicing command writes proposal, timestamps and audit in the SAME transaction.
-- Reopening/loss cancels the operational proposal, retaining acceptance and invoice evidence forever.
create function vorix_deal_billing_sync() returns trigger language plpgsql as $$
declare p proposals%rowtype; actor text;
begin
 if old.billing_proposal_id is not null and old.status='open' and new.status='won' and new.closure_source is distinct from 'proposal_billing' then
  raise exception 'PROPOSAL_BILLING_INVALID: use Marcar como faturado para concluir a proposta aceita.';
 end if;
 if new.status='open' and new.billing_proposal_id is not null and not exists(select 1 from pipeline_stages where id=new.stage_id and pipeline_id=new.pipeline_id and is_awaiting_billing) then
  raise exception 'PROPOSAL_BILLING_INVALID: proposta aceita precisa permanecer na fila de faturamento.';
 end if;
 if old.status='open' and old.billing_proposal_id is not null and new.status='open' and new.billing_proposal_id is distinct from old.billing_proposal_id then
  raise exception 'PROPOSAL_BILLING_INVALID: não é permitido descartar o vínculo de faturamento pendente.';
 end if;
 if new.status='won' and old.status<>'won' and new.closure_source='proposal_billing' then
  select * into p from proposals where id=old.billing_proposal_id and deal_id=new.id
   and tenant_id=new.tenant_id and workspace_id=new.workspace_id for update;
  if not found or p.status<>'accepted' or new.closed_by_user_id is null or new.won_proposal_id<>p.id then
   raise exception 'PROPOSAL_BILLING_INVALID: proposta não está pendente de faturamento.';
  end if;
  update proposals set status='invoiced',billed_at=new.closed_at,billed_by_user_id=new.closed_by_user_id,
   billing_source='manual',updated_at=now() where id=p.id;
  insert into proposal_events(id,tenant_id,workspace_id,proposal_id,event_type,occurred_at,payload)
   values('billing-invoiced-'||p.id,p.tenant_id,p.workspace_id,p.id,'invoiced',new.closed_at,
    jsonb_build_object('userId',new.closed_by_user_id,'dealId',new.id,'source','manual'));
  insert into timeline_events(id,tenant_id,workspace_id,entity_type,entity_id,event_type,actor_type,actor_id,payload)
   values('billing-invoiced-'||p.id,p.tenant_id,p.workspace_id,'proposal',p.id,'proposal_invoiced','user',new.closed_by_user_id,
    jsonb_build_object('dealId',new.id,'billedAt',new.closed_at));
 elsif (old.status='won' and new.status<>'won') or (old.status='open' and new.status in ('lost','cancelled')) then
  actor:=case when new.status='open' then new.reopened_by_user_id else new.closed_by_user_id end;
  for p in select * from proposals where deal_id=new.id and tenant_id=new.tenant_id and workspace_id=new.workspace_id
   and status in ('accepted','invoiced') for update loop
   update proposals set status='cancelled',cancelled_at=now(),billing_voided_at=now(),billing_voided_by_user_id=actor,
    billing_void_reason=case when new.status='open' then 'deal_reopened' else 'deal_'||new.status end,updated_at=now() where id=p.id;
   insert into proposal_events(id,tenant_id,workspace_id,proposal_id,event_type,payload)
    values('billing-void-'||p.id,p.tenant_id,p.workspace_id,p.id,'billing_voided',
     jsonb_build_object('dealId',new.id,'userId',actor,'toStatus',new.status,'billedAt',p.billed_at)) on conflict do nothing;
   insert into timeline_events(id,tenant_id,workspace_id,entity_type,entity_id,event_type,actor_type,actor_id,payload)
    values('billing-void-'||p.id,p.tenant_id,p.workspace_id,'proposal',p.id,'proposal_billing_voided',case when actor is null then 'system' else 'user' end,actor,
     jsonb_build_object('dealId',new.id,'toStatus',new.status,'billedAt',p.billed_at)) on conflict do nothing;
  end loop;
 end if;
 return new;
end $$;
create trigger deal_billing_sync after update of status,stage_id,billing_proposal_id on deals for each row execute function vorix_deal_billing_sync();

-- Queue existing accepted/open proposals without replaying acceptance hooks or historical gains.
do $$ declare candidate record; begin
 for candidate in select distinct on (d.id) p.id from proposals p join deals d on d.id=p.deal_id
  and d.tenant_id=p.tenant_id and d.workspace_id=p.workspace_id where p.status='accepted' and d.status='open'
  order by d.id,p.responded_at desc nulls last,p.created_at desc loop
  update proposals set status='viewed' where id=candidate.id;
  update proposals set status='accepted' where id=candidate.id;
 end loop;
end $$;

-- Preserve acceptance proof, but do not leave closed/duplicate proposals in the billing queue.
with cancelled as (
 update proposals p set status='cancelled',cancelled_at=now(),billing_voided_at=now(),
  billing_void_reason='legacy_deal_closed_or_other_accepted_proposal',updated_at=now()
 from deals d where d.id=p.deal_id and d.tenant_id=p.tenant_id and d.workspace_id=p.workspace_id
  and p.status='accepted' and (d.status<>'open' or (d.billing_proposal_id is not null and d.billing_proposal_id<>p.id))
 returning p.*
), events as (
 insert into proposal_events(id,tenant_id,workspace_id,proposal_id,event_type,payload)
 select 'billing-legacy-void-'||id,tenant_id,workspace_id,id,'billing_voided',jsonb_build_object('source','migration_0187','reason',billing_void_reason) from cancelled
)
insert into timeline_events(id,tenant_id,workspace_id,entity_type,entity_id,event_type,actor_type,payload)
select 'billing-legacy-void-'||id,tenant_id,workspace_id,'proposal',id,'proposal_billing_voided','system',
 jsonb_build_object('source','migration_0187','reason',billing_void_reason) from cancelled;
