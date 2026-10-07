-- 0137 - Execution trusted initiator
-- Stores the authenticated user that created the execution run. Existing runs remain null and
-- therefore cannot authorize experimental editorial execution, while normal execution behavior is
-- preserved.

alter table execution_runs
  add column if not exists initiated_by_user_id text;

create index if not exists execution_runs_initiated_by_user_idx
  on execution_runs (initiated_by_user_id)
  where initiated_by_user_id is not null;
