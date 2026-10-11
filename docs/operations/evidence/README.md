# Evidências do release hardening (2026-10-11)

## Estabilidade do scan de texto da base digital

Amostra: as 12 bases de serviço digital persistidas em produção (todas distintas, sha256 na coluna
`sha256`). Nenhuma imagem foi gerada; a amostra inclui as bases que antes recusavam. Mesmo caminho do
runtime: base achatada (`flattenImageForVision`) → data URL → `scanEditorialBaseText` → provedor real,
com novas tentativas espaçadas. Script: `scan-stability.mjs`.

| Rodada | Modelo | AVAILABLE | Recusas do provedor | Vazio mal classificado | Custo |
|---|---|---|---|---|---|
| `base-text-scan-stability-gpt4o.jsonl` | gpt-4o (antes) | 10/12 (83%) | 7 (2 bases recusadas 3/3) | 0 | US$ 0,0017 |
| `base-text-scan-stability-gpt41.jsonl` (2 rodadas) | gpt-4.1 (`visionTextBrain`) | **24/24 (100%)** | **0** | **0** | US$ 0,004 |

Na matriz de diagnóstico (prompt × modelo, 3 execuções cada) sobre as duas bases recusadas, o gpt-4o
recusou com o prompt atual (3/3 nas duas) e com o prompt alternativo (3/3 em uma delas), enquanto
gpt-4.1, gpt-4.1-mini e gpt-4o-mini responderam 12/12 em cada base — e leram corretamente o texto
fantasma real ("Gift List") desenhado pela IA numa delas.
