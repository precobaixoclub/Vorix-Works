# Evidência de quantidades e próxima cobrança

18/10/2026. Seis testes de browser aprovados usando API local, autenticação JWT normal, PostgreSQL 16 descartável e gateway sandbox. Somente dados fictícios; nenhuma cobrança real.

| Cenário | Computador | Celular |
| --- | --- | --- |
| Aumentar e recarregar | [Captura](desktop-increase-persisted.png) | [Captura](mobile-increase-persisted.png) |
| Reduzir usuários, WhatsApp e adicional de Site; recarregar | [Captura](desktop-decrease-persisted.png) | [Captura](mobile-decrease-persisted.png) |
| Cancelar uma redução, preservando as demais | [Captura](desktop-cancel-reduction.png) | [Captura](mobile-cancel-reduction.png) |

O teste compara o próximo valor exibido com a API e o valor enviado ao gateway simulado. O banco descartável e o container de teste foram removidos ao final. Detalhes em [capacity-renewal-validation.md](../../capacity-renewal-validation.md).
