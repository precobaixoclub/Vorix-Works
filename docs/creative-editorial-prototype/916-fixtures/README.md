# Fixtures 9:16 — composição vertical (local, zero OpenAI)

Artefatos REAIS aprovados no 4:5 (base OpenAI, produto/screenshot/logo, plano e contexto
persistidos) renderizados em 9:16 pelo código novo:

- `node scripts/render-editorial-916-fixtures.mjs [outDir] [--only=a,b,c] [--formats=4:5,9:16] [--variants=...] [--base=...]`
- `node scripts/editorial-text-fit-matrix.mjs 9:16 [outDir]` — headline/sub/CTA curtos, médios e longos.

`linux/` foi renderizado no container com a imagem de produção (fonte Geist real); as renders
locais do Windows usam fonte de fallback e só servem para layout.

- `linux/sheet-final-auto.jpg`: seleção automática A (OVERLAY), B (MINIMAL_PREMIUM), C (FLOATING_PRODUCT) + A com copy longa.
- `linux/sheet-final-variants.jpg`: B em PHOTO_DOMINANT / ASYMMETRIC / FULL_BLEED_STORY e C em UI_HERO.
- Matriz 9:16 em Linux: 36/36 válidas, dentro da safe area vertical (topo 11%, base 14%, laterais 5%).
- 4:5 dos fixtures A/B/C: idêntico pixel a pixel ao 839fab5.
- Matriz 4:5 (copy sintética longa): mesmas 18/36 inválidas do 839fab5 (SPLIT/MINIMAL recusam com
  TEXT_OVERFLOW — fail-closed, limitação preexistente do 4:5, não reaberta).
