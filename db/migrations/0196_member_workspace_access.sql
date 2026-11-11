-- Per-person workspace access inside an account. NULL keeps the current behaviour (every
-- workspace of the account); an array restricts the person to those workspaces only.
-- The account owner always keeps access to every workspace (enforced by the application).
alter table tenant_members add column if not exists workspace_ids text[];

alter table access_audit_log drop constraint if exists access_audit_log_event_type_check;
alter table access_audit_log add constraint access_audit_log_event_type_check check (event_type in (
  'member_created', 'member_removed', 'member_disabled', 'member_enabled',
  'role_changed', 'permission_granted', 'permission_revoked', 'permission_reset',
  'team_member_added', 'team_member_removed', 'team_manager_granted', 'team_manager_revoked',
  'invite_created', 'workspace_access_changed'
));
