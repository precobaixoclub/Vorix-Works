# QA — Analytics do Site e Commerce

27/10/2026. Ambiente local, PGlite descartável e contas `.invalid`. Sem deploy, merge ou chamadas a gateways de pagamento/entrega.

| Verificação | Resultado |
| --- | --- |
| Backend completo | 4.231 aprovados, 2 ignorados, 0 falhas; 4.233 testes |
| Regressões finais de Analytics + Commerce | 30/30; inclui a última correção de atribuição de campanha |
| Web | 200/200; 28 arquivos |
| Navegador | 4/4, processo com exit code 0 e `.last-run.json` passed |
| Typecheck | Backend e web aprovados |
| Build | Backend e Next.js aprovados |
| Architecture check | Aprovado; contratos, isolamento e registry de templates |
| Volume | 10 mil eventos → 1 bucket agregado; relatório em 43 ms na última execução local (não é benchmark de produção) |

As regressões verificam tenant/site scope, visitante anônimo, identidade comprovada e ambiguidade, UTMs completas, referrer, campanhas sem mistura de dimensões, deduplicação, visitantes únicos, funil, conversões e ausência de denominador, produtos, carrinho com vários itens, datas locais e DST, escopo gerenciado por equipe, ausência de eventos futuros, cancelamento fora de ordem, moedas e não duplicação de venda CRM/pedido.

O teste de navegador entra diretamente em uma página pública de produto com UTM e verifica a emissão de SITE_VIEW. Depois cobre dashboard, gráfico, funil, origem, filtro de período, jornada, reconhecimento de eventos futuros emitidos exclusivamente pelo fixture e estado vazio de um segundo site. Verifica ausência de overflow horizontal nos quatro tamanhos de tela.

O banco de produção mantém um site por workspace. Para testar a preparação multi-site, a constraint é removida apenas no banco descartável do fixture; o teste de integração a restaura ao terminar. Nenhuma migration de produção altera essa regra.

| Largura | Dashboard | Sem dados |
| --- | --- | --- |
| 390 px | [Imagem](390px-dashboard.png) | [Imagem](390px-empty.png) |
| 768 px | [Imagem](768px-dashboard.png) | [Imagem](768px-empty.png) |
| 1024 px | [Imagem](1024px-dashboard.png) | [Imagem](1024px-empty.png) |
| 1440 px | [Imagem](1440px-dashboard.png) | [Imagem](1440px-empty.png) |

[Arquitetura, regras de contagem, contratos e integração futura](../../site-commerce-analytics.md).
