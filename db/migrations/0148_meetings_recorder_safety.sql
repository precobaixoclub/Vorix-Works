-- Confirmed participation identities, tenant pools, reconnect state and database guarantees.
alter table recorder_bot_accounts drop constraint if exists recorder_bot_accounts_status_check;
alter table recorder_bot_accounts add constraint recorder_bot_accounts_status_check
  check (status in ('active','busy','reauth_required','invalid_session','disabled','error'));

alter table meetings drop constraint if exists meetings_human_join_identity_source_check;
update meetings set human_join_identity_source = case
  when human_join_identity_source = 'google_calendar_organizer' then 'inferred_organizer'
  when human_join_identity_source in ('calendar_owner','connected_google_account') then 'inferred_calendar_owner'
  else human_join_identity_source end;
update meetings set excluded_recorder_emails = '{}'
  where human_join_identity_source in ('inferred_organizer','inferred_calendar_owner','unknown');
alter table meetings add constraint meetings_human_join_identity_source_check check
  (human_join_identity_source is null or human_join_identity_source in
    ('explicit','connected_account_confirmed','inferred_organizer','inferred_calendar_owner','unknown'));

-- One account cannot back two active meetings or two active recorder processes, regardless of
-- application status. Index creation fails if old data violates this invariant.
create unique index if not exists meetings_active_recorder_account_uidx
  on meetings (bot_account_id) where bot_account_id is not null and
    status in ('queued','starting','waiting_admission','recording');
create unique index if not exists meeting_recorder_runs_active_account_uidx
  on meeting_recorder_runs (bot_account_id) where state in
    ('starting','waiting_admission','recording','processing');

-- Null workspace = tenant pool. A defined workspace is an explicit usage restriction.
create unique index if not exists workspaces_id_tenant_recorder_uidx on workspaces (id, tenant_id);
alter table recorder_bot_accounts drop constraint if exists recorder_accounts_workspace_tenant_fk;
alter table recorder_bot_accounts add constraint recorder_accounts_workspace_tenant_fk
  foreign key (workspace_id, tenant_id) references workspaces (id, tenant_id);
create unique index if not exists recorder_accounts_id_tenant_uidx on recorder_bot_accounts (id, tenant_id);
alter table recorder_provisioning_sessions drop constraint if exists recorder_provisioning_account_tenant_fk;
alter table recorder_provisioning_sessions add constraint recorder_provisioning_account_tenant_fk
  foreign key (recorder_account_id, tenant_id) references recorder_bot_accounts (id, tenant_id);
alter table recorder_provisioning_sessions drop constraint if exists recorder_provisioning_workspace_tenant_fk;
alter table recorder_provisioning_sessions add constraint recorder_provisioning_workspace_tenant_fk
  foreign key (workspace_id, tenant_id) references workspaces (id, tenant_id);
alter table recorder_bot_accounts drop constraint if exists recorder_accounts_reservation_tenant_check;
alter table recorder_bot_accounts add constraint recorder_accounts_reservation_tenant_check
  check (ownership_type <> 'customer_managed' or current_tenant_id is null or current_tenant_id = tenant_id);

alter table recorder_provisioning_sessions add column if not exists single_use boolean not null default true;
alter table recorder_provisioning_sessions add column if not exists viewer_consumed_at timestamptz;
alter table recorder_provisioning_sessions add column if not exists reconnect boolean not null default false;
create unique index if not exists recorder_provisioning_one_open_account_uidx
  on recorder_provisioning_sessions (recorder_account_id) where status in ('pending','starting','live');
