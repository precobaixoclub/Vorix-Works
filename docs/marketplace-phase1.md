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

## Operação e limites

Configurar ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI (HTTPS exata, callback /v1/marketplaces/mercado-livre/callback), além do SecretManager de produção e JWT_SECRET. Não reutilizar credenciais Mercado Pago. Configurar notificações na aplicação do DevCenter em /v1/marketplaces/mercado-livre/notifications. Worker próprio descrito ao final da implementação.

Não há conta de QA explicitamente autorizada: validação real BLOCKED. Testes locais usam contratos simulados; não demonstram aprovação da aplicação, elegibilidade da conta/categoria ou publicação real.
