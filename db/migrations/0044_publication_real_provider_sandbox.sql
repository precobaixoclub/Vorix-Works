alter table publication_credential_references add column if not exists environment text;
alter table publication_credential_references add column if not exists provider_subject_id text;
alter table publication_credential_references add column if not exists scopes text[];
alter table publication_credential_references add column if not exists expires_at timestamptz;
alter table publication_credential_references add column if not exists last_refreshed_at timestamptz;
alter table publication_credential_references add column if not exists revoked_at timestamptz;

alter table publication_receipts add column if not exists provider_request_id text;
alter table publication_receipts add column if not exists external_identifiers jsonb;

create index if not exists idx_publication_credential_references_provider_subject on publication_credential_references(provider_id, provider_subject_id);
create index if not exists idx_publication_receipts_provider_request on publication_receipts(provider, provider_request_id);
