-- 0211 — Vídeos de referência por ideia do Bolsão.
--
-- Até 3 vídeos profissionais enviados pela equipe, cada um com um PAPEL: estrutura (gancho, ritmo,
-- progressão, CTA), estética (composição, transições, acabamento) ou ambos, e uma nota livre. O motor
-- MEDE a linguagem do vídeo (cortes, ritmo, movimento, cor, composição, áudio) e o diretor cria uma peça
-- ORIGINAL com os materiais da marca: nenhum trecho da referência entra no vídeo gerado.
-- Guardamos só a URL canônica do storage do workspace (sem assinatura), como nas imagens (0201).

alter table editorial_ideas add column if not exists reference_videos jsonb not null default '[]'::jsonb;
