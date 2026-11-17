-- 0199 — Prompt criativo específico por pauta editorial.
--
-- Cada pauta do bolsão pode ter um prompt criativo próprio, usado pelo motor criativo na geração
-- (orienta composição e narrativa, sem sobrescrever as regras globais de identidade e veracidade).
-- Opcional e retrocompatível: pautas sem prompt seguem o comportamento padrão do motor. Preso ao
-- mesmo registro (workspace_id + external_id), editável após a importação.
alter table editorial_ideas add column if not exists creative_prompt text;
