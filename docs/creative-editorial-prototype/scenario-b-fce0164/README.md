# Cenário B real — fce0164 (2026-10-09 19:28 UTC)

- execution-mv1cygsb-asaole / cer-runtime-mv1cygov-q5rzfz, usuário QA user-mubz0k3h-ptjuq3
- Resultado: failed — PROVIDER_QUOTA_EXHAUSTED, 6 s após o disparo.
- Chamadas de IA: text_generation (exploração de direção) failed; analysis (diretor) failed.
  Nenhuma geração de imagem, nenhum scan de base, nenhum gate. Custo US$ 0,00.
- Causa: crédito/quota da conta OpenAI esgotado (bloqueio externo). Nenhuma base, nenhum final:
  B_VISUAL_QUALITY = NOT_HOMOLOGATED.
- Deploy e regressões sem IA de fce0164: todos PASS antes do disparo.
