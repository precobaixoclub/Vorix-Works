# Revisão global de imagens, galeria e variações — 04/11/2026

Implementação local, sem deploy. As capturas usam produtos e imagens de teste, servidos exclusivamente em `127.0.0.1`. Não representam alterações nos dados da loja Bamilu.

## Auditoria e centralização

O catálogo de `TenantSiteView.tsx` atendia Catálogo, Institucional e Vitrine editorial. Nexus, Aura e Pulse tinham três cards em `PremiumTemplates.tsx`. Home, busca, categorias e seleções manuais reutilizam esses caminhos. `ProductDetail` já era compartilhado por todos. Não havia `ProductCard` ou `ProductGallery` compartilhados para os produtos das lojas.

Os dois conjuntos de estilos aplicavam `object-fit: cover` aos produtos e ampliavam a foto no hover. O detalhe combinava `variantPhoto || photo`, deixando a imagem da variante prevalecer sobre a miniatura clicada.

Agora:

- `web/features/sites/product-media.ts`: resolve fotos, vínculos e fallback, sem modificar o produto.
- `web/components/sites/ProductGallery.tsx`: imagem inteira com `contain`, proporção estável, setas, contador, teclado, swipe, miniaturas e carregamento sob demanda.
- `web/components/sites/ProductCard.tsx`: estrutura sem botões dentro de links, preview de cores e resumo das outras opções. O estado é exclusivo do card.
- `web/components/sites/product-media-styles.ts`: regras comuns de apresentação, foco, alvos de toque de 44 px e interação.
- `TenantSiteView.tsx` e `PremiumTemplates.tsx`: integram esses componentes em todos os cards e no detalhe. Os modelos clássicos também passam a oferecer produtos relacionados.
- Estilos de carrinho e checkout preservam as fotos com `contain`. Banners que exibem o produto destacado também preservam sua imagem. A arte promocional própria do banner mantém a configuração do editor.

A composição e a proporção configurada dos cards são preservadas; a galeria de detalhe usa aproximadamente 4:5, com os ajustes visuais do template. A imagem é centralizada sem ampliação para preencher o quadro.

## Fotos e variações

São usados os vínculos já existentes: `options[].images[value]` e `variants[].imageUrl`. Não foi criada estrutura de persistência ou alterada a API.

Sem seleção, a galeria reúne fotos do produto, mídia, opções e combinações, removendo duplicatas. Ao escolher uma variante, a ordem é:

1. Foto da combinação exata, quando todas as opções estão selecionadas.
2. Foto da opção selecionada, priorizando cor.
3. Outras fotos de combinações compatíveis com a seleção.
4. Fotos gerais, que não estão vinculadas a uma opção ou combinação.

Sem foto específica, a imagem principal é o fallback, seguida das fotos gerais. Fotos de outras cores deixam de ser priorizadas. Setas e miniaturas continuam funcionando depois da escolha de variante; a seleção comercial permanece independente da foto aberta.

No card, hover com mouse, foco ou toque em uma cor atualiza apenas o preview. São exibidas até cinco cores, o excedente `+N` e a quantidade disponível. As outras opções mostram até quatro valores e o excedente. Não há alteração de preço, estoque, carrinho ou seleção comercial. Produtos com uma única foto não recebem controles; produtos sem opções não recebem uma área vazia.

## Performance

Cada card renderiza somente a foto atual, com carregamento lazy e decodificação assíncrona. Depois de interagir, apenas a próxima foto é antecipada. As miniaturas recebem `src` quando se aproximam de sua própria faixa de rolagem, usando `IntersectionObserver`.

As imagens do storage do Vorix reutilizam os derivados WebP em cache: miniaturas de 160 px e cards com fontes responsivas de 480/960 px. A galeria principal preserva a imagem original. URLs externas sem suporte a esse mecanismo continuam sendo utilizadas diretamente, sem parâmetros inventados.

## Validação

Modelos: **Catálogo (`catalog`), Institucional (`studio`), Vitrine editorial (`showcase`), Nexus, Aura e Pulse**.

Larguras por modelo: **360, 390, 430, 768, 1024 e 1440 px**, em catálogo e detalhe: 72 combinações de superfície/largura. Também foram exercitados busca, categoria, home com produto destacado e relacionados.

Casos: nenhuma foto, uma foto, várias fotos, uma cor, sete cores, cor + tamanho, capacidade, foto por cor, foto de combinação, fotos gerais, imagem vertical, horizontal e quadrada. As verificações cobrem `contain`, ausência de zoom e overflow horizontal, setas sem navegação de página, preview sem mutações comerciais, swipe nativo via CDP, teclado, miniaturas e fallback. Um teste adicional utiliza contexto mobile com touch e uma galeria de 24 fotos.

Resultados: **265 testes de frontend, 57 testes de backend e 7 testes de navegador aprovados**. Typecheck de frontend/backend, builds de frontend/backend e `git diff --check` concluídos com sucesso.

Comandos executados:

```powershell
# Frontend: 37 arquivos, 265 testes
cd web
npm test -- --maxWorkers=2
npm run typecheck
npx playwright test -c playwright.product-media.config.ts
npm run build

# Backend: build e 57 testes relacionados
cd ..
npm run typecheck
npm run build
node --test tests/product-site-engine.test.mjs tests/site-customization.test.mjs tests/website-builder-templates.test.mjs tests/public-product-catalog.test.mjs tests/product-wizard-sync.test.mjs
git diff --check
```

Os JSONs nesta pasta registram as métricas por modelo. A suíte do navegador é reproduzível com o fixture local iniciado pela própria configuração Playwright.

## Capturas

| Modelo | Catálogo desktop | Catálogo mobile | Produto desktop | Produto mobile |
| --- | --- | --- | --- | --- |
| Catálogo | [1440](catalog-catalog-1440.png) | [390](catalog-catalog-390.png) | [1440](catalog-detail-1440.png) | [390](catalog-detail-390.png) |
| Institucional | [1440](studio-catalog-1440.png) | [390](studio-catalog-390.png) | [1440](studio-detail-1440.png) | [390](studio-detail-390.png) |
| Vitrine editorial | [1440](showcase-catalog-1440.png) | [390](showcase-catalog-390.png) | [1440](showcase-detail-1440.png) | [390](showcase-detail-390.png) |
| Nexus | [1440](nexus-catalog-1440.png) | [390](nexus-catalog-390.png) | [1440](nexus-detail-1440.png) | [390](nexus-detail-390.png) |
| Aura | [1440](aura-catalog-1440.png) | [390](aura-catalog-390.png) | [1440](aura-detail-1440.png) | [390](aura-detail-390.png) |
| Pulse | [1440](pulse-catalog-1440.png) | [390](pulse-catalog-390.png) | [1440](pulse-detail-1440.png) | [390](pulse-detail-390.png) |
