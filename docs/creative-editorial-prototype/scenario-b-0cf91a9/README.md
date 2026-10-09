# Cenário B real — 0cf91a9 (2026-10-08 22:10 UTC)

- execution-mv03bie3-i7op5z / cer-runtime-mv03bibw-2a54hw, usuário QA user-mubz0k3h-ptjuq3
- Resultado: failed — CREATIVE_QUALITY_GATE_NOT_PASSED (1 issue)
- Issue: UNAUTHORIZED_TEXT "CONHEÇA O RUMO AO ALTAR". Diagnóstico: equivalente ao CTA, mas a bbox
  estimada pela visão (y 85–90%) ficou ~4,5 pontos acima da bbox final do CTA (y 89,9–94,7%);
  só 51% da área dentro (mínimo 60%, tolerância 2,5 pt).
- Variante: COLLAGE_EDITORIAL (seletor real; reproduzida localmente a partir da base).
- Base OpenAI: opaca, sem texto, fotografia editorial (espelho dourado + casal). Contribuição HIGH.
- Custo: US$ 0,0721 (diretor 0,0013 + exploração 0,0003 + imagem 0,0701 + gate de visão 0,0005).
- Cenário C NÃO executado (B falhou).
