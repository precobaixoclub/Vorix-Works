# Mercado Livre — fase 1

Branch isolada `feat/mercado-livre-phase1`, base `5d3c613`. Sem merge ou deploy. Migrations 0182/0183 reservadas para integração concorrente; a nova 0184 precisa ser conferida após rebase.

## Auditoria

- Product/ProductVariant: catálogo CRM/Sales existente; criação pelos casos de uso centrais e validação de opções/categoria/atributos. GTIN compatível em `taxMetadata.catalog.ean`; dados exclusivos do canal ficam no listing.
- Inventory: `stock_quantity - reserved_quantity`, com reservas transacionais do Commerce 0181. Importação usa `ProductEngineRepository.move`, origem na chave `MARKETPLACE_IMPORT`, nunca grava saldo diretamente.
- Categories/Brands/Specifications: metadata existente do ProductEngine. Mapeamentos externos separados.
- Site: outra representação do mesmo catálogo; não há catálogo marketplace paralelo.
- RBAC: permissões efetivas existentes, estendidas com marketplace:read/manage; workspace validado pelo guard existente.
- Jobs: fila durável Postgres com claim/lease, checkpoints e tentativas; sem chamadas externas em transações comerciais. Triggers apenas enfileiram sinal de mudança de preço/saldo/reservas.
- Segredos: SecretManager existente (Postgres AES-256-GCM em produção), referências por tenant/workspace/conexão. Nunca retornar tokens/erros brutos do provider.
- Notifications: dicas não confiáveis; identidade confirmada por leitura autenticada canônica, aplicação e conta conhecidas, paths restritos. Sem assinatura HMAC inventada.
- Order/Checkout/Payment/Shipping/Analytics/Catalog Bulk: fora do escopo e sem alterações.

## Documentação oficial consultada em 27/10/2026

- [OAuth](https://developers.mercadolivre.com.br/autenticacao-e-autorizacao): PKCE S256, state de uso único, refresh token rotativo; app Mercado Livre separada de Mercado Pago.
- [User Products](https://developers.mercadolivre.com.br/pt_br/user-products) e [preço por variação](https://developers.mercadolivre.com.br/pt_br/preco-variacao): coexistência legacy/UP; UP usa family_name sem title/variations.
- [Busca](https://developers.mercadolivre.com.br/pt_br/servicos-gerenciamento-de-contatos/itens-e-buscas): scan paginado; endpoints bulk antigos descontinuados em 25/10/2026. A integração lê itens individualmente.
- [Preços](https://developers.mercadolivre.com.br/pt_br/referencias-de-dominios-produtos-e-atributos-para-autopecas/api-de-precos): preço canônico via /items/{id}/prices; escrita permanece PUT /items conforme documento atualizado 14/10/2026. Promoções/automação não são sobrescritas automaticamente.
- [Estoque distribuído](https://developers.mercadolivre.com.br/pt_br/referencias-de-dominios-produtos-e-atributos-para-autopecas/estoque-distribuido): sem multi-origem usa PUT /items; Full é gerenciado pelo Mercado Livre. Multi-origem/Full exigem configuração específica e ficam bloqueados nesta fase.
- [Notificações](https://developers.mercadolivre.com.br/produto-receba-notificacoes): items, items_prices, user_products, stock-location. Eventos de pedidos ignorados.
- [Publicação](https://developers.mercadolivre.com.br/pt_br/publicacao-de-produtos): categorias/atributos e validação oficial antes de POST /items.
- [Descrição](https://developers.mercadolivre.com.br/pt_br/descricao-de-produtos): criação por POST após obter o ID; alteração por PUT com api_version=2. Releitura antes de repetir evita duplicação após timeout.

## Operação e limites

Configurar ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI (HTTPS exata, callback /v1/marketplaces/mercado-livre/callback), além do SecretManager de produção e JWT_SECRET. Não reutilizar credenciais Mercado Pago. Configurar notificações na aplicação do DevCenter em /v1/marketplaces/mercado-livre/notifications. Worker próprio descrito ao final da implementação.

Não há conta de QA explicitamente autorizada: validação real BLOCKED. Testes locais usam contratos simulados; não demonstram aprovação da aplicação, elegibilidade da conta/categoria ou publicação real.

## Configuração para a integração posterior

1. Rebasear somente após a integração concorrente; conferir 0184 livre e checksum das migrations já aplicadas. Nenhuma migration de produção foi executada nesta tarefa.
2. Aplicar a migration no ambiente de destino pelo procedimento normal do projeto.
3. API: SECRET_MANAGER_PROVIDER=production, JWT_SECRET estável e forte, ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI. Tokens de cada conta ficam em operational_secrets via SecretManager; não são enviados ao navegador.
4. Aplicação própria do Mercado Livre com permissões read/write/offline_access e callback HTTPS exato, PKCE S256 habilitado no DevCenter. Aprovação e elegibilidade externas continuam dependendo do Mercado Livre.
5. Executar o worker separado com DATABASE_URL, JWT_SECRET e as mesmas variáveis ML: npm.cmd run marketplaces:worker (desenvolvimento) ou node dist/interfaces/worker/marketplaces-worker.js (artefato compilado).
6. Assinar items, items_prices, user_products e stock-location na aplicação. Não há assinatura de Mercado Pago aplicada artificialmente a estas notificações. Pedidos são ignorados.

O worker consome outbox e jobs com leases. Uma conexão processa um job de cada vez; conexões distintas podem ser processadas por instâncias diferentes. O provider espaça chamadas e o job respeita 429/Retry-After com backoff e jitter. Reconciliação ocorre em janelas de 15 minutos enquanto o worker estiver ativo.

## Fluxos e proteções

- Prévia usa paginação scan e consulta autenticada de cada item, preço canônico em /prices, descrição separada e localização de estoque dos User Products. Não altera catálogo nem saldo.
- Matching exato por SKU, depois EAN; ambiguidade requer seleção. Variações são relacionadas individualmente. EAN de variantes importadas fica no metadata compatível do catálogo; não se cria um catálogo externo.
- Criar/vincular/saldo inicial/checkpoint/auditoria formam uma transação local. A movimentação oficial recebe chave MARKETPLACE_IMPORT. Retry não duplica produto, listing ou movimento.
- Publicações novas usam um anúncio por produto simples ou variação selecionada. Para contas UP, envia family_name e atributos da variação, sem title/variations. Anúncios legacy com variações já existentes são importados, atualizados e sincronizados com validação de preço compartilhado.
- Requisitos de atributos e condições de venda são consultados na categoria. A publicação exige validação local e /items/validate; edição não muda a categoria do anúncio. Modalidade de envio é apenas configuração do anúncio; não há cálculo/compra de frete, etiquetas ou rastreio.
- Preço padrão e estoque disponíveis seguem Vorix. Um desvio externo em relação à última sincronização bloqueia overwrite automático. Resolução explícita só vale para os valores externos revisados, incluindo quantidades por variação.
- O snapshot externo atual e a referência da última sincronização são separados. Reconciliar várias vezes não transforma um conflito em autorização de sobrescrita.
- Timeout/5xx durante POST de publicação mantém UNKNOWN_RESULT. A ação “Localizar publicação” percorre a conta e verifica correlação e vendedor, sem outro POST. Só um resultado exato recupera o vínculo; zero/múltiplos resultados exigem revisão. 429 de publicação é recusa definida e pode repetir com a mesma operação.
- Refresh token rotativo é protegido por lease entre processos. Se o processo morrer durante a rotação, exige nova autorização, evitando reutilizar um token possivelmente consumido.
- Permissões efetivas são rechecadas no callback e no worker. Criar produtos exige também product:manage; alterar saldo exige inventory:manage.

## Limites explícitos desta fase

- Publicação nova: produtos físicos GENERAL/APPAREL em BRL com controle de estoque. Serviços, imóveis e veículos exigem fluxos próprios e ficam bloqueados.
- Estoque Full, convivência Full/Flex ou seller_warehouse/multi-origem: leitura/importação do anúncio disponíveis; escrita e uso como saldo inicial bloqueados. Não se altera inventário gerenciado pelo Mercado Livre. A decisão usa localização canônica da API, sem inferir uma capacidade pelo título ou pelo nome da conta.
- Promoções e dynamic_standard_price são protegidos contra sobrescrita de preço. Migração de modelo/variações exige revisão do mapeamento.
- Fechamento exige confirmação e não oferece reativação de anúncio fechado; pausados podem ser reativados conforme resposta da API.
- Credenciais, conta QA autorizada, homologação e permissões reais não foram fornecidas. Nenhuma autorização, publicação ou alteração de anúncio real foi feita.
- Nada foi integrado em main ou enviado a produção. Pedidos/pagamentos/logística do Mercado Livre e os domínios em integração concorrente não foram modificados.
