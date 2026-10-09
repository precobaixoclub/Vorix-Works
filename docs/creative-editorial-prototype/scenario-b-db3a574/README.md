# Cenário B real — db3a574 (2026-10-09 06:58 UTC)

- execution-mv0m68op-4z3oek / cer-runtime-mv0m68m8-ngwudb, usuário QA user-mubz0k3h-ptjuq3
- Resultado do motor: completed, publishable=true, gate técnico PASS (0 issues), score visual
  automático 7,83. Execução em waiting_for_approval (aprovação humana pendente — não aprovada).
- Pedido de imagem: background=opaque. Base: sem canal alfa (100% opaca), sem texto.
- Scan de texto da base: AVAILABLE, 0 textos (US$ 0,00015).
- Ledger: RENDERER_TEXT headline/subheadline/cta + LOGO_ASSET ("rumo ao altar"); sem BASE_IMAGE.
- Duplicidade: a visão reportou 2× "Rumo ao Altar" (uma em y≈38%, posição inexistente; outra no
  CTA) → LEDGER_RECONCILED (CTA + logo; base sem o texto).
- CTA: a visão não reportou o CTA em caixa alta como não autorizado nesta execução (regra de alta
  confiança não precisou ser acionada).
- Variante (persistida no run): COLLAGE_EDITORIAL — "5 focos de detalhe, 8% de espaço negativo";
  base inteira, contain, sem recorte.
- Logo: visível e fiel (diferença média 7,15).
- Custo: US$ 0,0732 (diretor 0,0013 + exploração 0,0003 + imagem 0,0705 + scan base 0,00015 +
  gate 0,0005 + score visual 0,0005). 1 imagem, 0 reparos, 0 regenerações.
- Arquivos: 1-openai-base.jpg, 2-final-rendered.jpg, run-diagnostics.json.
