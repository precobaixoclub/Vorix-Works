# Cenário B real — fce0164 (retomada após quota) — 2026-10-09 22:09 UTC

- Sonda de quota: GET /v1/models 200; chat gpt-4o-mini 1 token → 200 (9 tokens, ≈US$0,000002).
- execution-mv1ipciu-jociy4 / cer-runtime-mv1ipcey-6wbubm, usuário QA user-mubz0k3h-ptjuq3
- Resultado: failed — CREATIVE_QUALITY_GATE_NOT_PASSED, 1 issue: DUPLICATED_TEXT "Conheça o Rumo ao Altar".
  A visão reportou 2 ocorrências: (x 70%, y 90%) = CTA real; (x 5%, y 85%) = posição do SUBTÍTULO
  ("Site, lista de presentes…") — leitura errada da visão. A peça tem um único CTA. O ledger só
  explica 1 ocorrência dessa frase → reprova (comportamento correto, conservador).
- Base: opaca (requested background opaque, 0% não opaco), scan de texto AVAILABLE com 0 textos.
  Fotografia única (véus/tules ao vento sobre campo ao pôr do sol).
- Classificação: SINGLE_SCENE_PHOTO (cena contínua, sem divisórias; separador candidato 8,7%,
  variação de cor 193 → confiança 0). Variante: MINIMAL_PREMIUM (plano clean).
- Logo fiel (7,42). Geometria válida. Score visual não rodou (gate reprovou antes).
- Custo: US$ 0,0727. 1 imagem, 0 reparos, 0 regenerações.

## Reavaliação diagnóstica — VISION_ZONE_CONTRADICTION (local, zero OpenAI)

`diagnostic-reevaluation.json`: as mesmas ocorrências persistidas da visão foram reaplicadas ao gate
novo (geometria final do ledger, verificação em pixel da logo, scan da base AVAILABLE/[]). Não altera
o histórico do run (que continua `failed`).

- dup-0-1 (70%, 90%) → `allowed` na zona final do CTA.
- dup-0-0 (5%, 85%, 20×5) → `VISION_ZONE_CONTRADICTION`, `ignoredForDuplicateCount`: a bbox cai, pela
  regra estrita de região (60% / 2,5 pt), na zona do renderer **headline** ("O casamento organizado…";
  ela também encosta na subheadline, mas a maior sobreposição é com o headline), texto diferente, base
  limpa, CTA com origem única `renderer:cta:2` já encontrada.
- Contagem efetiva 1 → DUPLICATED_TEXT eliminado; nenhuma outra issue; veredito diagnóstico `pass`.
