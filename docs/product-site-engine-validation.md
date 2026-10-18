# Product Engine e Site Engine — entrega local

18/10/2026. Escopo: evolução do Product existente, Site nativo e integração comercial. Esta rodada não inclui deploy ou push. O Bambilu foi utilizado exclusivamente como referência de regras e testes; seu runtime, banco, dados, credenciais e identidade visual não foram importados.

## Implementação

O catálogo continua usando `products`, `product_variants`, `deal_items` e as portas existentes. GENERAL, APPAREL e VEHICLE compartilham preço, custo, mínimo comercial, mídia e identidade. `details` acrescenta campos tipados e extensíveis, sem criar um produto paralelo para o Site.

Categorias possuem hierarquia, imagem, slug, ordenação, status e visibilidade. Marcas possuem logo e status. Especificações aceitam texto, número, booleano e seleção, com obrigatoriedade herdada das categorias ancestrais. Definições desativadas preservam valores históricos. Fotos usam o upload e storage do Vorix, com capa, ordem, texto alternativo e imagem de combinação.

As opções geram combinações com SKU, status e saldo próprios. Preço, custo e mínimo podem herdar do produto ou receber valores específicos. O estoque agregado serve apenas para apresentação; a seleção comercial, o risco de estoque, a baixa e a restituição consideram a combinação. Movimentos aceitam IN, OUT, ADJUSTMENT, RESERVATION, RELEASE, SALE e RETURN, com chave idempotente e validação de precisão.

Variantes comerciais antigas sem opções continuam válidas para produtos legados. Ao adicionar opções a um produto, uma variante sem o mapeamento completo deixa de ser elegível para a venda ou para o catálogo público; ela não pode representar uma escolha de tamanho/cor inexistente.

O fechamento de uma oportunidade com variantes gerenciadas e sua baixa acontecem na mesma transação PostgreSQL. Saldo insuficiente reverte o fechamento e todas as baixas. Locks ordenados, restrições de saldo e registros de movimentos protegem a operação. A reabertura restitui somente o saldo efetivamente baixado. Produtos e variantes comerciais legados conservam sua semântica anterior.

Oportunidades exigem a combinação quando existem opções. Snapshots preservam preço, custo, mínimo e contexto; propostas incluem o nome da combinação e suas características. Alterações posteriores no catálogo não reescrevem propostas anteriores. A seleção está disponível tanto na criação rápida quanto no cockpit da oportunidade.

## Site e faturamento

O editor utiliza os componentes e tokens do Design System Vorix, com seções de identidade, aparência, blocos, páginas, catálogo, contato, SEO e domínio. Os modelos Catálogo, Institucional e Vitrine compartilham conteúdo e referências ao mesmo Product. Trocar modelo mantém páginas e catálogo. Salvar rascunho e publicar são operações distintas, com controle de revisão para evitar sobrescrita.

O público recebe somente produtos ativos e visíveis, categorias autorizadas, preços de venda e disponibilidade. Custos, mínimos comerciais e comissões não são publicados. Ocultar um produto ou revogar o acesso ao Site afeta também a leitura pública, sem exigir republicar o catálogo. Imagens do editor e do público recebem assinaturas temporárias pelo mecanismo existente.

Filtros, seleções e formulários ficam disponíveis depois da inicialização da interface no navegador, evitando perder escolhas feitas durante o carregamento inicial. A rota de produtos dentro do Site renderiza a página de Produtos existente, sem duplicar seu formulário ou sua lógica.

Formulários públicos criam ou reutilizam o Contact existente, com contexto de produto/variante e envio idempotente. O botão WhatsApp inclui a combinação e o endereço do produto. Não há uma entidade Customer paralela.

Site e Commerce são capacidades distintas, inicialmente desabilitadas. O Site pode ser incluído em uma nova versão de plano ou habilitado por um adicional pago existente na assinatura. Revogação explícita e kill switch continuam prevalecendo. O painel de plataforma `/admin/site-commerce` configura preços e inclusão em planos; não há preço comercial novo fixado no código. Publicar uma versão não migra contratos anteriores. Commerce permanece inativo e não possui checkout, gateway ou frete operacional nesta entrega.

Commerce possui apenas modelos de origem da venda, linhas com snapshots, transições e contratos de providers por tenant, usando referências ao SecretManager. Pedidos futuros referenciam Contact e proposta aceita; Opportunity continua sendo uma negociação, não um pedido.

## Domínios e operação futura

Sem configuração adicional, o Site publicado atende em `/s/<slug>`. `SITE_PUBLIC_BASE_DOMAIN`, configurado na API e no frontend, prepara subdomínios. Para domínios próprios, o backend exige unicidade global e prova TXT em `_vorix-site.<domínio>`; uma declaração do cliente nunca basta. A reivindicação pendente expira em duas horas e a verificação vale por trinta dias, com renovação pelo mesmo fluxo. Um domínio verificado não pode ser tomado por outro tenant por simples expiração.

O roteamento de hosts próprios no frontend exige `SITE_CUSTOM_DOMAIN_ROUTING=true` e `SITE_APP_HOST`. DNS, proxy e emissão de certificados HTTPS são etapas de infraestrutura de uma implantação futura. Nenhum registro DNS, certificado, gateway ou servidor de produção foi alterado nesta rodada.

As migrations novas são `0164`, `0165` e `0166`. Aplicação futura pelo fluxo oficial `npm run db:migrate`, após revisão operacional. Nenhuma migration anterior foi reescrita. As migrations desta rodada foram aplicadas somente em bancos descartáveis de testes.

## Validação

- Backend: **388 testes aprovados**, zero falhas e zero omitidos, em 41 arquivos relevantes a produtos, estoque, vendas, propostas, billing, autenticação, soluções, contatos e uploads. Inclui **32 cenários novos** do Product/Site, cobrindo os 22 requisitos obrigatórios e casos adicionais.
- Frontend: **123 testes aprovados**, em 17 arquivos.
- Build backend, build Next.js e verificações de tipos aprovados.
- **49 contratos** backend/frontend e verificações de isolamento arquitetural aprovados.
- Upgrade controlado de 0163 para 0166 preserva dados anteriores; repetir o migrador não aplica nada.
- Prova de navegador utiliza API real com JWT, frontend real, upload real no storage local e PostgreSQL via PGlite efêmero. Somente dados fictícios `.invalid`, sem Google, Meetings, cobrança ou frete reais.
- Navegador: **16 cenários aprovados**, em desktop e celular: catálogo/filtros, formulário contextual, produto geral, vestuário e estoque por tamanho/cor, veículo, oportunidade com combinação, editor/publicação, domínio/módulos e persistência do logo após recarregar.

Os testes de referência Bambilu foram **adaptados parcialmente**: última unidade, estoque por combinação, rollback, preço autoritativo, rascunho privado, conteúdo tipado, URLs perigosas, honeypot e estados terminais. Testes de checkout, cupons, pagamentos e frete completos ficam para Commerce; sua aprovação não é reivindicada aqui. Mapa de decisões em [product-site-reuse-audit.md](product-site-reuse-audit.md).

### Repetição

```powershell
npm.cmd run test:product-site
npm.cmd run architecture:check
```

Para a prova de navegador, iniciar em um terminal da raiz:

```powershell
node tests/fixtures/product-site-browser-server.mjs
```

Em outro terminal, no diretório `web`:

```powershell
npx.cmd playwright test --config playwright.product-site.config.ts
```

Essa fixture recusa `NODE_ENV=production`, utiliza banco efêmero, segredo JWT público exclusivo de testes e credenciais fictícias. Não apontar para banco ou contas de clientes. Chrome instalado é necessário para a prova. A configuração de QA aumenta somente o limite de conexões do socket PGlite e o orçamento de requisições; não muda limites de produção.

A configuração dedicada de Playwright utiliza Webpack no servidor de desenvolvimento para tornar a descoberta de rotas estável no workspace Windows/OneDrive. O build de produção continua usando o fluxo padrão do projeto.

Os logs completos ficam no diretório local ignorado `tmp/product-site-*`; capturas e resumos revisáveis ficam em `docs/qa/product-site-engine`. Os serviços da fixture devem ser encerrados após a prova. Este relatório distingue a validação local da homologação de infraestrutura real.

## Limites da entrega

Nenhum bloqueio de implementação identificado no escopo Product + Site + integração comercial. Permanecem para uma etapa autorizada: implantação, configuração comercial dos preços, DNS/TLS reais e Commerce transacional. O catálogo público não oferece compra online nesta rodada, mesmo que o booleano de preparação seja preenchido. Não foram importados arquivos do Bambilu para o runtime do Vorix.

O upgrade exige dados legados consistentes com o escopo tenant/workspace. Novas chaves estrangeiras recusam referências históricas incompatíveis; não excluem nem remapeiam dados automaticamente.
