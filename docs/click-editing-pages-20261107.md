# Seleção pela prévia e páginas em painéis — 07/11/2026

A prévia do editor permite clicar em uma área para abrir as configurações correspondentes. Textos, imagens, blocos, itens, fotos de galeria, links de menu/rodapé e produtos são identificados; o editor abre o painel apropriado, expande o item necessário e destaca o campo. Nas páginas internas, a seleção mantém o contexto da página correta, inclusive após alterar seu endereço.

**Editar por clique** é o modo inicial. A instrução orienta a rolar o site e clicar nas áreas; o contorno e a indicação “Editar” aparecem ao passar o ponteiro. A indicação mantém tamanho legível quando a prévia está reduzida. **Testar navegação** permite usar links, menus e botões normalmente. Na prévia curta do celular, menus abertos podem ser rolados dentro da área disponível. A visualização ampliada continua disponível para navegação.

O trecho “Nosso olhar” da Bambilu pode vir do conteúdo padrão do modelo, sem bloco cadastrado. Clicar nele abre um formulário com os valores exibidos. Apenas selecionar não altera o rascunho: o bloco passa a ser configurado quando um campo muda. Sua renderização é única e o controle de visibilidade passa a ser respeitado.

As páginas são listadas em painéis com nome, endereço e indicação de inclusão na próxima publicação. Cada painel pode ser expandido ou recolhido. O botão azul **Criar nova página** abre a nova página e seleciona seu título para edição. O estado vazio orienta por onde começar. Recolher mantém os dados digitados; excluir continua exigindo confirmação. Limites, orientações de imagem/texto, permissões e publicação manual permanecem aplicáveis.

Selecionar uma área e alternar modos são ações locais do editor. Não salvam nem publicam dados. Produtos continuam vindo do catálogo; clicar em um produto abre sua área no catálogo do editor.

## Validação

- TypeScript aprovado.
- 22 cenários de regressão em computador e celular, incluindo seleção nos seis modelos, alvos específicos, galeria, links, navegação em outra página, alteração de endereço, criação/recolhimento/exclusão de páginas, salvamento/publicação com dados fictícios, edição ao vivo, histórico, formatação, busca e zoom. O caso de imagem de fundo no celular foi repetido com um clique real corrigido pela escala do iframe, pois a imagem fica atrás da camada de composição.
- Dois cenários da Bambilu aprovados com API e conta fictícias: seleção do trecho padrão e preservação das orientações/ajuste do banner.
- Quatro cenários públicos da Bambilu aprovados: banner, composição, fotos, variações, ofertas, busca, menu e gestos.
- As verificações de seleção confirmam que a revisão salva e o conteúdo publicado não são alterados sem salvar/publicar.

Evidências locais em [qa/click-editing-pages-20261107](qa/click-editing-pages-20261107): [seleção de área na Bambilu](qa/click-editing-pages-20261107/local-bambilu.png), [edição de página](qa/click-editing-pages-20261107/local-pages-desktop.png) e [celular](qa/click-editing-pages-20261107/local-selection-mobile.png).

## Publicação

Release `cad27d6` enviada à main e publicada pelo procedimento oficial com alvo `web`. Build Linux e TypeScript aprovados, `DEPLOY_DONE`, API pronta, site HTTP 200, logs sem erros fatais e seis contêineres saudáveis. Os 15 arquivos de interface correspondem ao commit, a imagem em execução corresponde ao build e o ambiente foi preservado. Nenhum rollback necessário.

A interface realmente publicada passou pela conferência em 1440 × 1000, 1920 × 1080 e 390 × 844 px. Seleção do conteúdo padrão e da foto, foco no campo, atualização imediata, aviso de rascunho, botão azul, criação de página, expansão/recolhimento e preservação de valores aprovados. Sem overflow horizontal ou erros JavaScript. A conferência usa uma API local fictícia interceptando todas as chamadas de produção; não grava dados reais.

Os dados públicos da loja permaneceram iguais aos anteriores ao deploy, desconsiderando apenas assinatura e expiração dos links de mídia. A seleção e as edições feitas durante os testes também não alteraram a revisão salva nem a publicação da base fictícia.

Evidências: [resultado no navegador](qa/click-editing-pages-20261107/production-editor-validation.json), [verificação do host](qa/click-editing-pages-20261107/production-host.json), [páginas no computador](qa/click-editing-pages-20261107/production-pages-desktop.png), [tela ampla](qa/click-editing-pages-20261107/production-pages-wide.png), [seleção no celular](qa/click-editing-pages-20261107/production-selection-mobile.png) e [páginas no celular](qa/click-editing-pages-20261107/production-pages-mobile.png).

Recuperação: `/opt/zuno/deploy_backups/pre-cad27d6-20261107163121.tgz`, `/opt/zuno/deploy_backups/db-pre-cad27d6-20261107163121.sql.gz`, `/root/.env.zuno.pre-cad27d6-20261107163121` e imagem `zuno-zuno-web:rollback-20261107163121`. Pacote exato em `/opt/zuno/deploy_backups/release-cad27d6.tgz`, SHA-256 `5c6023135e7f8fc2835dea3363b371df9a80bf6aa4eebfcc9e74861b28cf530f`. Log: `/var/log/vorix-deploy-cad27d6-20261107163121.log`.

O registro de produção é enviado em commit posterior de documentação. A aplicação publicada corresponde à release `cad27d6`.
