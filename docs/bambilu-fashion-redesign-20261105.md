# Bambilu Kids — redesenho Fashion / Kids

Implementação visual local sobre `b80f187`, em 05/11/2026. **Sem novo deploy nesta etapa.** A comparação visual solicitada está pronta para revisão.

[Abrir comparativo interativo antes/depois](qa/bambilu-fashion-20261105/comparativo.html). A página permite alternar home/produto, largura de 390/768/1440 px e rolagem independente das capturas.

## Composição entregue

- Marca tipográfica centralizada, navegação leve, busca por ícone e menu compacto no celular.
- Hero dividido entre mensagem editorial curta e fotografia real, com CTA discreto. Campanha própria e imagem mobile passam a ser usadas quando cadastradas.
- Base off-white, verde suave, texto escuro e a cor de destaque existente da loja. Títulos em DM Serif Display local e corpo em Inter no site público.
- Home com navegação da coleção, quatro produtos em destaque, seção editorial ampla, catálogo completo, informações baseadas nos dados e contato.
- Cards sem caixas pesadas, foto em proporção 4:5, nome, preço, quatro cores e contador. As condições comerciais continuam acessíveis numa expansão própria, sem ocupar toda a vitrine.
- Fotos com `object-fit: contain`, sem zoom automático, com setas, swipe e teclado. Cores continuam usando os vínculos de fotos existentes.
- Grid regular: duas colunas em 360/390/430 px, três em 768/1024 px e quatro em 1440 px. O primeiro produto deixa de ocupar duas colunas.
- Detalhe com foto ampla, miniaturas, escolha de cor/tamanho, preços por quantidade e CTA existente, com mais espaço entre os elementos.

## Dados e limites observados

A loja publicada não possui logo, foto de campanha, categorias, Instagram ou dados públicos de ranking de vendas cadastrados. As fotos atuais são de peças em modelos adultos. Foram usadas essas imagens reais, sem atribuir uma campanha fictícia à marca.

O menu usa Coleção, Em destaque e Contato; categorias reais entram quando existem. A seção é chamada de destaque editorial, sem afirmar que os produtos são novidades ou mais vendidos. Não foram inventadas políticas de envio, trocas, segurança de compra ou prazo de atendimento. Os destaques discretos tratam apenas das cores, dos tamanhos e do contato existentes.

Preto e branco sem hexadecimal cadastrado recebem uma cor visual básica para o swatch. Nomes, valores das opções, vínculos de imagem e dados persistidos continuam iguais.

## Escopo técnico e preservação

A seleção da apresentação está centralizada em `web/features/sites/fashion-kids.ts`: aplica-se somente ao slug `bambilu-kids` quando o template configurado é `nexus`. O identificador de template persistido continua sendo Nexus; esta entrega não cadastra um novo modelo global no construtor. As outras lojas Nexus e os demais templates mantêm suas apresentações.

`FashionKids.tsx` concentra header, hero, card e composição editorial. `fashion-kids-styles.ts` contém o CSS exclusivo. O catálogo, filtros, paginação, detalhe, formulário, galeria, seleção de variação, carrinho e checkout reutilizam os componentes e fluxos existentes. `ProductCard` recebe uma opção visual compacta; o comportamento padrão dos seis templates permanece coberto pela regressão.

Nenhuma migration ou implementação de backend foi alterada. Não foram alterados produtos, preços-base, estoque, variantes, regras comerciais ou configuração de venda. A loja continua em modo **SHOWCASE**, com carrinho e checkout desabilitados. A exibição do ícone de carrinho depende da configuração comercial existente; não é mostrado um carrinho indisponível.

## Validação

- 270 testes unitários/frontend em 39 arquivos aprovados, incluindo isolamento da apresentação, imutabilidade dos dados e preservação de campanhas/links/seções configuradas.
- 10 testes Playwright aprovados: três da apresentação Fashion Kids e sete de regressão da experiência de imagens nos seis templates.
- Os três testes Fashion Kids foram repetidos após o ajuste final dos swatches e aprovados.
- Typecheck e build otimizado de produção aprovados. O build usou um diretório de saída isolado da prévia local.
- Conferência adicional com uma cópia dos 24 produtos da primeira página pública real: home e detalhe em seis larguras, 12 verificações aprovadas, sem overflow, imagens quebradas ou erros JavaScript.
- Oito verificações interativas adicionais com os dados reais: prévia de cor, condições R$ 55/R$ 50, menu mobile, busca sem resultados, swipe touch nativo, teclado da galeria, seleção de tamanho/cor e preservação do modo vitrine.
- Nenhuma requisição de negócio foi enviada pela conferência; POSTs de analytics foram interceptados no navegador. A fixture aceita somente leitura e não acessa banco.

Comandos de regressão: `npm test`, `npm run typecheck` e `npx playwright test --config playwright.product-media.config.ts`, dentro de `web/`. Build: `npm run build -- --webpack`, com `PLAYWRIGHT_TEST=1` e `SITE_BUILDER_QA_DIST_DIR=.next-site-qa-bab110` para saída isolada.

As capturas anteriores vêm da loja publicada; as posteriores usam a implementação local com uma cópia dos mesmos produtos, fotos e regras. A primeira página pública contém 24 produtos; a fixture visual foi limitada a essa cópia. O comportamento geral de paginação e dos demais templates foi preservado nos componentes existentes.

[Registro da conferência real](qa/bambilu-fashion-20261105/validation.json). [Índice das capturas](qa/bambilu-fashion-20261105/README.md).
