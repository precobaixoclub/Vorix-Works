# Vorix Commerce — Fase 1: fundação comercial do Site

O Site deixa de ser "um catálogo com botão de WhatsApp" e vira uma entrada comercial do Vorix:

```
SITE → PRODUTO/CARRINHO → INTENÇÃO → WHATSAPP → CONTATO → ATENDIMENTO → OPORTUNIDADE (+ itens)
```

O catálogo continua sendo a fonte única. Nada aqui cria "produto do site" ou "produto do canal":
todos os canais usam o mesmo `Product` / variação / SKU.

## Arquitetura

```
 Visitante (vitrine pública)                         API (Fastify)                              Worker (vorix-worker)
 ─────────────────────────                           ─────────────                              ─────────────────────
 product.commerce (decidido no backend)
 [Falar no WhatsApp] ──► /api/tenant-site/commerce ──► POST /public/sites/:slug/whatsapp-intents ─► SalesIntent (OPEN)
 [Adicionar ao carrinho] ─────────────────────────────► PUT  /public/sites/:slug/cart/items        ─► SiteCart / SiteCartItem
 [Finalizar pelo WhatsApp] ───────────────────────────► POST /public/sites/:slug/cart/checkout     ─► SalesIntent CART_WHATSAPP
 /i/:ref (Next) ──► GET /public/sales-intents/:ref ──► registra clique, monta mensagem ──► 302 wa.me?text=…Ref: VX-XXXXXX
                                                                                                    │
 Cliente envia a mensagem no WhatsApp ── WuzAPI → RabbitMQ ─────────────────────────────────────────┤
                                                                                                    ▼
                                                     registerInboundMessage (dedupe por id do provedor)
                                                     → convertSalesIntentFromInbound (commercial-bridge)
                                                        claim OPEN→CONVERTING (só um vence)
                                                        equipe do Site → roleta da equipe (routeUnassignedConversationToTeam)
                                                        Contact (origin "site") ← ensureCrmContactForInboxContact
                                                        Opportunity (origin "site") + itens do snapshot ← createDeal/addDealItem
                                                        CONVERTED + ids; eventos da sessão ganham contactId; notificação
                                                     → applyInboundServiceRules (atendimento/triagem)
                                                     → grava attendanceId na intenção
```

Camadas: domínio em `src/domain/sites/site-commerce.ts`; casos de uso públicos em
`src/application/sites/site-commerce-use-cases.ts`; a ponte Site→Atendimento→CRM em
`src/application/commercial-bridge/site-lead-use-cases.ts` (inbox e crm não se importam — mesma regra
de `check-crm-isolation`); produto na conversa em `commercial-bridge/conversation-product-use-cases.ts`.

## SiteCommerceMode (por site)

| Modo | Para o visitante |
|---|---|
| `SHOWCASE` | Vitrine. CTA configurável ("Saiba mais", "Tenho interesse", "Solicitar orçamento") leva ao formulário. |
| `WHATSAPP` | "Falar no WhatsApp" por produto. |
| `WHATSAPP_CART` | Carrinho e "Finalizar pelo WhatsApp". |
| `ONLINE_CHECKOUT` | Reservado. **Nunca** vira botão de compra nesta fase: degrada para conversa. |
| `HYBRID` | Cada produto decide; sem escolha, serviço/veículo/imóvel → conversa, o resto → carrinho. |

Configuração em `site_commerce_settings` (vale na hora, sem publicar). **Site sem linha** preserva o
comportamento anterior: `WHATSAPP` quando há número, `SHOWCASE` quando não há.

Também configurável: equipe responsável (`teamId`, distribuição da própria equipe), criar oportunidade
no WhatsApp, regras do formulário (abrir atendimento, criar oportunidade), avisar a equipe e o que
fazer sem estoque (`ASK_AVAILABILITY` / `SHOW_UNAVAILABLE` / `HIDE_CTA`).

## ProductSaleMode (override por produto)

`details.saleMode`: `INHERIT_SITE_DEFAULT` (padrão) · `SHOW_ONLY` · `WHATSAPP_DIRECT` · `WHATSAPP_CART` ·
`ONLINE_CHECKOUT` (reservado). O backend devolve em cada produto público
`commerce = { saleMode, requestedSaleMode, checkoutAvailable:false, allowedActions, ctaLabel, availability }`.
A vitrine só obedece; regra comercial nunca fica no frontend. Sem WhatsApp configurado, tudo vira vitrine.

## SalesIntent

"Um visitante demonstrou intenção." Não é venda nem oportunidade. Tabela `sales_intents`.

- Tipos: `PRODUCT_WHATSAPP`, `CART_WHATSAPP`, `CONTACT_FORM` (+ reservados `CHECKOUT`, `MARKETPLACE`, `OTHER`).
- Status: `OPEN` → `CONVERTING` (claim atômico) → `CONVERTED`; expira em 14 dias.
- `snapshot`: itens com produto, variação, nome, SKU, imagem canônica, quantidade, preço e especificações —
  o histórico não muda quando o produto muda (mesmo princípio dos itens de oportunidade).
- Referência curta `VX-XXXXXX`: 6 posições sem 0/O/1/I/L (~887 milhões), CSPRNG, única, não enumerável,
  expira, e só converte dentro do mesmo tenant/workspace.
- Idempotência: `(siteId, requestKey)` para duplo clique/retry; `wasCreated` do inbound para webhook
  duplicado; claim `OPEN→CONVERTING` para concorrência; `dealId` gravado antes dos itens para retomada.
- **Clique sozinho nunca cria contato, conversa, atendimento ou oportunidade.**

## Carrinho (não é pedido)

`site_carts` + `site_cart_items`. Token anônimo aleatório no navegador, só o hash SHA-256 no banco;
30 dias; até 50 linhas; persiste entre páginas. Mostra disponibilidade real e recusa quantidade acima
do saldo, mas **não reserva estoque**. `customer_id` reservado para cliente logado no futuro.
Finalizar congela os itens numa `SalesIntent CART_WHATSAPP` e o carrinho vira `CHECKED_OUT`.

## Formulário do Site

Continua criando/atualizando o contato (comportamento anterior). Depois, conforme a configuração:
abrir atendimento (conversa do WhatsApp do telefone, sem enviar mensagem), criar oportunidade com o
produto da página e avisar a equipe. Gera uma `SalesIntent CONTACT_FORM` já convertida. Reenvio com a
mesma `requestKey` não roda nada de novo.

## UTM e identidade anônima

A vitrine guarda `utm_*` da entrada no `sessionStorage` (a última campanha com UTM vence) e um id
anônimo por site no `localStorage`. Ambos acompanham intenções e eventos. Na conversão, os eventos
daquela sessão recebem o `contactId`. A URL da página é guardada sem query e fragmento.

## Eventos (`site_events`)

`SITE_VIEW`, `PRODUCT_VIEW` (únicos que o navegador pode enviar), `PRODUCT_WHATSAPP_CLICK`,
`ADD_TO_CART`, `REMOVE_FROM_CART`, `CART_WHATSAPP_START`, `CONTACT_FORM_SUBMITTED`,
`SALES_INTENT_CREATED`, `SALES_INTENT_CONVERTED`. Não usa `product_events` (telemetria do próprio Vorix).
Logs estruturados: `SalesIntentCreated`, `SalesIntentConverted`, `WhatsAppCartStarted`, `SiteLeadCreated`,
`ConversionError` — sem dados pessoais.

## Produto dentro do Vorix Conversas

Botão "Produtos" no composer: busca por nome/SKU/categoria, escolhe a variação e
- **Enviar ao cliente**: o backend monta foto + nome + preço + descrição curta + link do produto
  (domínio próprio verificado → subdomínio da plataforma → `/s/slug`; nunca host fixo);
- **Adicionar à oportunidade**: uma aberta → adiciona; várias → pergunta qual; nenhuma → só cria com
  confirmação e permissão `deal:manage`.

## Permissões

Sem permissões novas. `site:manage` saiu do Atendente (agora Gerente/Administrador; concedível
individualmente). Configuração comercial = `commerce:manage`; intenções/leads do site = `commerce:read`.

## Fronteira com a Fase 2 (Order)

`src/domain/commerce/commerce.model.ts` segue sendo a fronteira de `Order` (venda transacional, não
oportunidade). A Fase 2 entra assim, sem reescrever produto, site, conversas ou estoque:
- `SalesIntent` tipo `CHECKOUT` vira a origem do pedido; o snapshot do carrinho é a linha do pedido;
- `ONLINE_CHECKOUT_AVAILABLE` passa a `true` quando Order + PaymentProvider + ShippingProvider existirem;
- reserva transacional de estoque acontece no checkout (o carrinho continua sem reservar);
- marketplaces chegam como `SalesIntent`/`Order` com `source` próprio sobre o mesmo `Product`/SKU.

## Limites conhecidos

- `tenant_sites` ainda tem `unique(tenant_id, workspace_id)` (um site por workspace no banco e na UI).
  Todas as entidades novas carregam `siteId`; abrir multi-site é remover essa restrição e ajustar a UI.
- Conversão automática só no WhatsApp (WuzAPI). Instagram DM fica para depois.
- A vitrine chega à API pelo servidor do Next: o limite de requisições públicas é por grupo
  (`public_site`, 1200/min), não por visitante.
