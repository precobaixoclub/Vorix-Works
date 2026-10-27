# Analytics do Site e atribuição comercial

Branch `feat/site-commerce-analytics`, criada diretamente de `main` em `5a3a7fe`, em worktree própria. A branch de catálogo não foi incorporada nem alterada. Sem merge ou deploy.

## Auditoria e reutilização

A Fase 1 já possui `site_events`, `sales_intents`, `site_carts`, UTMs estruturadas e `anonymousSessionId`. Product/ProductVariant são o catálogo central. A ponte `site-lead-use-cases` já conecta a intenção a Contact, Conversation, Atendimento e Deal. O dashboard comercial e o Analytics de marketing possuem outros contratos e escopos: não foram duplicados nem usados como substitutos para eventos públicos do Site.

`site_events` é o histórico de interações do visitante. `sales_intents` continua sendo a fonte dos vínculos comerciais. O novo relatório lê as oportunidades existentes para consultar criação, status e valor final de fechamento, sem modificar CRM ou recalcular preço pelo catálogo atual. Não há parsing de texto, mensagens ou logs para obter métricas.

O identificador anônimo é o já utilizado pela vitrine (`vx_sid:<slug>`). UTMs continuam seguindo a captura existente da sessão: uma entrada nova com UTM substitui a campanha anterior na navegação. O registro de entrada direta numa página de produto foi corrigido para emitir também SITE_VIEW; antes só era emitido PRODUCT_VIEW. Reexecução de efeitos React no mesmo componente não duplica essas visualizações.

Para atribuição comercial sem UTM informada, usa-se a última entrada medida daquele identificador no mesmo site, anterior à intenção/pedido e dentro de 30 dias, incluindo seu referrer. Quando o produtor informa uma campanha, seus campos são preservados sem completar medium/content/term com campos de outra campanha. Sem entrada comprovada, permanece Direto/sem campanha. Ordenação financeira não compara moedas diferentes.

## Fonte de cada número

| Métrica | Fonte / unidade |
| --- | --- |
| Visitantes | IDs anônimos distintos, por site, no período; não uma estimativa de pessoas |
| Visualizações | SITE_VIEW; páginas, inclusive entradas diretas em produto |
| Visualizações de produto | PRODUCT_VIEW, com produto publicado válido no workspace |
| WhatsApp | PRODUCT_WHATSAPP_CLICK; clique não é conversa |
| Carrinho | ADD_TO_CART; operação de inclusão/alteração de quantidade, não unidades vendidas |
| Interesse no funil | União de visitantes com WhatsApp, carrinho, formulário ou intenção; nunca soma dos contadores |
| Intenções comerciais | IDs distintos de SalesIntent, inclusive formulário, mesmo se um evento best-effort não chegou |
| Contatos associados | Contatos conhecidos por intenção; podem ser contatos já existentes no CRM |
| Conversas / atendimento | Vínculo real conversationId/attendanceId no SalesIntent |
| Oportunidades | Deals distintos vinculados, pela data de criação da oportunidade |
| Checkouts | Eventos CHECKOUT_STARTED; a conversão usa visitantes identificados |
| Pedidos | Order IDs distintos observados pelo consumidor; data de criação ou, na sua ausência, pagamento conhecido |
| Vendas | Deal atualmente ganho ou ORDER_PAID, deduplicados quando o pedido informa opportunityId |
| Receita | Valor final do Deal ou amountCents/currency do evento de pagamento do pedido; moedas permanecem separadas |

Cancelamento conhecido remove a venda/receita do pedido, inclusive se chegou antes do evento de pagamento. PAYMENT_APPROVED sozinho não é tratado como receita. Reabertura de oportunidade deixa de ser uma venda atual. Datas de receita são as datas de fechamento/pagamento, e não a data do clique. A receita CRM usa a primeira intenção vinculada àquela oportunidade como atribuição canônica, evitando duplicação por várias intenções.

Receita por produto só é exibida quando há atribuição individual conhecida: um único produto no snapshot financeiro do CRM e na intenção, ou, nos pedidos do checkout (Commerce Fase 2), o total de cada linha de `commerce_order_items` (sem frete). Pedido com desconto não recebe rateio estimado por produto. Receita sem moeda/valor permanece indisponível.

As conversões de visita/produto/WhatsApp/carrinho/checkout usam interseção de visitantes identificados nos dois conjuntos, dentro do período filtrado. Intenção → contato e oportunidade → venda usam a coorte criada no período e seu vínculo/status atual. Contato → oportunidade usa a interseção dos contatos associados no período. Sem denominador, o resultado é `null` e a tela mostra `—`; razões inválidas não viram um percentual artificial. As etapas do funil são conjuntos independentes: um formulário pode pular a página de produto ou a conversa.

## Eventos, deduplicação e consumidor futuro

O contrato existente `SiteEventInput` recebeu campos opcionais de contexto: eventKey, referrer, device, orderId, opportunityId, conversationId, attendanceId, amountCents e currency. O timestamp do evento continua sendo `created_at` do servidor. Eventos públicos aceitos continuam exclusivamente SITE_VIEW e PRODUCT_VIEW; um visitante não pode forjar pagamento, pedido ou conversão.

Produtor dos eventos de pedido: Commerce Fase 2 (`checkout-use-cases`). CHECKOUT_STARTED/SHIPPING_QUOTED vêm da cotação; ORDER_CREATED, PAYMENT_STARTED, PAYMENT_APPROVED, ORDER_PAID, ORDER_CANCELLED e ORDER_COMPLETED levam orderId, sessão anônima, UTM do pedido, amountCents (total com frete) e currency. ORDER_PAID é emitido depois do CRM e leva o opportunityId da oportunidade ganha da mesma venda, que deduplica a venda CRM. A receita total vem do evento; a única tabela de pedido consultada é `commerce_order_items`, para a divisão por produto. Na visão restrita, um pedido aparece para quem é dono/equipe da oportunidade ganha.

O consumidor mantém `site_analytics_order_facts`, uma projeção dos eventos recebidos, não uma segunda entidade de pedido nem um motor de checkout. Um ORDER_PAID correlacionado por opportunityId substitui a contagem financeira daquele Deal; sem essa correlação, Analytics não presume que duas vendas são a mesma.

IDs de eventos deduplicam views/retries. Eventos de ciclo de SalesIntent e Order têm deduplicação adicional por tipo + ID da entidade. Recibos persistidos também impedem contagem duplicada ao reconstruir a projeção. Eventos antigos sem chave e sem identidade de negócio não são deduplicados por heurística de tempo/nome.

## Identidade e privacidade

`site_analytics_identities` mantém o vínculo entre site + anonymousSessionId e contato. A função aceita somente contatos do mesmo tenant/workspace já comprovados por SalesIntent convertido. Eventos históricos permanecem imutáveis: o método legado `attachContactToSession` agora chama essa função em vez de sobrescrever `site_events.contact_id`.

Se uma sessão for associada a contatos diferentes, o vínculo fica ambíguo. Jornadas deixam de unir o histórico anônimo e mostram somente eventos diretamente ligados à intenção; métricas de escopo restrito também deixam de herdar o histórico anônimo ambíguo. Não se vincula por nome parecido, e-mail, IP ou fingerprint.

Não são coletados IP, user-agent bruto, mensagens, documento, nome, telefone ou e-mail do visitante nos eventos analíticos. URL é limitada a origin + pathname, sem query/fragmento; referrer guarda somente hostname; device é apenas mobile/tablet/desktop/unknown. UTMs aceitam apenas os cinco campos existentes e seus limites. A jornada é limitada a 40 eventos do período, e a lista inicial a 20 intenções.

## Escopo e RBAC

Todas as rotas exigem analytics:read, site:read, commerce:read, deal:read e inbox:read. Contato/jornada exige contact:read; sem essa permissão, IDs de contato são removidos da resposta inicial.

O cache da tela também separa resultados por usuário, tenant, perfil e permissões efetivas; trocar de conta ou de acesso não reutiliza números globais de outro contexto.

O resolvedor de acesso existente (`resolveAccessContext`, `scopeFor`, `readableTeamIds`) continua sendo a autoridade. Visão global do workspace exige os três escopos globais de relatório, oportunidade e atendimento. Gerentes usam somente equipes que gerenciam; membros seguem suas permissões efetivas. Sem escopo global, os números incluem apenas sessões de intenções vinculadas às oportunidades/atendimentos do usuário ou das equipes/usuários permitidos. Visitantes ainda sem vínculo não são expostos a um atendente. Revogações individuais continuam valendo.

Workspace, site e produto são validados no backend contra tenant/workspace autenticados. Chaves de usuário/tenant não vêm da query. Um site/produto estrangeiro responde 404.

## Datas, multi-site e performance

Períodos: hoje, ontem, últimos 7/30 dias e personalizado de até 366 dias. A API aceita timezone IANA, com default America/Sao_Paulo. As fronteiras são meia-noite local inclusiva e início do dia seguinte exclusivo; dias de 23/25 horas e offsets de meia hora são respeitados. Filtros: siteId, productId, categoryId (inclui descendentes), source e campaign. Aquisição preserva medium/content/term e referrer na apresentação.

Todos os IDs de visitante e vínculos são isolados por site. A arquitetura do relatório suporta vários sites no workspace. O catálogo de Sites atual ainda possui `unique(tenant_id,workspace_id)`: esta entrega não remove essa regra de produto. Os testes de cenário futuro removem a constraint apenas em banco descartável e restauram-na no teste de integração; o fixture de navegador também é descartável. A produção permanece com sua regra atual de um site por workspace.

O dashboard não consulta o histórico bruto de eventos para calcular métricas. Um trigger transacional atualiza `site_analytics_buckets` por minuto, visitante, produto/variante, tipo e dimensões. Contagem de views é somada; visitantes únicos são calculados sobre os identificadores da projeção ao longo do período, evitando somar únicos diários. O hash de dimensões limita o tamanho da chave de índice, inclusive com UTMs Unicode longas.

As projeções possuem índices por tenant/workspace/período/site/produto. A consulta comercial usa os índices e vínculos de SalesIntent/Deal e não recarrega milhares de eventos no navegador. Séries têm no máximo 366 dias; produtos/origens são enviados em páginas de até 100 itens (20 na UI). A jornada é a única leitura do histórico bruto, com índice de sessão e limite fixo de 40.

O backfill inicial da migration processa o histórico uma vez, de forma deduplicada. Para uma instalação já com milhões de eventos, avaliar a janela de manutenção ou extrair esse backfill para lotes na integração; não há rebuild de eventos em carregamentos do dashboard. O teste de volume comprova 10 mil eventos repetidos agregados em um bucket, sem tratar isso como benchmark de produção.

## Integração com as outras branches

Migration nova: `0183_site_commerce_analytics.sql`. A base desta branch termina em 0180; o repositório paralelo tinha 0181 para Commerce, e 0182 está reservada ao catálogo. Antes do merge futuro, conferir novamente a numeração e renumerar a migration nova se outra trilha tiver ocupado 0183. Nenhuma migration aplicada foi editada.

Arquivos compartilhados com a Fase 2 que merecem conciliação manual: `site-commerce-repository.port.ts`, `postgres-site-commerce-repository.ts`, `site-commerce-use-cases.ts`, `site-commerce.route.ts`, `routes/v1/index.ts`, o wrapper de storefront e a navegação do workspace. As mudanças aqui são somente de eventos, identidade, validação pública e link de Analytics. Métodos de checkout/pagamento/entrega/reserva não foram implementados nem alterados.

Não foram modificados Order, OrderItem, Checkout, Payment, PaymentProvider, Shipping, ShippingProvider, Shipment ou InventoryReservation. A branch `feat/catalog-bulk-operations` permanece separada.

## Verificação

Backend: `node scripts/test-backend.mjs`, `node --test tests/site-analytics.test.mjs tests/site-commerce.test.mjs`. Web: `npm --prefix web test`, typecheck/build de ambos os pacotes, `npm run architecture:check`. Navegador: iniciar `node tests/fixtures/site-analytics-browser-server.mjs` e executar em web `npx playwright test --config playwright.site-analytics.config.ts`. Portas exclusivas 3890/3891, contas `.invalid`, banco efêmero.

[Resultados finais e evidências de navegador](qa/site-commerce-analytics/README.md).
