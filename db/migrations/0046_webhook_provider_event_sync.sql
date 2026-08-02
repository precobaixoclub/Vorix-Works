create table if not exists webhook_events (
  id text primary key,
  provider_id text not null,
  tenant_id text,
  workspace_id text,
  status text not null,
  signature jsonb not null,
  headers jsonb not null,
  payload jsonb not null,
  raw_payload_digest text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  rejection_reason text,
  constraint webhook_events_status_check check (status in ('received', 'verified', 'rejected', 'normalized', 'processed', 'failed'))
);

create index if not exists idx_webhook_events_provider_received on webhook_events(provider_id, received_at);
create index if not exists idx_webhook_events_workspace_received on webhook_events(tenant_id, workspace_id, received_at);
create index if not exists idx_webhook_events_status on webhook_events(status);

create table if not exists webhook_verifications (
  id text primary key,
  webhook_event_id text not null,
  provider_id text not null,
  verified boolean not null,
  status text not null,
  safe_message text not null,
  checked_at timestamptz not null default now(),
  constraint webhook_verifications_status_check check (status in ('valid', 'invalid_signature', 'timestamp_expired', 'replay_detected', 'provider_unknown', 'payload_invalid'))
);

create index if not exists idx_webhook_verifications_event on webhook_verifications(webhook_event_id);

create table if not exists webhook_nonces (
  provider_id text not null,
  nonce text not null,
  webhook_event_id text,
  timestamp timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (provider_id, nonce)
);

create table if not exists provider_events (
  id text primary key,
  webhook_event_id text,
  provider_id text not null,
  tenant_id text,
  workspace_id text,
  event_type text not null,
  external_event_id text,
  payload jsonb not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_provider_events_workspace_created on provider_events(tenant_id, workspace_id, created_at);
create index if not exists idx_provider_events_provider_type on provider_events(provider_id, event_type);

create table if not exists normalized_provider_events (
  id text primary key,
  provider_event_id text not null,
  provider_id text not null,
  tenant_id text not null,
  workspace_id text not null,
  publication_id text,
  target_id text,
  receipt_id text,
  type text not null,
  status text not null,
  channel text,
  provider_publication_id text,
  provider_request_id text,
  idempotency_key text,
  external_status text,
  url text,
  occurred_at timestamptz not null,
  safe_message text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint normalized_provider_events_type_check check (type in ('PublicationStatusChanged', 'ReceiptUpdated', 'PublicationDeleted', 'PublicationRejected', 'PublicationRecovered')),
  constraint normalized_provider_events_status_check check (status in ('pending', 'processed', 'ignored', 'failed'))
);

create index if not exists idx_normalized_provider_events_workspace_created on normalized_provider_events(tenant_id, workspace_id, created_at);
create index if not exists idx_normalized_provider_events_status on normalized_provider_events(status);
create index if not exists idx_normalized_provider_events_publication on normalized_provider_events(publication_id, target_id);

create table if not exists synchronization_events (
  id text primary key,
  tenant_id text not null,
  workspace_id text not null,
  provider_id text not null,
  normalized_event_id text,
  publication_id text,
  target_id text,
  receipt_id text,
  status text not null,
  safe_message text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint synchronization_events_status_check check (status in ('started', 'completed', 'failed', 'ignored'))
);

create index if not exists idx_synchronization_events_workspace_created on synchronization_events(tenant_id, workspace_id, created_at);
create index if not exists idx_synchronization_events_provider on synchronization_events(provider_id, created_at);
