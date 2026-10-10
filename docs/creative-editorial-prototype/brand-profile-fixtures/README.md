# Fixtures de Brand Profile (local, zero OpenAI)

Artefatos REAIS aprovados (A produto, B institucional, C digital) renderizados sem perfil (NONE) e
com 3 Brand Profiles sintéticos (`tests/fixtures/editorial/brand/profiles.mjs`):

- P1 premium/editorial — vinho + dourado, serifada clássica, cantos suaves, densidade baixa,
  intensidade comercial baixa, vermelho proibido.
- P2 tech/bold — azul elétrico + violeta, sans pesada em caixa alta, pílula, intensidade alta,
  laranja proibido.
- P3 minimal/corporate — verde-petróleo, sans neutra, cantos retos, sem sombras; proíbe gradientes,
  fundos escuros, caixa alta e vermelho.

`linux/fx/sheet-{a,b,c}-{4x5,9x16}.jpg`: NONE · P1 · P2 · P3 lado a lado, renderizados no container
com a imagem de produção + DM Serif Display registrada. Mesma estrutura, textos, produto/screenshot e
geometria válida; linguagem visual diferente. Sem perfil, A/B/C (4:5 e 9:16) são idênticos pixel a
pixel ao f20113b.

Gerar: `node scripts/render-brand-profile-fixtures.mjs [outDir] --formats=4:5,9:16`.
