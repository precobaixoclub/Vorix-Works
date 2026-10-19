# Evidências do editor e dos modelos de site

18/10/2026. Capturas de Chrome em 1440 × 1000 e 390 × 844, com API/JWT/PostgreSQL locais e dados controlados. Marca, produtos e ilustrações são fictícios; não são conteúdo do Bambilu nem de clientes do Vorix.

| Modelo | Computador | Celular |
| --- | --- | --- |
| Catálogo | [Visualizar](desktop-public-catalog.png) | [Visualizar](mobile-public-catalog.png) |
| Institucional | [Visualizar](desktop-public-studio.png) | [Visualizar](mobile-public-studio.png) |
| Vitrine editorial | [Visualizar](desktop-public-showcase.png) | [Visualizar](mobile-public-showcase.png) |
| Editor | [Visualizar](desktop-editor.png) | [Visualizar](mobile-editor.png) |

O mesmo conteúdo foi mantido ao trocar os modelos. As diferenças de paleta, fonte, cabeçalho, proporção das imagens, cartões e grade resultam da configuração do próprio produto. O teste também verificou cores e fontes individuais, prévia interativa sem salvar, separação da publicação, arrastar e mover seções, desfazer/refazer, texto formatado, páginas privadas, menu, rodapé e banners com imagens por dispositivo e agendamento.

Rodada final dos novos cenários: **12 aprovados, nenhuma falha**. As **16 regressões de navegação** de Product/Site passaram na rodada completa anterior. Executor reproduzível: `node scripts/sites/test-builder-browser.mjs` após `npm run build`; consulte [o relatório](../../site-builder-self-service.md).
