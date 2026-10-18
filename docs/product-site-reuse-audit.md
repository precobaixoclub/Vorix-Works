# Product Engine + Site Engine — auditoria e decisões

18/10/2026. Vorix é a fonte de verdade. Bambilu Kids foi inspecionado como referência, sem executar seu runtime ou importar banco, identidade visual, fixtures, credenciais, uploads ou histórico Git. Nenhuma implantação está autorizada nesta rodada.

## Mapa de reaproveitamento

| Área | Classificação | Decisão |
| --- | --- | --- |
| Product, variantes, tabelas de preço, DealItem e ProposalItem do Vorix | REUSE | Evoluir as mesmas tabelas, IDs, portas, casos de uso e snapshots. `variantId` já existe em oportunidades e propostas. |
| Estoque e movimentos do Vorix | MERGE | Preservar baixa/devolução de vendas antigas e acrescentar dimensão de variante e operações transacionais. |
| Grade de tamanhos e estoque do Bambilu | ADAPT | Generalizar tamanho/cor em opções e combinações; não copiar lógica específica de vestuário. |
| Categorias, slugs, mídia ordenada e catálogo do Bambilu | ADAPT | Hierarquia, visibilidade e validações no PostgreSQL, com escopo tenant/workspace do Vorix. |
| CMS de blocos e publicação do Bambilu | ADAPT | Conteúdo tipado e limitado; rejeitar tipos desconhecidos e URLs perigosas. Templates separados do conteúdo, sem executar HTML/JS fornecido pelo cliente. |
| Checkout, preço autoritativo e reserva do Bambilu | ADAPT | Trazer regras de atomicidade, rollback e preço do servidor para testes e arquitetura; manter checkout/pedidos fora do Site institucional. |
| Estados de pedidos, pagamentos e expiração do Bambilu | REUSE conceitual | Registrar fronteira futura Commerce, providers por tenant e restituição idempotente. Não criar ERP nem cobrança/frete universais. |
| SQLite/ORM, auth, RBAC, upload, CRM e UI do Bambilu | DISCARD | Usar somente a infraestrutura equivalente existente no Vorix. |
| GENERAL, VEHICLE, atributos genéricos e domínios verificados | NEW | Extensões nativas, sem duplicar Product nem Contact. |
| Site/Commerce como soluções e capacidades | MERGE | Entitlements, permissões e billing configurável existentes; nenhuma concessão gratuita automática. |

## Conhecimento trazido dos testes do Bambilu

| Referência | Destino/decisão |
| --- | --- |
| `checkout-stock.test.mjs` — última unidade, saldo independente e rollback sem órfãos | ADAPT: estoque transacional de variantes e restituição, com fixtures PostgreSQL do Vorix. |
| `checkout-pricing.test.mjs` — ignorar preço e frete enviados pelo cliente | ADAPT: preservar resolução comercial no backend; frete/checkout ficam no contrato de Commerce. |
| `cms-blocks.test.mjs` — bloco desconhecido, draft privado, autenticação | ADAPT: conteúdo tipado, publicação explícita e isolamento entre tenants. |
| `cms-hardening.test.mjs` — URL perigosa, SVG/data, mensagens inválidas, honeypot | ADAPT: renderização sem HTML livre, mídia do storage atual e formulário público controlado. |
| `state-machine.test.mjs` — transições terminais e não regressão | ADAPT conceitual para Commerce; não transportar a máquina de estados de pedidos ao CRM. |
| `checkout-coupon.test.mjs` — validade e limite de uso | Reservado para Commerce; fora do checkout institucional desta rodada. |
| Testes específicos de marca, UI, runtime, usuários e integração externa do Bambilu | DISCARD nesta rodada. |

A inspeção incluiu catálogo administrativo/público, normalização de blocos, serviços de vendas/expiração e os seis arquivos de testes citados. Arquivos de referência selecionados e seus hashes ficam somente em `tmp/bambilu-reference`, ignorado pelo Git; nenhum arquivo de runtime do ZIP foi executado.

## Fronteiras

Product continua compartilhado por Conversas, oportunidades, propostas e Site. Site publica apenas uma projeção segura: nenhum custo, preço mínimo, comissão ou dado privado. Conteúdo em rascunho não aparece no site publicado. A desativação de produto/visibilidade e a revogação do entitlement são conferidas também na leitura pública.

Contact permanece a identidade comercial. Opportunity e Proposal preservam snapshots; um futuro Order referencia a proposta aceita e usa providers configurados pelo tenant. Carrinho, cobrança, frete e pedidos reais não fazem parte do Site institucional.

Domínio próprio exige prova de controle e unicidade global antes de rotear. DNS/TLS de produção dependem de implantação posterior, explicitamente fora desta rodada. A configuração de domínio não dispara registro ou alterações DNS externas.
