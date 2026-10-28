# Marketplaces — homologação real e credenciais

Revisão feita contra a documentação oficial em 2026-10-28:
- Mercado Livre: developers.mercadolivre.com.br/pt_br.
- Shopee Open Platform v2: open.shopee.com.
- TikTok Shop Partner Center: partner.tiktokshop.com/docv2.

Os mocks de `tests/marketplace-*.test.mjs` seguem esses contratos.

Domínio da API em produção: `https://api.vorixworks.com`.

## Variáveis de ambiente (API e `marketplaces-worker`)

Sem as variáveis de um canal, ele não aparece e o worker fica ocioso. Mesmo com credenciais, todos começam em BETA e só tenants explicitamente habilitados podem conectar. Estados/variáveis e recuperação: [runbook vigente](operations/production-readiness.md).

| Canal | Variáveis | Valor |
|---|---|---|
| Mercado Livre | `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT_URI` | Redirect: `https://api.vorixworks.com/v1/marketplaces/mercado-livre/callback` |
| Shopee | `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_REDIRECT_URI`, `SHOPEE_API_BASE_URL` (opcional; sandbox `https://openplatform.sandbox.test-stable.shopee.sg`) | Redirect: `https://api.vorixworks.com/v1/marketplaces/shopee/callback` |
| TikTok Shop | `TIKTOK_SHOP_APP_KEY`, `TIKTOK_SHOP_APP_SECRET`, `TIKTOK_SHOP_SERVICE_ID`, `TIKTOK_SHOP_API_BASE_URL` (opcional, só host oficial) | Redirect cadastrado no app: `https://api.vorixworks.com/v1/marketplaces/tiktok-shop/callback` |

## Configuração no painel de cada canal

### Mercado Livre (DevCenter)

O app é próprio do Mercado Livre, separado das credenciais do Mercado Pago.

- **PKCE:** ligado. O Vorix sempre envia S256; com o PKCE ligado no app, ele passa a ser obrigatório.
- **Escopos:** read, write e offline_access.
- **URL de notificações:** `https://api.vorixworks.com/v1/marketplaces/mercado-livre/notifications`.
- **Tópicos:** `orders_v2`, `shipments`, `items`, `items_prices`, `user_products`, `stock-location` e Post Purchase (`claims`, `claims_actions`).
- **Notificações:** o canal exige HTTP 200 em até 500 ms e faz 8 tentativas em 1 h. Não há assinatura: o Vorix confere `application_id` + `user_id` e relê o recurso na API.

### Shopee (Open Platform Console)

- **Live Redirect URL Domain:** `api.vorixworks.com`.
- **IP whitelist:** declarar o IP do servidor. Sem isso, as chamadas falham com `source_ip_undeclared`.
- **Push URL:** `https://api.vorixworks.com/v1/marketplaces/shopee/notifications`, exatamente igual, porque entra na assinatura.
- **Push habilitados:** 3 (order_status_push) e 4 (order_trackingno_push).
- **Assinatura:** `Authorization = HMAC-SHA256(partner_key, url|corpo)`. A rota responde 204 sem corpo.

### TikTok Shop (Partner Center)

- **App:** do tipo ISV / eCommerce Management (Multi-Channel); os vendedores autorizam pelo link de autorização.
- **Escopos:** produtos, pedidos, fulfillment/logística, return_refund e authorization (shops).
- **Webhook:** `https://api.vorixworks.com/v1/marketplaces/tiktok-shop/notifications`, com os eventos 1 (status do pedido), 3, 4, 5, 11 e 12.
- **Assinatura:** `Authorization = HMAC-SHA256(app_secret, app_key + corpo)`.

## Contas para homologação

É preciso ter uma conta de vendedor de teste autorizada por escrito para cada canal:
- **Mercado Livre:** usuário de teste criado via `/users/test_user`.
- **Shopee:** loja sandbox.
- **TikTok Shop:** loja de teste BR.

Nenhuma conta comercial real deve ser usada sem autorização.

Roteiro seguro:
1. Conectar.
2. Importar.
3. Vincular ou criar.
4. Publicar o produto de teste.
5. Alterar preço.
6. Alterar estoque.
7. Reconciliar.
8. Pedido de teste.
9. Envio, rastreio e etiqueta.
10. Cancelar ou devolver, quando o canal permitir.

## Estoque de fulfillment (Full / FBS / FBT)

- **Mercado Livre Full** (`logistic_type=fulfillment`, `inventory_id`, `meli_facility`):
  - O estoque é do Mercado Livre e só cresce com envio físico ao armazém.
  - O Vorix não publica quantidade nesses anúncios: a escrita é bloqueada.
  - As vendas não baixam o estoque central (`stockState=EXTERNAL`) e não têm etiqueta do vendedor.
- **Shopee FBS** (`is_fulfillment_by_shopee`, `shopee_stock`, `fulfillment_flag=fulfilled_by_shopee`):
  - `shopee_stock` é só leitura; o Vorix escreve apenas `seller_stock` de um único local.
  - Pedidos FBS não baixam o estoque central e não podem ser cancelados nem gerar etiqueta pelo vendedor.
- **TikTok FBT** (`fulfillment_type=FULFILLMENT_BY_TIKTOK`):
  - Mesmo tratamento: sem etiqueta e sem baixa central.
  - Não há confirmação oficial de que exista no Brasil.
  - A atualização de estoque exige exatamente um depósito de vendas habilitado.

## Capacidades confirmadas

| | Mercado Livre | Shopee | TikTok Shop |
|---|---|---|---|
| Pausar anúncio | sim | sim (`unlist_item`, reversível) | sim (deactivate) |
| Encerrar anúncio | sim, finaliza (`closed`) | **exclusão definitiva** (`delete_item`): botão "Excluir anúncio" + digitar EXCLUIR + `marketplace:manage` + auditoria `LISTING_DELETED` | não exposto (fazer no Seller Center) |
| Cancelar pedido pela API | **não existe API pública** | sim; motivos `OUT_OF_STOCK` e `CUSTOMER_REQUEST` | sim; o motivo vem de `aftersale_eligibility` (lista viva do canal) |
| Etiqueta | sim (`me2`, não Full) | sim (shipping document) | sim (`shipping_type=TIKTOK`, sem NF pendente) |
| Devoluções | claims/returns v2 | `get_return_list` + `get_return_detail` | returns 202602 |

Ponto aberto para a homologação real no TikTok: o upload de NF exigido no Brasil não está implementado. Enquanto a NF estiver pendente, a etiqueta fica indisponível.
