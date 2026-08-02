-- Release Track 1.0 (Fase 5) — fecha o achado da Sprint 24: 5 tabelas de publication_domain
-- (migration 0042) não tinham índice na coluna de FK usada pela leitura de detalhe de uma
-- publication (`PostgresPublicationRepository.getById`, um fan-out de 7 queries paralelas por
-- `publication_id`). Postgres nunca indexa automaticamente o lado FK de uma referência — só o
-- lado PK. `publication_targets`/`publication_receipts` já eram cobertas incidentalmente por uma
-- constraint `unique` que começa em `publication_id`; as 5 tabelas abaixo não tinham nenhuma.
create index if not exists idx_publication_candidates_publication on publication_candidates(publication_id);
create index if not exists idx_publication_approvals_publication on publication_approvals(publication_id);
create index if not exists idx_publication_attempts_publication on publication_attempts(publication_id);
create index if not exists idx_publication_failures_publication on publication_failures(publication_id);
create index if not exists idx_publication_dead_letters_publication on publication_dead_letters(publication_id);

-- GET /v1/publications/dead-letters filtra por tenant/workspace (não por publication_id) —
-- `postgres-publication-repository.ts`, listagem de dead letters.
create index if not exists idx_publication_dead_letters_tenant_workspace on publication_dead_letters(tenant_id, workspace_id, created_at desc);
