# Cenário C real — 6bde0b7 — execution-mv2aptkj-mjlqxq (2026-10-10)

- Resultado técnico: completed, publishable=true, gate PASS — mas REPROVADO na avaliação visual/comercial.
- Defeito: "R$ 79,90" desenhado em destaque como preço do serviço. O valor é o preço de um item da lista
  de presentes visível DENTRO do screenshot; a extração de fatos comerciais lia screenshots e o promovia a
  "preço atual confirmado" (o pedido dizia "sem preço em destaque").
- Correção: 839fab5 (só foto de produto gera fato comercial). Re-render local sem o preço:
  3-local-rerender-no-screenshot-price.jpg → FLOATING_PRODUCT (fontes locais do Windows diferem da produção).
- Screenshot fiel (5,04), logo fiel. Variante UI_HERO (forçada pela linha de preço extra).
- Custo US$ 0,0743; 1 imagem.
