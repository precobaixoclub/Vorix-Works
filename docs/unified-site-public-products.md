# Vorix Site único e disponibilidade dos produtos

18/10/2026. Alteração explícita de produto solicitada pelo usuário após a publicação `e9545a2`.

## Produtos

| Produto | Disponibilidade |
| --- | --- |
| Vorix Conversas | Público |
| Vorix Meetings | Público |
| Vorix Site | Público; inclui site, catálogo e área de loja online |
| Vorix Marketing | Interno |

Commerce deixa de ser uma solução separada. O seletor, a navegação e o painel de concessões usam quatro produtos. A configuração comercial do Site fica em `/admin/site`; o endereço antigo redireciona. A rota antiga `/workspaces/:id/commerce` também redireciona ao Site. O endpoint antigo de módulos permanece como alias para clientes existentes, mas só cadastra o recurso `site`.

Disponibilidade pública não concede acesso gratuito: continuam valendo o plano/adicional ou concessão administrativa, permissões, isolamento por tenant, quotas e kill switches. Meetings e Site aceitam concessões normais (`manual`/`subscription`), sem rótulo de produto interno. Marketing continua exigindo concessão interna.

## Unificação sem mudança de cobrança

A migration `0168_unified_site_product.sql` copia acessos legados de Commerce para Site quando não há uma decisão explícita de Site, registra auditoria, incorpora a capability legada e normaliza o recurso dos adicionais. Preserva IDs, códigos de adicionais, preços, assinaturas, limites e histórico antigo. Uma revogação explícita de Site continua prevalecendo. O kill switch legado de Commerce é interpretado como Site para preservar a proteção após a unificação.

O catálogo público da API passa a apresentar Conversas, Meetings e Site. O Site tem página pública própria, link no menu e apresentação na home e em preços. As páginas comerciais consultam o catálogo atual em runtime: o build do frontend pode ocorrer enquanto a API anterior ainda atende, portanto ele não deve congelar a disponibilidade antiga nos HTMLs gerados.

## Limite funcional e evidência

Site institucional, catálogo, formulários, WhatsApp, produtos, variantes, estoque, edição e publicação continuam implementados. Carrinho, pagamento de pedidos e frete permanecem em preparação **dentro do Vorix Site**, na área Loja online; não aparece um produto Commerce separado e a compra online não é simulada como disponível.

A liberação de Meetings é uma decisão explícita de produto. O registro técnico `MEETINGS_COMMERCIAL_READINESS` conserva a evidência anterior (`selfServiceProvisioning=PARTIAL`), separado da disponibilidade; nenhum smoke Google real foi convertido artificialmente em PASS. Esta revisão usa fixtures, sem login Google, Meet, captura ou cobrança real.

Validações: regressão backend com 403 testes aprovados; dois testes adicionais do catálogo/unificação e upgrade 0167→0168 aprovados; Meetings com 71 aprovados e um cenário externo omitido; frontend com 125 aprovados; 49 contratos e isolamento arquitetural aprovados. Cobertura de browser verifica o catálogo público, apenas Marketing com selo interno, concessão normal de Meetings, Site unificado, URLs antigas e regressão de edição/publicação de Site e Produtos em computador e celular. As capturas selecionadas ficam em `docs/qa/unified-products`.
