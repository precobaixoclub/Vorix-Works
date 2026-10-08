-- 0138 — Proveniência de artefatos intermediários do Creative Engine.
-- Aditiva: execuções históricas continuam válidas com artifact_provenance null.
-- Usada pelo modo editorial experimental para auditar PRODUCT -> BASE -> FINAL sem depender de
-- logs ou nomes de arquivo inferidos.

alter table creative_engine_runs
  add column if not exists artifact_provenance jsonb;
