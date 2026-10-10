# Cenário B real — 16bd551 — execution-mv29jftt-v4haee (2026-10-10)

- Resultado: failed — CREATIVE_QUALITY_GATE_NOT_PASSED, 1 issue UNAUTHORIZED_TEXT "CONHEÇA O RUMO AO ALTAR".
- Causa: falso positivo do gate. A visão leu o CTA exato uma vez, com bbox (70,85,20×5) DENTRO da zona
  onde o renderer desenhou o subtítulo; CTA real logo abaixo. Base opaca, scan AVAILABLE com 0 textos.
- Classe SINGLE_SCENE_PHOTO → PHOTO_DOMINANT_EDITORIAL; logo fiel (8,74); visual publicável.
- Correção: f9f6aed (contradição de zona também no caminho de texto). Reavaliação local: pass.
- Custo US$ 0,0728; 1 imagem.
