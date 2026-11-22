-- 0201 — Imagens de referência por ideia do Bolsão.
--
-- Cada ideia pode carregar até 6 imagens enviadas pela equipe (foto do produto, do casal, print da
-- tela, peça de inspiração). Guardamos só a URL canônica do storage (sem assinatura): a resposta
-- JSON autenticada assina na hora, e o motor de arte usa essas imagens no lugar de banco de fotos.

alter table editorial_ideas add column if not exists reference_images jsonb not null default '[]'::jsonb;
