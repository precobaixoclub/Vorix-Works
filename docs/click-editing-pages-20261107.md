# Seleção pela prévia e páginas em painéis — 07/11/2026

A prévia do editor permite clicar em uma área para abrir as configurações correspondentes. Textos, imagens, blocos, itens, fotos de galeria, links de menu/rodapé e produtos são identificados; o editor abre o painel apropriado, expande o item necessário e destaca o campo. Nas páginas internas, a seleção mantém o contexto da página correta, inclusive após alterar seu endereço.

**Editar por clique** é o modo inicial. A instrução orienta a rolar o site e clicar nas áreas; o contorno e a indicação “Editar” aparecem ao passar o ponteiro. A indicação mantém tamanho legível quando a prévia está reduzida. **Testar navegação** permite usar links, menus e botões normalmente. Na prévia curta do celular, menus abertos podem ser rolados dentro da área disponível. A visualização ampliada continua disponível para navegação.

O trecho “Nosso olhar” da Bambilu pode vir do conteúdo padrão do modelo, sem bloco cadastrado. Clicar nele abre um formulário com os valores exibidos. Apenas selecionar não altera o rascunho: o bloco passa a ser configurado quando um campo muda. Sua renderização é única e o controle de visibilidade passa a ser respeitado.

As páginas são listadas em painéis com nome, endereço e indicação de inclusão na próxima publicação. Cada painel pode ser expandido ou recolhido. O botão azul **Criar nova página** abre a nova página e seleciona seu título para edição. O estado vazio orienta por onde começar. Recolher mantém os dados digitados; excluir continua exigindo confirmação. Limites, orientações de imagem/texto, permissões e publicação manual permanecem aplicáveis.

Selecionar uma área e alternar modos são ações locais do editor. Não salvam nem publicam dados. Produtos continuam vindo do catálogo; clicar em um produto abre sua área no catálogo do editor.

## Validação

- TypeScript aprovado.
- 22 cenários de regressão em computador e celular, incluindo seleção nos seis modelos, alvos específicos, galeria, links, navegação em outra página, alteração de endereço, criação/recolhimento/exclusão de páginas, salvamento/publicação com dados fictícios, edição ao vivo, histórico, formatação, busca e zoom. O caso de imagem de fundo no celular foi repetido com um clique real corrigido pela escala do iframe, pois a imagem fica atrás da camada de composição.
- Dois cenários da Bambilu aprovados com API e conta fictícias: seleção do trecho padrão e preservação das orientações/ajuste do banner.
- Quatro cenários públicos da Bambilu aprovados: banner, composição, fotos, variações, ofertas, busca, menu e gestos.
- As verificações de seleção confirmam que a revisão salva e o conteúdo publicado não são alterados sem salvar/publicar.

Evidências locais em [qa/click-editing-pages-20261107](qa/click-editing-pages-20261107): [seleção de área na Bambilu](qa/click-editing-pages-20261107/local-bambilu.png), [edição de página](qa/click-editing-pages-20261107/local-pages-desktop.png) e [celular](qa/click-editing-pages-20261107/local-selection-mobile.png).

## Publicação

Registro da publicação e das verificações finais será acrescentado após o deploy.
