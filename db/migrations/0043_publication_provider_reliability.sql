alter table publication_plans drop constraint if exists publication_plans_state_check;
alter table publication_plans add constraint publication_plans_state_check check (state in ('draft','waiting_for_approval','approved','publishing','published','failed','cancelled','superseded','unknown_outcome'));

create table if not exists publication_provider_descriptors (
  provider_id text primary key,
  provider_version text not null,
  display_name text not null,
  enabled boolean not null,
  supported_channels text[] not null,
  supported_content_types text[] not null,
  supports_idempotency_key boolean not null,
  supports_status_lookup boolean not null,
  supports_delete boolean not null,
  supports_update boolean not null,
  supports_scheduling boolean not null,
  supports_receipt_verification boolean not null,
  max_payload_bytes integer not null,
  max_assets integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists publication_credential_references (
  credential_reference_id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  provider_id text not null,
  status text not null check (status in ('active','disabled','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, workspace_id, provider_id, credential_reference_id)
);

create table if not exists publication_payload_references (
  id text primary key,
  publication_id text not null references publication_plans(id),
  target_id text not null references publication_targets(id),
  tenant_id text not null,
  workspace_id text not null,
  version integer not null,
  content_checksum text not null,
  payload jsonb not null,
  assets jsonb not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);

create table if not exists publication_outbox (
  outbox_message_id text primary key,
  publication_id text not null references publication_plans(id),
  target_id text not null references publication_targets(id),
  attempt_id text not null references publication_attempts(id),
  tenant_id text not null,
  workspace_id text not null,
  provider_id text not null,
  credential_reference_id text,
  idempotency_key text not null,
  payload_reference text not null references publication_payload_references(id),
  status text not null check (status in ('pending','claimed','dispatched','failed','dead_lettered')),
  attempt_count integer not null default 0,
  available_at timestamptz not null,
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  fencing_token integer not null default 0,
  last_failure_code text,
  retry_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publication_id, target_id, provider_id, idempotency_key)
);

create table if not exists publication_reconciliations (
  id text primary key,
  publication_id text not null references publication_plans(id),
  target_id text not null references publication_targets(id),
  attempt_id text not null references publication_attempts(id),
  outbox_message_id text not null references publication_outbox(outbox_message_id),
  tenant_id text not null,
  workspace_id text not null,
  provider_id text not null,
  status text not null check (status in ('pending','confirmed_published','confirmed_not_published','inconclusive')),
  provider_request_id text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists publication_receipt_verifications (
  id text primary key,
  receipt_id text not null references publication_receipts(id),
  publication_id text not null references publication_plans(id),
  target_id text not null references publication_targets(id),
  tenant_id text not null,
  workspace_id text not null,
  provider_id text not null,
  verified_at timestamptz not null default now(),
  verification_status text not null check (verification_status in ('unverified','verified','mismatch','not_supported')),
  external_status text,
  checksum text not null,
  details_code text
);

alter table publication_dead_letters add column if not exists outbox_message_id text;
alter table publication_dead_letters add column if not exists target_id text;
alter table publication_dead_letters add column if not exists provider_id text;
alter table publication_dead_letters add column if not exists last_failure_code text;
alter table publication_dead_letters add column if not exists last_safe_message text;
alter table publication_dead_letters add column if not exists dead_lettered_at timestamptz;
alter table publication_dead_letters add column if not exists recovery_status text;

create index if not exists idx_publication_outbox_status_available on publication_outbox(status, available_at);
create index if not exists idx_publication_outbox_lease on publication_outbox(status, lease_expires_at);
create index if not exists idx_publication_outbox_publication on publication_outbox(publication_id);
create index if not exists idx_publication_outbox_provider on publication_outbox(provider_id);
create index if not exists idx_publication_outbox_idempotency on publication_outbox(idempotency_key);
create index if not exists idx_publication_outbox_fencing on publication_outbox(fencing_token);
create index if not exists idx_publication_payload_references_publication on publication_payload_references(publication_id, target_id);
create index if not exists idx_publication_reconciliations_status on publication_reconciliations(status);
create index if not exists idx_publication_receipt_verifications_publication on publication_receipt_verifications(publication_id);
