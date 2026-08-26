-- 0067 — Auditoria "qualidade visual e direção de arte" (ponto 9): coluna aditiva pra registrar a
-- exploração barata de direções criativas (candidatos + qual foi escolhida + por quê) ANTES do
-- plano detalhado — mesmo padrão de `visual_quality_score` (0066): nullable, jsonb, nunca uma
-- coluna por candidato.

alter table creative_engine_runs add column if not exists chosen_creative_direction jsonb;
