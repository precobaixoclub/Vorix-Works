# Cenário B real — f9f6aed — execution-mv2a2bp0-g974f2 (2026-10-10)

- Resultado: failed — UNAUTHORIZED_TEXT "CONHEÇA O RUMO AO ALTAR".
- Causa: falso positivo do gate. Bbox da visão na grade de 5 pt (60,85,30×5) ficou 59,9% dentro da
  faixa de "uma altura" de um CTA com 2,7% de altura (mínimo 60%).
- Classe SINGLE_SCENE_PHOTO → MINIMAL_PREMIUM; base opaca, scan AVAILABLE/0 textos; logo fiel; visual publicável.
- Correção: 6bde0b7 (faixa nunca menor que a resolução da visão, só com base escaneada e limpa). Reavaliação local: pass.
- Custo US$ 0,0729; 1 imagem.
