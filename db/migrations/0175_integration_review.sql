-- Legacy self-service accounts were created as admin before owner became the administrator.
-- Only repair tenants without an active owner; retain other members and their explicit grants.
update tenant_members m set role = 'owner', is_account_owner = true,
  permission_revokes = array(select permission from unnest(m.permission_revokes) permission where permission not in ('tenant_member:manage', 'tenant_member:manage_permissions', 'team:manage'))
from (
  select distinct on (tenant_id) id, tenant_id from tenant_members candidate
  where candidate.role = 'admin' and candidate.status = 'active'
    and not exists (select 1 from tenant_members o where o.tenant_id = candidate.tenant_id and (o.is_account_owner or (o.role = 'owner' and o.status = 'active')))
  order by tenant_id, created_at, id
) legacy_creator
where m.id = legacy_creator.id;

-- Permissions, rather than the legacy commercial visibility preference, grant broad access.
alter table commercial_settings alter column deal_visibility set default 'own';

-- The SLA report also selects responses from cycles that began before the reporting period.
create index if not exists inbox_assignment_first_response_period
  on inbox_attendance_assignments (tenant_id, workspace_id, first_response_at)
  where first_response_at is not null;

-- Preserve the last known closure/CSAT of legacy conversations. Earlier operational cycles
-- cannot be reconstructed from a conversation row. Do not invent assignment/FRT history.
insert into inbox_attendances (
  id, tenant_id, workspace_id, conversation_id, contact_id, connection_id, team_id, number,
  status, opened_at, opened_by, open_reason, closed_at, closed_by, closure_type_name,
  csat_status, csat_sent_at, csat_score, csat_answered_at
)
select 'attn-review-legacy-' || c.id, c.tenant_id, c.workspace_id, c.id, c.contact_id,
       c.connection_id, c.current_team_id,
       coalesce((select max(a.number) from inbox_attendances a where a.workspace_id = c.workspace_id), 0)
         + row_number() over (partition by c.workspace_id order by c.closed_at, c.id),
       'closed', least(c.created_at, c.closed_at), 'system', 'migration', c.closed_at, c.closed_by,
       c.closing_reason,
       case when c.csat_requested_at is not null then 'sent' else 'not_applicable' end,
       c.csat_requested_at,
       case when c.csat_status = 'answered' and c.csat_score between 1 and 5 then c.csat_score end,
       case when c.csat_status = 'answered' then c.csat_answered_at end
from inbox_conversations c
join workspaces w on w.id = c.workspace_id and w.tenant_id = c.tenant_id
where c.status = 'resolved' and c.closed_at is not null and c.merge_status is null
  and not exists (select 1 from inbox_attendances a where a.conversation_id = c.id);
