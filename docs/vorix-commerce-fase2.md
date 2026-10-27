# Vorix Commerce — Fase 2: pedidos, checkout, pagamento e frete

Continua a [Fase 1](vorix-commerce-fase1.md) sem reescrevê-la. Fluxo novo:

```
Produto → Carrinho → Checkout (dados · entrega · pagamento) → Pedido → Reserva de estoque
        → Pagamento confirmado pelo provedor → Venda (baixa) → Confirmação → (opcional) CRM
```

## Onde está

| Camada | Arquivo |
|---|---|
| Domínio do pedido (estados, totais, CPF/CNPJ) | `src/domain/commerce/order.model.ts` |
| Frete (configuração, métodos próprios, regiões) | `src/domain/commerce/shipping.ts` |
| Portas `PaymentProvider`, `ShippingProvider`, repositório | `src/application/ports/commerce-ports.ts` |
| Checkout, pagamento, expiração, cancelamento, central | `src/application/commerce/checkout-use-cases.ts` |
| Pedido → Contato / oportunidade ganha (opcional) | `src/application/commercial-bridge/order-crm-use-cases.ts` |
| Providers | `src/infrastructure/commerce/payment-providers.ts`, `shipping-providers.ts` |
| Rotas | `src/interfaces/api/routes/v1/commerce.route.ts` |
| Migration | `db/migrations/0181_commerce_orders_checkout.sql` |
| Vitrine | `web/components/sites/storefront/Checkout.tsx` (checkout + página do pedido) |
| Lojista | `web/components/sites/SiteCheckoutSettings.tsx`, `web/app/workspaces/[workspaceId]/site/pedidos` |

## Pedido (Order)

Entidade própria (`commerce_orders`), nunca uma Opportunity. `source`: `SITE` (preparado: `MANUAL`,
`MERCADO_LIVRE`, `SHOPEE`, `TIKTOK_SHOP`). Itens com snapshot (nome, SKU, variação, imagem, preço,
especificações). Histórico estruturado em `commerce_order_events`.

Estados: `PENDING → AWAITING_PAYMENT → PAID → (CONFIRMED) → PROCESSING → SHIPPED → DELIVERED`;
retirada vai de `PROCESSING` direto para `DELIVERED`. `CANCELLED` a partir de qualquer estado antes
do envio. Transição inválida é recusada (`assertOrderTransition`); toda atualização é condicional ao
status atual (concorrência).

## Valores

Preço, frete e total são recalculados no servidor a cada cotação e na criação do pedido. O navegador
só escolhe o **id** da opção de entrega; payload com preço/total é recusado (schema estrito).

## Estoque

- Criar pedido → `RESERVATION` por item (tudo ou nada; esgotou no meio → devolve e cancela como `out_of_stock`).
- Pagamento confirmado → `SALE` com `consumeReservation` (baixa saldo e reservado **na mesma transação**).
- Expirou sem pagar (padrão 30 min, configurável) → `RELEASE`. Varredura a cada 60 s na API e na leitura do pedido.
- Cancelado depois de pago e antes do envio → `RETURN` (opcional) + estorno no provedor.
- Todas as movimentações têm chave idempotente `order:<id>:<etapa>:<item>`.
- Oportunidade ganha criada a partir de pedido **não** baixa de novo (`settledSale` na aplicação e
  `custom_fields.commerceOrderId` no trigger de variações da 0164).

## Pagamento (`PaymentProvider`)

Credenciais do **lojista** no cofre de segredos (`commerce/<tenant>/<site>/mercado_pago`); o token nunca volta para a tela.

- `MERCADO_PAGO`: PIX (QR, copia e cola, expiração = prazo da reserva) e cartão tokenizado pelo
  Card Payment Brick (o número do cartão não passa pelo Vorix). Webhook
  `POST /v1/webhooks/commerce/mercado-pago/:siteId` só avisa; o status é **relido na API do Mercado
  Pago**. Também relido ao abrir a página do pedido e antes de expirar.
- `SANDBOX` (modo de teste): só com `COMMERCE_SANDBOX_PAYMENTS_ENABLED=true`. Nunca cobra; o lojista
  simula aprovação/recusa na Central de pedidos, pelo mesmo caminho de um webhook.
- Idempotência: `commerce_webhook_events(provider, event_key)` + transições condicionais. Pago depois
  de expirar → estorno automático.

Os providers de cobrança da assinatura do Vorix (`src/infrastructure/billing`) **não** são usados:
eles recebem para o Vorix, não para o lojista.

## Frete (`ShippingProvider`)

Próprios: retirada no local, frete grátis (com mínimo), valor fixo, tabela por faixa de CEP, regiões
atendidas e prazo de preparação. Externo: Melhor Envio (`/api/v2/me/shipment/calculate`, token do
lojista), só quando todos os itens têm peso e medidas — nunca inventa valor. Peso/medidas no produto
(`details.shipping`); variação pode sobrescrever (`product_variants.weight_grams/height_cm/width_cm/length_cm`).

## "Comprar agora"

Só aparece quando o produto está ativo, visível, com preço > 0, saldo (se controla estoque), modo
`ONLINE_CHECKOUT` (do site ou do produto) **e** a loja está pronta (`checkoutReadiness`: forma de
receber + credencial + forma de entrega). Veículo, imóvel e serviço nunca são forçados ao checkout.
No híbrido, o carrinho separa itens de compra online e itens sob consulta (WhatsApp).

## CRM

Pedido cria/atualiza o Contato (reaproveita por e-mail/telefone). Opção do site:
`CONTACT_ONLY` (padrão) ou `CONTACT_AND_WON_OPPORTUNITY`.

## Permissões

`order:read` (todos os perfis), `order:manage` (Atendente, Gerente, Administrador),
`commerce:manage` (gateway, frete, como vender — Gerente/Administrador). Nova categoria "Site, produtos e
loja" na tela de permissões.

## Catálogo público paginado

`publicSite` carrega a 1ª página (24), os produtos citados nas seções e o produto/categoria da URL;
o resto vem de `GET /v1/public/sites/:slug/products` (busca, categoria, marca, ordem, "mostrar mais").
Sitemap usa a lista leve de slugs (`?sitemap=1`). Filtros especiais (veículo/imóvel) seguem no navegador
sobre o que já foi carregado.

## Eventos

`CHECKOUT_STARTED`, `SHIPPING_QUOTED`, `ORDER_CREATED`, `PAYMENT_STARTED`, `PAYMENT_APPROVED`,
`ORDER_PAID`, `ORDER_CANCELLED`, `ORDER_COMPLETED` em `site_events` (com `order_id`, sessão, UTM, contato).

## Fora desta fase

Mercado Livre, Shopee, TikTok Shop, sincronização externa de estoque, afiliados, cupom de desconto
(campo existe, sem UI), devolução após envio, emissão de etiqueta.
