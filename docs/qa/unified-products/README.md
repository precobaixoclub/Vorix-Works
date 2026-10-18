# Site unificado e disponibilidade

18/10/2026. Capturas de fixtures controladas, com API JWT, PostgreSQL 16 descartável e gateway sandbox. Nenhuma conta Google ou cobrança real.

| Evidência | Computador | Celular |
| --- | --- | --- |
| Site como produto público | [Captura](desktop-public-site.png) | [Captura](mobile-public-site.png) |
| Somente Marketing com acesso interno | [Captura](desktop-admin-products.png) | [Captura](mobile-admin-products.png) |
| Loja online dentro do único Site | [Captura](desktop-unified-shop.png) | [Captura](mobile-unified-shop.png) |

22 cenários únicos de browser validados, incluindo 16 de regressão de Produtos/Site e seis de unificação e disponibilidade. A rodada principal aprovou 20; após corrigir um seletor de teste e resolver os aliases antes do layout autenticado, os quatro cenários administrativos/domínio foram repetidos com sucesso (os dois que falharam e seus equivalentes no outro viewport). Containers de fixture encerrados e removidos.

Detalhes da implementação e limites funcionais em [unified-site-public-products.md](../../unified-site-public-products.md).
