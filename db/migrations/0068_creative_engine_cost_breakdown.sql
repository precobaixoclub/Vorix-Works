-- 0068 — Auditoria de custo urgente do motor criativo: coluna aditiva pra registrar o breakdown de
-- custo por etapa (director, exploração de direções, geração de imagem, gate técnico, Visual
-- Quality Score) + subtotal de gasto em rodadas de reparo — mesmo padrão de `visual_quality_score`
-- (0066) e `chosen_creative_direction` (0067): nullable, jsonb, nunca uma coluna por categoria.
--
-- Motivada por um achado crítico desta mesma auditoria: `OpenAiCreativeImageProvider` sempre
-- devolvia custo $0 para geração de imagem (o passo mais caro do pipeline) — corrigido em
-- `gpt-image-1-pricing.ts`/`openai-creative-image-provider.ts`. Sem esta coluna, mesmo com a
-- correção, não havia onde persistir o breakdown por etapa pedido nesta auditoria.

alter table creative_engine_runs add column if not exists cost_breakdown jsonb;
