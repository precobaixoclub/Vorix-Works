# Operações em massa do catálogo

Branch: `feat/catalog-bulk-operations`. Base: `5a3a7fe`. Desenvolvimento em worktree própria; sem merge, deploy ou alteração de arquivos da implementação paralela de Commerce.

## Auditoria anterior à implementação

- Catálogo central: `Product` em `domain/crm/crm.model.ts`, persistido em `products`. SKU é `code`; preços são centavos, com `minimumPriceCents` e `costCents` opcionais.
- `ProductVariant` e `SalesCatalogRepositoryPort` já oferecem códigos, opções, preços próprios/herdados e saldos por combinação. Não foi criada outra entidade de produto.
- `ProductDetails` contém GENERAL, APPAREL, VEHICLE e REAL_ESTATE. Serviço é `itemType=service`, não um novo valor de ProductDetails.type. Fichas específicas passam pelo schema atual.
- Categorias, subcategorias (`parentId`), marcas e especificações usam `ProductEngineRepositoryPort`. Os atributos exigidos por categorias ancestrais continuam obrigatórios.
- `assertProductPricing`, `createProduct`, `updateProduct`, `createVariant`, `updateVariant` e as validações de extensão foram reutilizados. Margem negativa é permitida pelo catálogo atual e gera aviso; mínimo acima da tabela é erro.
- O Inventory existente aceita ADJUSTMENT absoluto, valida reservas, mantém histórico e deduplica por `operationKey`. Nenhum saldo é sobrescrito diretamente pela importação.
- RBAC usa `requirePermission`, `hasPermission`, `AccessResolver` e `resolveVisibility`, incluindo concessões/revogações individuais e visibilidade comercial de custo.
- EAN/GTIN, dimensões e identificadores externos não tinham campos dedicados no modelo. São preservados no JSON extensível existente `Product.taxMetadata.catalog`, sem segunda tabela de catálogo. Não representam integração com marketplaces.
- As filas existentes atendem reuniões, mensagens e publicações; seus contratos não são uma fila genérica de catálogo. É necessária persistência própria de jobs e checkpoints, em vez de reutilizar indevidamente uma fila de outro domínio.

## Fluxo e API

Todas as rotas ficam em `/v1/catalog-bulk` e exigem `workspaceId` na query. Tenant e usuário vêm da autenticação. O workspace é validado antes de qualquer leitura/gravação; o arquivo e o relatório são privados ao usuário que iniciou o job.

1. `POST /imports`, multipart com um CSV UTF-8 ou XLSX e header `idempotency-key`. Retorna cabeçalhos, sugestão de mapeamento e amostra limitada a três linhas, sem gravar produtos.
2. `POST /imports/:id/preview`: `{mapping, options:{mode,createTaxonomy}}`. `mode`: `create`, `upsert` ou `update`. Colunas podem ser ignoradas. Cada campo pode receber uma única coluna. Criação de taxonomia é desativada por padrão.
3. O worker valida em lotes de 25 grupos; `GET /imports/:id` mostra o progresso e os totais. `GET /imports/:id/rows?offset=0&limit=25` retorna no máximo 100 grupos.
4. `POST /imports/:id/confirm` exige preview pronto. Somente os grupos válidos são importados; erros e ignorados são mantidos no relatório. Nenhuma requisição de upload/mapa dispara escrita de produtos.
5. `GET /imports/:id/errors` baixa CSV com linha física, campo, valor, mensagem e severidade. O usuário pode enviar uma planilha corrigida ou refazer o preview antes da confirmação.
6. `GET /template?format=csv|xlsx` e `GET /export?format=csv|xlsx`. Filtros: busca, categoria/subcategoria, marca, tipo, ativo, site e estoque. A listagem paginada usa o mesmo construtor de filtros.
7. `POST /edit` recebe `{ids,field,value,operationKey}` para até 500 produtos, e cria um job de atualização que exige preview e confirmação. Ativo, site, categoria, marca, modo comercial, preço e estoque usam as mesmas regras do importador.

Estados persistidos: MAPPING, PENDING_PREVIEW, PREVIEW, PENDING, PROCESSING, COMPLETED, COMPLETED_WITH_ERRORS e FAILED. A interface traduz os estados e permite retomar o último job da sessão depois de fechar/reabrir o diálogo.

## Identificação e regras de planilha

- Correspondência exata por SKU, depois EAN. O ID exportado é validado contra SKU/EAN e escopo. Nunca há correspondência por nome. Identificadores divergentes/ambíguos são erros que exigem correção pelo usuário.
- EAN ou SKU de variante repetido entre produtos diferentes do mesmo arquivo invalida os grupos envolvidos. SKU pai repetido é válido somente para linhas de variantes distintas. Campos compartilhados do pai precisam ser consistentes.
- Para variantes, repetir SKU/ID do pai e informar `Cor`, `Tamanho` ou `Opções variante (JSON)`. Há colunas próprias para SKU, preço, custo, mínimo, ativo e herança da variante. Definições de opções preservam chaves, nomes e limites existentes (4 opções / 500 combinações).
- Valores monetários são reais decimais (`49,90` ou `49.90`), convertidos em centavos; quantidades têm até três casas. Fórmulas XLSX são rejeitadas: converter em valores antes do upload. SKU/EAN devem ser células de texto para preservar zeros à esquerda.
- Coluna ausente e célula vazia preservam o cadastro. `[LIMPAR]` remove descrição, unidade, categoria, marca, custo, mínimo ou identificador opcional. Campos obrigatórios não aceitam esse marcador. JSON vazio `[]` limpa a galeria; especificações JSON são mescladas com as existentes para preservar campos ausentes.
- Imóveis e serviços rejeitam estoque tradicional; imóveis, veículos e serviços rejeitam combinações. Veículos seguem o estoque unitário permitido pelo catálogo atual. Produtos com opções exigem saldo por variante; a edição escalar de estoque não altera saldos agregados.
- As fotos precisam pertencer ao storage do workspace e passam pelo mesmo normalizador da API atual.
- Exportações incluem variantes inativas, definições de opções, fichas específicas e identificadores para exportar → editar → reimportar. Custo de pai/variante é omitido sem permissão; estoque é omitido sem inventory:read. Preços mínimos só recebem mapeamento/escrita de gestores.

## Transações, concorrência e limites

`0182_catalog_bulk_operations.sql` cria apenas `catalog_bulk_jobs` e `catalog_bulk_items`, índices e FKs de escopo. O repositório principal tinha Commerce `0181_commerce_orders_checkout.sql` em andamento; não foi copiado nem alterado. Nenhuma migration anterior foi editada.

O worker é um loop em background da API, iniciado em onReady e drenado em preClose. Não depende de uma aba aberta. Usa locks de job (`FOR UPDATE SKIP LOCKED`) e advisory lock por workspace para coordenar réplicas. Reiniciar a API retoma os checkpoints persistidos. O usuário e suas permissões atuais são revalidados em cada lote.

Produto, variantes, taxonomia autorizada, movimentos de estoque e checkpoint do grupo participam da mesma transação. Transações dos repositórios existentes viram savepoints no cliente transacional; falhar o estoque desfaz o grupo inteiro. A chave única do upload bloqueia retry com conteúdo diferente. Duplo confirm e workers repetidos não reexecutam checkpoints concluídos.

A origem do estoque é `BULK_IMPORT:<job>:<linha>` em `product_stock_movements.operation_key`. `reason=manual` é preservado porque o domínio existente possui uma constraint fechada de motivos. O usuário e o saldo posterior continuam registrados pelo Inventory.

Snapshots e planos confirmados são comparados antes da gravação. Alterações concorrentes de produto, variantes ou resolução da taxonomia geram erro por grupo e exigem novo preview. O catálogo legado permite SKUs duplicados; eles não são limpos nem recebem uma nova constraint global nesta entrega. Os jobs são serializados entre si; a criação manual paralela continua sujeita às regras existentes do catálogo.

Limites explícitos: 20 MB de upload, 50 mil linhas, 80 colunas, 16 mil caracteres por célula e 100 MB descompactados no XLSX. Exportações acima de 50 mil linhas exigem filtros, sem truncamento silencioso. Leitura/serialização do arquivo é limitada por esses tetos; validação e escrita são feitas em background. O arquivo exportado é gerado no servidor e transferido como arquivo, sem carregar registros no estado React.

O catálogo envia até 50 produtos por página; o preview, até 25 grupos por página. Os downloads usam o cliente autenticado existente e renovam o token quando necessário.

## Validação reproduzível

- `npm test` / `node scripts/test-backend.mjs`: suíte backend completa.
- `node --test tests/catalog-bulk.test.mjs`: integração com PGlite/Postgres real e arquivos XLSX reais. Abrange parsing, modos, preços, EAN/SKU, variantes, Inventory, rollback, RBAC, tenant, repetição, reinício, stale preview, exportação/reimportação, CSV de 50 mil linhas e catálogo de 10 mil produtos.
- `npm --prefix web test`, typecheck e build em ambos os pacotes.
- `npm run architecture:check`.
- QA local: iniciar `node tests/fixtures/product-site-browser-server.mjs`; em `web`, executar `npx playwright test --config playwright.catalog-bulk.config.ts`. Banco efêmero e contas `.invalid`; quatro viewports (390, 768, 1024, 1440). Evidências locais em `tmp/catalog-bulk-evidence`.

Nenhum domínio Order, Checkout, PaymentProvider, ShippingProvider, Payment ou Shipment foi alterado. A integração futura de marketplaces permanece fora do escopo.

Resultados e evidências dos quatro tamanhos de tela: [QA de catálogo em massa](../qa/catalog-bulk-operations/README.md).
