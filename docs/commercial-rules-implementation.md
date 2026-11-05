# Regras Comerciais configuráveis — implementação

Trabalho iniciado em 04/11/2026 e validado em 05/11/2026. A primeira validação ocorreu numa cópia local de teste, com banco PostgreSQL/PGlite descartável, produtos fictícios e pagamento sandbox. Após autorização, o commit `f3626e8` foi publicado em 05/11/2026 e a regra da Bambilu Kids foi ativada em produção. Consulte o [relatório da publicação](production-deploy-20261105.md). A loja permanece em modo vitrine, com carrinho e checkout desabilitados.

## Auditoria anterior à implementação

- Produtos e variações já pertencem ao catálogo único. As opções, preços de variantes, categorias e `apparel.collection` foram reaproveitados.
- Carrinho anônimo, estoque, checkout, pagamentos, pedidos e permissões já existiam. `presentCart` já validava produtos e relia preços no backend.
- `commerce_orders` já possuía subtotal, desconto, frete e total; esses campos foram reutilizados.
- As políticas comerciais de CRM e as tabelas de preços existentes tratam negociação/aprovação de vendedores, não promoções automáticas do carrinho. Não foi criado um segundo mecanismo de aprovação, carrinho ou pedido.
- Não havia cupom no carrinho público. O código de cupom foi incorporado à própria definição de regra, sem criar um motor de cupons separado.
- Todos os templates já passam pelos componentes compartilhados de card e detalhe. As informações comerciais foram adicionadas nesses pontos, sem modificar a identidade dos templates.

## Arquitetura e cálculo

`src/domain/commerce/commercial-rules.ts` contém validação e avaliação puras, independentes de banco, HTTP e React. O modelo separa escopo, gatilho, benefício, canais, validade, prioridade e acumulação.

`src/application/commerce/commercial-rule-use-cases.ts` valida referências do workspace, prepara linhas com categorias ancestrais/coleções e calcula identificadores da cotação. `CommercialRuleRepositoryPort` e `PostgresCommercialRuleRepository` cuidam de persistência, revisão e auditoria.

O cálculo é usado no catálogo para a condição de uma unidade, no carrinho, na cotação, no pedido e na venda assistida por WhatsApp. A fonte dos preços originais continua sendo o catálogo, inclusive quando o preço público já apresenta uma promoção. Isso impede aplicar o mesmo desconto duas vezes.

Gatilhos suportados:

- Quantidade total elegível.
- Quantidade do mesmo produto, somando variações.
- Subtotal mínimo dos produtos elegíveis, antes dos descontos e sem frete.

Escopos: toda a loja, produtos, categorias — incluindo descendentes — e coleções existentes do vestuário. Canais: checkout online e venda assistida/WhatsApp.

Benefícios: percentual em pontos-base, valor fixo em centavos e preço unitário por faixa. Faixas são validadas contra lacunas, sobreposições e aumento progressivo de preço. A nova faixa vale para todas as unidades elegíveis. Benefícios não aumentam o preço original nem produzem totais negativos.

Percentuais e valores fixos são distribuídos proporcionalmente entre as linhas com conservação dos centavos. Para esses descontos, o total da linha é a informação financeira definitiva; um valor unitário final só é registrado como tal quando a divisão pela quantidade é exata. O preço anterior ao desconto de linha também fica no snapshot.

Em lojas híbridas, checkout e WhatsApp são compras distintas: quantidades e benefícios são avaliados por canal e moeda. Itens que continuam sob consulta não liberam uma faixa de uma compra online que não os inclui.

## Prioridade, conflitos e cupons

1. Entre regras automáticas válidas, considera-se a maior prioridade numérica.
2. Dentro dessa prioridade, são comparadas as alternativas não acumuláveis e a combinação explicitamente acumulável. Vence o menor total permitido para o cliente.
3. Regras acumuláveis são processadas em ordem estável: preço unitário, percentual e valor fixo. Empates finais usam identificadores estáveis.
4. Cupom é opcional e há um código por carrinho. A regra automática precisa permitir explicitamente acumulação com cupom.
5. Também são comparadas as alternativas exclusivas do cupom e as combinações permitidas, respeitando prioridades. Não há soma silenciosa de descontos.

Regras são inativas por padrão. Validade considera início inclusivo e fim exclusivo, com datas ISO no servidor. A interface converte o horário local escolhido para ISO.

## Persistência e migration

Migration aditiva: `db/migrations/0192_commercial_rules.sql`.

| Estrutura | Finalidade |
| --- | --- |
| `commerce_rules` | Definição JSON validada, tenant/workspace/site, revisão e autoria |
| `commerce_rule_audit` | Histórico de criação, alteração e exclusão, com a definição de cada revisão |
| `site_carts.coupon_code` | Código informado no carrinho |
| `commerce_order_items.pricing_snapshot` | Preços originais/aplicados, desconto e regras/faixas congeladas por linha |

Não há alteração de preço do produto no banco nem regravação de pedidos antigos. Novas colunas são opcionais. Sem regras ativas, os valores anteriores continuam sendo utilizados.

O snapshot inclui preço original, preço antes de descontos de linha, preço unitário final quando exato, total original, total aplicado, desconto, ID/nome/revisão da regra, benefício e faixa atingida. A exclusão de uma regra não remove os snapshots de vendas anteriores.

Estornos de itens com snapshot usam o valor efetivamente pago e distribuem centavos de maneira cumulativa entre devoluções. Pedidos legados mantêm seu tratamento anterior. A ponte para o CRM também recebe o desconto residual, evitando divergir do total vendido.

## Recálculo e checkout

Adicionar/remover itens, trocar quantidade, usar outra variação e aplicar/remover cupom retornam o cálculo do backend. Reabrir o carrinho relê catálogo, estoque e regras.

A cotação retorna `pricingKey`. Se itens, preços ou regras mudarem antes da finalização, o checkout solicita revisão e atualiza os valores. O navegador não envia preços confiáveis para criação do pedido.

Na transação de criação do pedido, uma trava compartilhada com a administração verifica novamente as revisões e a vigência das regras. Uma alteração entre cálculo e gravação é recusada. A chave de idempotência do pedido continua impedindo duplicações em retries.

## Endpoints

Todos os caminhos abaixo usam o prefixo `/v1`.

| Método | Caminho | Uso |
| --- | --- | --- |
| GET | `/sites/:id/commercial-rules?workspaceId=...` | Listar regras; `commerce:read` |
| POST | `/sites/:id/commercial-rules?workspaceId=...` | Criar com `{definition}`; `commerce:manage` |
| PUT | `/sites/:id/commercial-rules/:ruleId?workspaceId=...` | Editar/ativar/desativar com `{definition, revision}` |
| DELETE | `/sites/:id/commercial-rules/:ruleId?workspaceId=...&revision=...` | Excluir com controle de revisão |
| PUT | `/public/sites/:slug/cart/coupon` | Aplicar/remover código e recalcular |

Os endpoints existentes de catálogo, carrinho, intenção de WhatsApp, cotação e criação/consulta de pedidos passam a incluir as informações calculadas. O checkout aceita `pricingKey`. Os controles de autenticação, permissão, entitlement, workspace e modo somente leitura foram reutilizados.

## Administração e site

Acesse **Meu site → Regras Comerciais**, em `/workspaces/:workspaceId/site?section=regras`.

A tela oferece criação, edição, ativação/desativação, exclusão confirmada, prioridade, vigência, canais, moeda, escopo, contagem, benefícios, faixas, acumulação e código de cupom opcional. A listagem apresenta nome, tipo, escopo, benefício, status e validade. Salvar uma regra não exige publicar o template.

`CommercialRulesPanel.tsx` utiliza os componentes existentes do painel. `CommercialPricingInfo.tsx` centraliza a apresentação de faixas, progresso, descontos e cupom. Card, detalhe, carrinho, checkout e pedido continuam usando fontes, cores, bordas e botões do template.

Os seis modelos foram validados: Catálogo, Institucional, Vitrine editorial, Nexus, Aura e Pulse. As larguras verificadas foram 360, 390, 430, 768, 1024 e 1440 px, sem overflow horizontal nas 36 combinações do teste comercial.

## Configuração inicial da Bambilu Kids

Arquivo: `config/commercial-rules/bambilu-kids-progressive.json`.

- Nome: Preço progressivo por quantidade.
- Toda a loja, soma de itens elegíveis, incluindo variações e produtos diferentes.
- Checkout e WhatsApp; prioridade 0; sem acumulação automática ou com cupom.
- 1–2 itens: R$ 60 cada; 3–4: R$ 55 cada; 5+: R$ 50 cada.

| Itens | Total validado |
| --- | --- |
| 1 | R$ 60,00 |
| 2 | R$ 120,00 |
| 3 | R$ 165,00 |
| 4 | R$ 220,00 |
| 5 | R$ 250,00 |
| 6 | R$ 300,00 |
| 10 | R$ 500,00 |

Essa configuração foi cadastrada e exercitada na cópia local descartável, pela API autenticada do módulo. Após a autorização de publicação, foi cadastrada na loja publicada pelo caso de uso normal da aplicação, com auditoria da release. A [evidência de ativação](qa/production-commerce-20261105/rule-activation.json) registra a revisão 1 ativa e os totais conferidos com produtos reais, sem criar pedidos.

O importador genérico `scripts/commercial-rules/import-rule.mjs` permite cadastrar a configuração pela API normal após o deploy autorizado. Sem `--apply`, apenas apresenta o conteúdo. Com aplicação explícita, localiza a loja pelo slug dentro do workspace informado e cria/atualiza a regra por nome. O token é recebido por variável de ambiente e não é registrado no relatório.

## Testes e evidências

- 266 testes de frontend aprovados, em 38 arquivos.
- 68 testes de backend aprovados, cobrindo o módulo e regressões de carrinho, checkout, pagamento, estoque, CRM e WhatsApp.
- Após o ajuste final do snapshot unitário, os 29 testes específicos de domínio/integração foram repetidos e aprovados.
- Quatro testes Playwright aprovados: CRUD real, faixas no carrinho, checkout/pedido com alteração concorrente e informação comercial nos seis templates.
- Typecheck e build de backend e frontend aprovados. Migration executada e reaplicação validada em PostgreSQL/PGlite local.

Casos cobertos: mudanças de faixa, produtos/variações mistos, elegibilidade, remoção e quantidade, inatividade, vigência, canal/moeda, conflitos, acumulação, cupons, carrinho vazio, centavos, histórico, isolamento de tenant/workspace, revisão concorrente, alteração durante checkout e estorno do valor pago.

As capturas, os snapshots financeiros e as métricas da fase local ficam em [docs/qa/commercial-rules-20261104](qa/commercial-rules-20261104/README.md). Nessa fase, dados, imagens e pagamentos eram de teste e não houve cobrança nem deploy. As [evidências posteriores de produção](qa/production-commerce-20261105/README.md) registram a publicação autorizada e a conferência da loja real.
