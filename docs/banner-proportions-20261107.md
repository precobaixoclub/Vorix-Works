# Proporção do banner com texto ao lado — 07/11/2026

A campanha horizontal era colocada na mesma moldura de altura fixa usada por fotos verticais de produtos. Com `object-fit: contain`, a diferença de proporções criava faixas brancas, sobretudo em larguras grandes equivalentes a reduzir o zoom do navegador.

As artes cadastradas no banner agora usam largura disponível e altura natural. O texto ao lado, a composição do modelo, os links e o carrossel permanecem configurados como antes. A versão mobile respeita a proporção do arquivo selecionado pelo `picture`, inclusive quando só há imagem própria para celular. As fotos vindas do catálogo continuam na moldura original, inteiras.

Não há alteração do arquivo de imagem, recorte, esticamento, alteração de conteúdo publicado, backend ou migration.

## Validação

- Typecheck e 11 testes frontend relevantes aprovados.
- Três testes de navegador existentes de composição, cores, ofertas, busca, menu, swipe e detalhe aprovados.
- Conferência local do banner real em 390, 768, 1920, 3840, 5760 e 7680 px. As três últimas larguras incluem rasterização equivalente a zoom de 50%, 33% e 25% em uma tela de 1920 px.
- A proporção exibida corresponde à proporção natural; imagem e moldura têm as mesmas dimensões, sem faixas internas, recorte, overflow ou erros JavaScript.
- O texto permanece ao lado no computador e segue a organização original no celular.

Evidências em [qa/banner-proportions-20261107](qa/banner-proportions-20261107). As capturas de antes reproduzem a moldura anterior na mesma prévia local. A conferência utiliza uma cópia somente de leitura dos dados públicos; não grava na loja.

## Publicação

Release `bd34dcc` enviada à main e publicada pelo procedimento oficial com alvo `web`. Build Linux e TypeScript aprovados, `DEPLOY_DONE`, API pronta, site HTTP 200 e seis contêineres saudáveis. A imagem web em execução corresponde à imagem construída e os dois arquivos alterados correspondem ao commit. Configuração de ambiente preservada; nenhum rollback necessário.

A conferência no site publicado passou nas mesmas seis larguras, com texto preservado, proporção natural, ausência de faixas internas, overflow e erros JavaScript. [Resultado no navegador](qa/banner-proportions-20261107/production-validation.json) e [verificação do host](qa/banner-proportions-20261107/production-host.json).

Entre a leitura inicial e o início do deploy, uma nova arte foi publicada na loja: mudaram apenas `layoutConfig.heroImageUrl` e `publishedAt`. Essa publicação foi preservada e conferida na validação final. Catálogo, variações, preços e configuração comercial permaneceram iguais. Os testes não gravaram dados em produção; o tráfego de outras imagens foi limitado durante a medição do banner.

Capturas reais: [computador](qa/banner-proportions-20261107/production-desktop.png), [zoom equivalente a 33%](qa/banner-proportions-20261107/production-zoom-33.png) e [celular](qa/banner-proportions-20261107/production-mobile.png).

Recuperação: `/opt/zuno/deploy_backups/pre-bd34dcc-20261107134137.tgz`, `/opt/zuno/deploy_backups/db-pre-bd34dcc-20261107134137.sql.gz`, `/root/.env.zuno.pre-bd34dcc-20261107134137` e imagem `zuno-zuno-web:rollback-20261107134137`. Pacote exato em `/opt/zuno/deploy_backups/release-bd34dcc.tgz`, SHA-256 `c49b6a151943900d67e0d115ecfc1471be713c9d409a16fc0f8ca70d49bf1371`. Log: `/var/log/vorix-deploy-bd34dcc-20261107134137.log`.

O registro de produção é enviado em commit posterior de documentação. A aplicação publicada corresponde à release `bd34dcc`.
