-- 0066 — Auditoria "qualidade visual e direção de arte" (segunda auditoria do motor de criativos):
-- coluna aditiva pra registrar o Visual Quality Score (12 dimensões + nota geral + justificativas),
-- deliberadamente separado de `quality_gate` (0060) — aquela coluna guarda o veredito TÉCNICO
-- pass/fail; esta guarda a avaliação ESTÉTICA/subjetiva, sempre um score nunca um pass/fail puro.
-- Mesmo padrão de `quality_gate`: nullable (nem toda linha passa pelo score — só roda depois que o
-- gate técnico já aprovou), jsonb, nunca uma coluna por dimensão (mesma filosofia de "footprint
-- mínimo" já usada nas colunas de auditoria anteriores).

alter table creative_engine_runs add column if not exists visual_quality_score jsonb;
