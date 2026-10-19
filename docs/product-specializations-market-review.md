# Produtos por segmento — veículos e imóveis

Revisão de 19/10/2026, America/Sao_Paulo. Implementação integrada ao cadastro de produtos, ao catálogo do Vorix Site, às oportunidades e às propostas. Site e Commerce continuam no mesmo produto.

## Referências e escolhas

A seleção de campos considera os guias oficiais de [venda de veículos da Webmotors](https://www.webmotors.com.br/wm1/seu-bolso/como-vender-um-carro), os [filtros de compra da Webmotors](https://www.webmotors.com.br/wm1/seu-bolso/compar-carro-webmotors-app), o [guia de venda de imóveis do QuintoAndar](https://www.quintoandar.com.br/guias/como-vender/como-vender-um-imovel/) e o [cadastro de imóveis para aluguel do QuintoAndar](https://www.quintoandar.com.br/guias/como-alugar/anunciar-no-quintoandar-em-3-passos/). São referências de organização e informações relevantes, sem copiar identidade visual, anúncios ou dados de clientes.

| Tipo | Campos e comportamento |
| --- | --- |
| Geral | Produtos e serviços existentes, preço, cobrança, estoque opcional, fotos, descrição e especificações da categoria. |
| Vestuário | Material, coleção, gênero, tamanhos/cores, combinações, preços e estoque por combinação. Fluxo existente preservado. |
| Veículos | Categoria, marca, modelo, versão, carroceria, fabricação/modelo, quilometragem, combustível, transmissão, cor, portas, lugares, motorização, cilindrada, potência, tração, condição, cidade/UF, final da placa e código FIPE opcional. |
| Condições do veículo | Único dono, blindagem, IPVA, licenciamento, leilão, sinistro, troca, financiamento e opcionais. Cada resposta pode ser Sim, Não ou Não informado; ausência não é convertida em Não. |
| Imóveis | Casa, casa em condomínio, sobrado, apartamento, studio/kitnet, terreno, sala/loja, galpão ou imóvel rural. Venda ou aluguel mensal, disponibilidade, endereço, áreas, cômodos, vagas, pavimentos/andar, construção, mobília, condição, orientação solar, características e condomínio. |
| Despesas do imóvel | Valor de venda ou aluguel, condomínio mensal e IPTU com escolha explícita de periodicidade mensal/anual. Despesas não são somadas silenciosamente ao aluguel. |

O formulário começa com **O que você vai cadastrar?**. A escolha mostra a ficha correspondente e uma seção de localização. Dados de uma família não são salvos em outra. Durante a edição, voltar à família anterior recupera seu rascunho ainda não salvo.

Motos não mostram portas, carroceria, lugares ou blindagem. Terrenos não mostram quartos, suítes ou área construída. Apartamentos usam área útil/total e andar; casas também admitem área construída e terreno. Imóveis não residenciais não pedem quartos ou mobília. Campos incompatíveis também são removidos no backend, antes da validação.

Marca/modelo são obrigatórios para veículos. Imóveis exigem cidade, UF e ao menos uma área aplicável ao subtipo. O formulário direciona a pessoa à seção pendente. Quilometragem zero é válida. Ano do modelo não pode preceder o de fabricação; suítes não podem superar quartos. Fotos passam de seis para até trinta por produto, mantendo upload com propriedade do tenant e limite de 5 MB por arquivo.

## Catálogo, privacidade e negociação

- O site apresenta fichas com nomes legíveis, unidades e valores formatados. Casas mostram localização e características; aluguel aparece por mês. Não há impressão de objetos ou enums técnicos.
- A busca inclui marca/modelo, cidade e bairro. Filtros de veículos cobrem categoria, marca/modelo, combustível, transmissão, ano e quilometragem; imóveis têm tipo, finalidade, cidade/bairro, quartos, vagas e área. Ambos têm preço. Dados desconhecidos não satisfazem limites numéricos.
- Endereço exato começa oculto. A resposta pública inclui somente bairro, cidade e UF; rua, número e complemento exigem autorização explícita no cadastro. CEP e anotações internas nunca entram nessa resposta, inclusive quando o endereço está liberado.
- Disponibilidade imobiliária substitui controle de estoque por quantidade. Vendidos, alugados ou indisponíveis deixam o catálogo e não entram em novas negociações. Reservados permanecem identificados no catálogo. A atualização de situação é manual; fechar uma oportunidade não a altera automaticamente.
- Cada veículo e imóvel tem cadastro próprio, sem grade de tamanho/cor. A troca de um produto existente com combinações por essas famílias é bloqueada para preservar negociações e estoque.
- Cada imóvel usa uma finalidade por cadastro. Aluguel força cobrança mensal e venda usa pagamento único. O preço e um resumo seguro da ficha são preservados no item da oportunidade e na proposta, mesmo após mudanças no cadastro. A criação manual de proposta também valida disponibilidade e finalidade; edição e nova versão mantêm o snapshot existente. Condomínio/IPTU não viram cobranças adicionais automáticas.

Código FIPE é informativo e manual. Não foram implementados consulta externa de preço, preenchimento automático de CEP, validação de documentos de propriedade, financiamento, checkout, pagamento ou frete. Nenhuma integração Google real, cobrança real ou cadastro de teste em banco de cliente é necessário para esta entrega.

## Persistência e validação

As fichas usam o JSONB de detalhes já existente, sem migration nova e sem alterar migrations aplicadas. A suíte padrão inclui `tests/product-specializations.test.mjs`. Testes de navegador usam o PostgreSQL descartável e o servidor controlado de fixtures, com contas `.invalid`, JWT normal e faturamento sandbox.

Para repetir os testes de navegador, após `npm run build`, definir `PRODUCT_VERTICALS_QA=1` e executar `node scripts/sites/test-builder-browser.mjs`. São testados o fluxo existente e os novos cadastros em 1440×1000 e 390×844; o executor encerra a fixture e remove seu próprio banco descartável.

| Verificação | Resultado |
| --- | --- |
| Integração de produtos/site/especializações | 49 aprovados; zero falhas. Inclui API de proposta manual, edição/versão, isolamento e projeção pública. |
| Regressão selecionada do backend | 403 aprovados em 42 arquivos; zero falhas. Inclui CRM, estoque, propostas, faturamento, soluções e uploads. |
| Frontend | 143 aprovados em 19 arquivos; zero falhas. |
| Navegador integrado | 28 aprovados; zero falhas, em computador e celular. |
| Repetição após os últimos ajustes visuais | 4 aprovados; zero falhas. Aviso de validação corrigido e situação do imóvel no cartão. |
| Builds e tipos | Backend, build de produção do frontend e typecheck aprovados. |
| Contratos/arquitetura | 49 contratos consistentes e verificações de isolamento aprovadas. |
| Limpeza | PostgreSQL descartável encerrado e removido pelo executor. |

Não foi executada a suíte integral do backend nesta entrega; a regressão acima é a seleção pertinente aos fluxos afetados. [Capturas verificadas no navegador](qa/product-specializations/README.md). Logs locais: `tmp/product-verticals-focused.log`, `tmp/product-site-regression.log`, `tmp/product-verticals-web-unit.log`, `tmp/product-verticals-web-build.log` e `tmp/product-site-architecture.log`.
