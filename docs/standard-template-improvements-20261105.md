# Recursos e apresentação dos modelos padrão

As melhorias de imagens, cores, cards, navegação e apresentação passaram para os componentes comuns. Nexus, Aura e Pulse mantêm suas identidades; Catálogo, Institucional e Vitrine editorial também recebem os recursos. A apresentação Fashion / Kids da Bambilu continua com sua identidade, usando os mesmos componentes de cor e carrinho.

## Entrega

- Fotos clicáveis de cores em cards, destaques, relacionados e detalhe, com expansão `+N`, nomes acessíveis e identificação por texto quando não existe foto vinculada.
- Galeria com fotos inteiras, miniaturas, setas, swipe, teclado e derivações leves do storage.
- Cards mais limpos; condições por quantidade acessíveis em uma expansão. Preços, SKU, disponibilidade e fichas específicas de imóveis/veículos continuam respeitando os dados e controles existentes.
- Grid alinhado, incluindo o primeiro card Nexus, sem a ampliação automática que o fazia ocupar duas colunas. Aura mantém sua linguagem editorial com cards alinhados; Pulse mantém formas arredondadas e cores expressivas.
- Busca por ícone em desktop e mobile, inclusive na prévia isolada do editor. Carrinho no header quando o backend habilita o recurso, usando o mesmo drawer e operações existentes.
- Ajustes para nomes longos de marca, espaçamento no detalhe, leitura dos preços e rodapé sem colunas vazias.
- Hero que usa uma foto disponível do catálogo quando não existe campanha própria; fotos de produto ficam contidas, ao lado do texto. Imagens e links escolhidos no editor continuam sendo respeitados.
- Novos sites começam com hero, categorias, catálogo, editorial editável e contato. Categorias vazias não geram uma seção artificial; o editorial pode usar uma foto real do catálogo. Não foram inventadas promessas de frete, pagamento, trocas ou rankings de vendas.
- Novos padrões têm duas colunas no mobile. Configurações já salvas, inclusive uma coluna, continuam preservadas.
- Prévia do editor com as mesmas fontes do site; seis miniaturas de apresentação Nexus/Aura/Pulse regeneradas a partir dos renderizadores reais.

## Compatibilidade

O formato das configurações continua na versão 1. O registro recebeu `presentationVersion: 2` para identificar a revisão visual e renovar o cache das miniaturas. O registro canônico do backend e a cópia gerada para o frontend permanecem iguais.

Sites existentes recebem os componentes comuns sem regravar conteúdo, seções, produtos, variações, preços, estoque ou configurações comerciais. Seções desabilitadas ou removidas não são recriadas. As composições iniciais novas se aplicam à criação de sites, mantendo os rascunhos e publicações já existentes.

## Validação

- 276 testes frontend em 40 arquivos e typecheck aprovados.
- Build backend e 66 testes de Site, personalização, produto, templates e comércio aprovados.
- Verificações de arquitetura e sincronização do registro aprovadas.
- 11 testes de mídia/interação aprovados, incluindo os seis modelos, a Bambilu, galerias extensas e nomes longos de marca.
- Quatro testes comerciais aprovados: CRUD de regras, carrinho/faixas, checkout/pedido e informação comercial nos seis modelos.
- Nove testes do editor e das demonstrações aprovados em desktop/mobile; uma repetição da matriz pública em mobile foi ignorada porque a própria matriz já percorre os oito breakpoints.
- Catálogo e detalhe dos seis modelos em seis larguras: 72 combinações. Capturas antes/depois em 390, 768 e 1440 px.
- Galeria do editor, fontes da prévia, publicação e retorno entre modelos, preservação do catálogo/SEO e busca na prévia com Enter e clique conferidos.

Durante a validação foram corrigidos a troca de foto causada apenas pela expansão do `+N`, o botão de carrinho fora da área visível com uma marca longa e a busca por Enter dentro do iframe sem permissões de envio de formulários. Os diretórios de artefatos dos testes paralelos foram separados para evitar conflito entre as rodadas.

[Comparativo antes/depois](qa/template-parity-20261105/comparativo.html) · [Capturas das demonstrações](qa/template-parity-20261105/README.md).
