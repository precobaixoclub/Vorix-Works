# Preenchimento da foto lateral do banner — 07/11/2026

A foto horizontal era exibida com sua altura natural, centralizada em uma coluna cuja altura vinha do texto. Isso deixava espaços acima e abaixo da imagem, mesmo seguindo a orientação de 1920 × 960 px. Essa orientação correspondia ao banner de fundo do Nexus; a composição personalizada da Bambilu/CMKV usa foto ao lado do texto.

O modo padrão **Preencher a área da imagem** passa a ocupar toda a coluna lateral no computador. A imagem mantém suas proporções, com recorte central quando necessário. A legenda fica sobre a foto. **Mostrar a imagem inteira** continua disponível, exibe a foto completa e informa que diferenças de proporção podem gerar espaços ao redor. A troca funciona imediatamente na prévia e não salva ou publica por conta própria.

As imagens exclusivas do modelo, a imagem da seção e as imagens do carrossel recebem a orientação de **1200 × 1500 px, proporção 4:5**, nessa composição. A orientação dos demais modelos continua sendo resolvida pelo seu próprio layout. O celular mantém a proporção natural da arte, incluindo a imagem exclusiva para celular. Fotos vindas do catálogo continuam inteiras.

Não há alteração dos arquivos de imagem enviados, conteúdo, catálogo, preços, regras comerciais, banco ou backend.

## Validação

- TypeScript aprovado.
- Novo teste de navegador com imagem horizontal e texto longo, em 390, 768, 1440, 1920 e 3840 px, nos modos Preencher e Mostrar inteira. Em Preencher, a imagem corresponde às quatro bordas da coluna lateral; em Mostrar inteira e no celular, conserva a proporção natural. Sem overflow.
- Três testes existentes da Bambilu aprovados: composição, miniaturas, ofertas, busca, seleção de variações, galeria, menu e gestos.
- Novo teste do editor aprovado com API e conta fictícias: orientação nos três campos de imagem, troca imediata de ajuste, aviso de alterações não salvas e ausência de gravação no rascunho/publicação.
- Conferência local com a imagem real da loja nas mesmas cinco larguras. Sem espaço superior ou inferior no modo Preencher do computador; imagem mobile completa. A leitura pública não grava dados na loja.

Evidências em [qa/banner-fill-20261107](qa/banner-fill-20261107): [imagem real no computador](qa/banner-fill-20261107/local-real-1440.png), [tela ampla](qa/banner-fill-20261107/local-real-1920.png), [celular](qa/banner-fill-20261107/local-real-390.png) e [resultado das medidas](qa/banner-fill-20261107/local-real-validation.json).

## Publicação

Registro da publicação e das verificações finais será acrescentado após o deploy.
