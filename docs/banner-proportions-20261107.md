# Proporção do banner com texto ao lado — 07/11/2026

A campanha horizontal era colocada na mesma moldura de altura fixa usada por fotos verticais de produtos. Com `object-fit: contain`, a diferença de proporções criava faixas brancas, sobretudo em larguras grandes equivalentes a reduzir o zoom do navegador.

As artes cadastradas no banner agora usam largura disponível e altura natural. O texto ao lado, a composição do modelo, os links e o carrossel permanecem configurados como antes. A versão mobile respeita a proporção do arquivo selecionado pelo `picture`, inclusive quando só há imagem própria para celular. As fotos vindas do catálogo continuam na moldura original, inteiras.

Não há alteração do arquivo de imagem, recorte, esticamento, alteração de conteúdo publicado, backend ou migration.

## Validação

- Typecheck e 11 testes frontend relevantes aprovados.
- Três testes de navegador existentes de composição, cores, ofertas, busca, menu, swipe e detalhe aprovados.
- Conferência local do banner real em 390, 768, 1920, 3840, 5760 e 7680 px. As três últimas larguras incluem rasterização equivalente a zoom de 50%, 33% e 25% em uma tela de 1920 px.
- A proporção exibida corresponde à proporção natural; imagem e moldura têm as mesmas dimensões, sem faixas internas, recorte, overflow ou erros JavaScript.
- O texto permanece ao lado no computador e segue a organização original no celular.

Evidências em [qa/banner-proportions-20261107](qa/banner-proportions-20261107). As capturas de antes reproduzem a moldura anterior na mesma prévia local. A conferência utiliza uma cópia somente de leitura dos dados públicos; não grava na loja.
