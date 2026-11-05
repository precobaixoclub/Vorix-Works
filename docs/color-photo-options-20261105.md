# Bambilu Kids — opções de cor com fotos

As opções de cor da apresentação Fashion / Kids usam miniaturas reais do produto no catálogo, nos destaques, nos relacionados e no detalhe. Clicar, tocar ou focar uma miniatura no card troca a foto principal; no detalhe, a escolha continua passando pela seleção e disponibilidade de variantes existente.

Nos cards aparecem quatro fotos e um botão `+N`, que expande as cores restantes. No detalhe aparecem todas as opções, com foto, nome, seleção marcada e estado indisponível quando aplicável. Imagens usam `contain`, sem cortar a peça; as miniaturas usam a derivação de 160 px e carregamento sob demanda.

`productOptionPhoto` resolve primeiro a foto de uma combinação completa, depois a foto vinculada à cor e, por último, uma foto de variante compatível. Uma cor sem foto vinculada é identificada pelo nome e por “Sem foto”; nenhuma imagem de outra cor é apresentada como se fosse dela. Falhas de carregamento também preservam a identificação por texto.

Não houve alteração de produtos, variações, preços, estoque, regras comerciais, carrinho ou checkout. A ativação visual se limita à apresentação da Bambilu Kids; os demais templates preservam seus controles existentes.

## Validação

- 273 testes de frontend em 39 arquivos aprovados, incluindo resolução da foto correta e preservação dos dados de seleção.
- Typecheck aprovado.
- 10 testes Playwright aprovados, cobrindo miniaturas, expansão, troca de foto, seleção, toque/swipe e regressão das galerias dos seis templates.
- Conferência adicional com os produtos reais em 360, 390, 430, 768, 1024 e 1440 px: 12 verificações aprovadas, sem overflow ou erros JavaScript.
- Conferência de mouse, clique, toque, seleção de tamanho/cor e correspondência entre a miniatura escolhida e a imagem principal.

[Capturas e validação local](qa/color-photo-options-20261105/README.md).
