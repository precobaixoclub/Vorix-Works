# Cenário B real — 86a9f25 (2026-10-09 01:44 UTC)

- execution-mv0ayw83-a0iw8l / cer-runtime-mv0ayw58-3eja1z, usuário QA user-mubz0k3h-ptjuq3
- Resultado: failed — CREATIVE_QUALITY_GATE_NOT_PASSED (1 issue)
- CTA: MATCHED_RENDERED_CTA ao vivo (bbox visão y 85–90% vs final 89,9–94,7%; overlap 0,014;
  centro a 4,8 pt; faixa 4,741 pt) — o falso negativo anterior não se repetiu.
- Issue: DUPLICATED_TEXT "Rumo ao Altar" com 2 ocorrências reportadas em (44%, 48%) e (44%, 5%).
  A peça final não tem esse texto nessas posições; as ocorrências reais são o logo (y≈64–67%) e o
  CTA (y≈90–94%). Localização da visão errada por ~20–60 pt → não é possível provar proveniência →
  reprova pela regra (correto).
- Variante persistida no run (artifactProvenance.editorialComposition): COLLAGE_EDITORIAL,
  "base com 10 focos de detalhe separados e pouco espaço negativo (28%)".
- Base OpenAI: RGBA recortada, 46,5% transparente (flores penduradas + vazio) — na colagem o vazio
  vira uma área creme no meio da peça. Sem texto.
- Custo: US$ 0,0723 (diretor 0,0013 + exploração 0,0003 + imagem 0,0701 + gate 0,0005). 1 imagem.
- Cenário C NÃO executado (B falhou).
