# Cenário A 9:16 real — 15a10d6 — execution-mv2ifqf0-vtl4ov (2026-10-10)

- Resultado: failed — 1 issue UNAUTHORIZED_TEXT "Rumo ao Altar" (falso positivo do gate).
- Causa: a visão leu o texto da LOGO com bbox (5,5,20×5) na grade de 5 pt; a logo verificada real
  está em (6,7, 11,0, 19,6×2,4) — no 9:16 ela tem só 2,4% de altura e a regra estrita (60% / 2,5 pt)
  não comporta o erro de quantização do sensor (~96 px no canvas de 1920).
- Peça: OVERLAY_EDITORIAL, produto fiel (2,58), logo fiel, preço confirmado do pedido, safe area
  vertical respeitada — visualmente publicável.
- Correção: literal exato da marca (ledger LOGO_ASSET), leitura única, base escaneada e limpa, perto da
  logo verificada pela faixa com piso de 5 pt → MATCHED_VERIFIED_LOGO. Reavaliação local: pass.
- Custo US$ 0,0737; 1 imagem.
