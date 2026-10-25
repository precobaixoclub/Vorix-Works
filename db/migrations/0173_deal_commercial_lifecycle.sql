-- Preserve stage/deal IDs and existing labels while giving every existing pipeline one outcome
-- of each kind. Duplicate legacy terminal columns become ordinary configurable stages.
with ranked as (
  select id, row_number() over (partition by pipeline_id order by position, id) as n
  from pipeline_stages where is_won
) update pipeline_stages set is_won = false where id in (select id from ranked where n > 1);
with ranked as (
  select id, row_number() over (partition by pipeline_id order by position, id) as n
  from pipeline_stages where is_lost and not is_won
) update pipeline_stages set is_lost = false where id in (select id from ranked where n > 1);
update pipeline_stages set is_lost = false where is_won and is_lost;
insert into pipeline_stages (id, pipeline_id, name, position, is_won, is_lost)
select 'system-open-' || p.id, p.id, 'Novo', coalesce((select max(position) + 1 from pipeline_stages where pipeline_id = p.id), 0), false, false
from pipelines p where not exists (select 1 from pipeline_stages where pipeline_id = p.id and not is_won and not is_lost);
insert into pipeline_stages (id, pipeline_id, name, position, is_won, is_lost)
select 'system-won-' || p.id, p.id, 'Ganha', coalesce((select max(position) + 1 from pipeline_stages where pipeline_id = p.id), 0), true, false
from pipelines p where not exists (select 1 from pipeline_stages where pipeline_id = p.id and is_won);
insert into pipeline_stages (id, pipeline_id, name, position, is_won, is_lost)
select 'system-lost-' || p.id, p.id, 'Perdida', coalesce((select max(position) + 1 from pipeline_stages where pipeline_id = p.id), 0), false, true
from pipelines p where not exists (select 1 from pipeline_stages where pipeline_id = p.id and is_lost);
-- Free the unique positions before assigning the normalized order.
update pipeline_stages set position = -position - 1;
with ordered as (
  select id, row_number() over (partition by pipeline_id order by case when is_lost then 2 when is_won then 1 else 0 end, position desc, id) - 1 as pos
  from pipeline_stages
) update pipeline_stages s set position = ordered.pos from ordered where s.id = ordered.id;
create unique index pipeline_one_won_stage on pipeline_stages(pipeline_id) where is_won;
create unique index pipeline_one_lost_stage on pipeline_stages(pipeline_id) where is_lost;
alter table pipeline_stages add constraint pipeline_stage_single_outcome check (not (is_won and is_lost));

alter table deals add column archived_at timestamptz;
alter table deals add column archive_manual_hold boolean not null default false;
alter table deals add column first_closed_at timestamptz;
alter table deals add column reopened_at timestamptz;
alter table deals add column reopened_by_user_id text;
alter table deals add column reopen_count integer not null default 0;
alter table deals add column closure_source text;
alter table deals add column loss_reason_id text references sales_close_reasons(id);
with reasons as (
  select distinct on (workspace_id, lower(trim(label))) id, tenant_id, workspace_id, lower(trim(label)) as label
  from sales_close_reasons where kind = 'lost' order by workspace_id, lower(trim(label)), active desc, position, id
)
update deals d set loss_reason_id = r.id from reasons r
where d.tenant_id = r.tenant_id and d.workspace_id = r.workspace_id and lower(trim(d.loss_reason)) = r.label;
with reasons as (
  select distinct on (workspace_id, lower(trim(label))) id, tenant_id, workspace_id, lower(trim(label)) as label
  from sales_close_reasons where kind = 'lost' order by workspace_id, lower(trim(label)), active desc, position, id
)
update timeline_events e set payload = e.payload || jsonb_build_object('lossReasonId', r.id) from reasons r
where e.tenant_id = r.tenant_id and e.workspace_id = r.workspace_id and e.entity_type = 'deal'
  and e.event_type = 'deal_lost' and lower(trim(e.payload->>'lossReason')) = r.label;
update deals set first_closed_at = closed_at where closed_at is not null;
-- A legacy terminal column may have been duplicated. Keep the deal and its result/amount,
-- and point it at the canonical outcome column without applying another commercial closing.
with moved as (
  select d.id, d.stage_id as from_stage_id, s.id as to_stage_id
  from deals d join pipeline_stages s on s.pipeline_id = d.pipeline_id
    and ((d.status = 'won' and s.is_won) or (d.status = 'lost' and s.is_lost))
  where d.stage_id <> s.id
), changed as (
  update deals d set stage_id = moved.to_stage_id, last_stage_changed_at = now(), updated_at = now()
  from moved where d.id = moved.id returning d.*, moved.from_stage_id
)
insert into timeline_events (id, tenant_id, workspace_id, entity_type, entity_id, event_type, actor_type, payload)
select 'lifecycle-migration-' || id, tenant_id, workspace_id, 'deal', id, 'deal_stage_changed', 'system',
  jsonb_build_object('source', 'lifecycle_migration', 'fromStageId', from_stage_id, 'toStageId', stage_id, 'status', status)
from changed;
create index deals_closed_archive_due on deals(workspace_id, closed_at) where status in ('won', 'lost') and archived_at is null;
alter table commercial_settings add column closed_deal_archive_days integer check (closed_deal_archive_days >= 0 and closed_deal_archive_days <= 36500);
alter table commercial_settings alter column proposal_accept_auto_win set default true;
