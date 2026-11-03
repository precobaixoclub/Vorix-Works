# Vorix — nova home institucional

Entrega para revisão local em 03/11/2026. Prévia: <http://localhost:3401>. Após essa entrega, o usuário autorizou explicitamente o commit e o deploy de todas as alterações em produção. Este relatório preserva os resultados da revisão local anterior à publicação.

## 1. Estratégia e auditoria

A primeira dobra apresenta o Vorix como sistema operacional comercial para empresas que vendem por conversa. Em seguida, a página explica os quatro produtos, a jornada comercial e o contexto do cliente antes de detalhar recursos e contratação. Alterna fundos escuros e claros, usa roxo com moderação e preserva a marca vetorial oficial.

A home anterior usava `LandingSections`, `ProductShowcase`, `SiteProductSection` e `PricingSection`, com linguagem e demonstrações centradas principalmente em Conversas e Meetings. O redesign reutiliza o mesmo Next.js 16 / React 19 / TypeScript, fontes Inter e Instrument Sans, ícones Lucide, componentes Radix, autenticação, analytics e catálogo comercial. Não cria outro frontend.

Os screenshots anteriores foram auditados. As telas de Meetings anteriormente ilustrativas foram substituídas por capturas dos componentes reais atuais. Foram comparados hierarquia, respiro, navegação e destaque do produto com [Linear](https://linear.app) e [Attio](https://attio.com), sem copiar seus assets, textos ou marca.

## 2. Estrutura final

1. Header com menu visual dos quatro produtos, acesso à plataforma e menu mobile.
2. Hero com posicionamento, cadastro existente, demonstração navegável e dashboard real.
3. Quatro benefícios: conversa, operação integrada, produtividade e controle.
4. Conversas, Meetings, Marketing e Sites & Commerce, com telas reais e condições de disponibilidade.
5. Jornada: cliente chama → atendimento → contato → oportunidade → proposta → aceite → faturamento → venda.
6. Cliente no centro e comparação entre informação espalhada e operação conectada.
7. Pessoas e equipes, com fotografias profissionais licenciadas.
8. Recursos agrupados e automações com afirmações limitadas ao que existe.
9. Indicadores com captura real do painel de resultados.
10. Contextos de uso e integrações com status explícitos.
11. Condições comerciais vindas do catálogo oficial.
12. Perguntas frequentes, contato comercial e footer completo.

## 3. Implementação

Entrada: `web/app/page.tsx`. Estilos exclusivos da home: `web/app/home.css`.

Componentes em `web/components/public/home/`:

- `HomeHero`: composição inicial, captura prioritária e quatro atalhos.
- `EcosystemSections`: benefícios, produtos, jornada, contexto, pessoas, recursos e indicadores.
- `CommercialSections`: integrações, usos, preços, FAQ e convite final.
- `ProductDemo`: galeria em diálogo, quatro abas, navegação por teclado, Escape e retorno do foco.
- `MarketingImage`: AVIF/WebP locais, `srcset`, dimensões reservadas, carregamento sob demanda.
- `content`: conteúdo estruturado dos produtos, jornada e recursos.

`PublicHeader` e `PublicFooter` receberam a variante `appearance="home"`. As demais páginas continuam usando a variante padrão. `web/features/public-site/home.ts` impede a exibição de preços de referência ou não confirmados. O proxy libera somente o novo prefixo de assets `/marketing/home/`; as áreas privadas continuam exigindo sessão.

SEO: título e descrição próprios, canonical, Open Graph/Twitter local, um H1 e JSON-LD de Organization/WebSite. Sem avaliações, clientes ou métricas comerciais inventadas. Movimento respeita `prefers-reduced-motion`.

## 4. Assets e capturas reais

Biblioteca local: `web/public/marketing/home/`, organizada em `hero`, `conversas`, `meetings`, `marketing`, `commerce`, `analytics` e `people`. São 73 derivados, aproximadamente 2,05 MiB no total; o navegador baixa somente as variantes necessárias.

O [manifesto](home-redesign-assets.json) registra arquivos, dimensões, tamanhos, origem e hashes das capturas originais. A captura é reproduzível com `node scripts/public-site/capture-home-product-ui.cjs`, apontando somente para um servidor local. Ela usa `page.route` para fornecer fixtures e renderiza os componentes existentes do produto; não desenha dashboards substitutos.

| Uso na home | Captura atual | Módulo real |
|---|---|---|
| Hero | `hero/command-center` | Dashboard do workspace |
| Conversas e demonstração | `conversas/inbox` | Atendimento WhatsApp |
| Meetings e demonstração | `meetings/summary` | Resumo e decisões da reunião |
| Marketing e demonstração | `marketing/content` | Criação de conteúdo |
| Sites & Commerce e demonstração | `commerce/site` | Editor de site |
| Indicadores | `analytics/dashboard` | Painel de resultados |

Também foram preparados derivados de Kanban, transcrição, pedidos e inbox mobile para a biblioteca, sem carregá-los na home atual.

Todas as capturas são de interfaces reais com **dados demonstrativos autorais**, não de clientes. Nomes, conversas, números e resultados são exemplos. E-mails usam `demonstracao.invalid`; telefones exibidos foram sanitizados. O texto do Meetings é um exemplo escrito para demonstração, não a transcrição de uma gravação real nem evidência de execução de IA. Legendas próximas às telas tornam isso explícito.

A arte do template/produto visível dentro do editor de site já pertence à demonstração do aplicativo; sua proveniência está em `docs/qa/website-builder/generated-assets.json`. Não foi apresentada como fotografia de cliente.

## 5. Fotografias externas

Todas foram baixadas, convertidas para AVIF/WebP e servidas localmente. Uso ilustrativo de profissionais e equipes, sem afirmar que sejam clientes ou funcionários do Vorix.

| Asset | Autoria e página original | Licença |
|---|---|---|
| `people/atendimento` | [Alena Shekhovtcova — mulher usando notebook](https://www.pexels.com/photo/woman-using-laptop-in-an-office-8067778/) | [Pexels License](https://www.pexels.com/license/) |
| `people/reuniao` | [Ron Lach — profissional com headset](https://www.pexels.com/photo/man-wearing-headphones-while-using-his-laptop-9909080/) | [Pexels License](https://www.pexels.com/license/) |
| `people/equipe` | [Yan Krukau — equipe em torno do notebook](https://www.pexels.com/photo/a-team-looking-at-a-laptop-7793702/) | [Pexels License](https://www.pexels.com/license/) |

A licença foi consultada durante a preparação. Não há hotlinks de fotografias, logos de clientes, depoimentos, endereço físico ou perfis sociais inventados.

## 6. Recursos e disponibilidade

| Apresentação | Limite da afirmação |
|---|---|
| Conversas | Atendimento WhatsApp, contatos, funil, oportunidades, tarefas e propostas; sujeito ao plano e à conexão do canal |
| Meetings | Organização de reuniões, transcrição, resumo, decisões e tarefas; vínculo com contatos/oportunidades feito pela equipe |
| Marketing | Criação, calendário e organização; acesso comercial sob consulta |
| Sites & Commerce | Editor, catálogo, variações, estoque, pedidos e oportunidades |
| Faturamento | Conferência e registro comercial após aceite; não promete NF-e automática nem pagamento confirmado |
| IA | Apoio à criação e ao tratamento das reuniões, sujeito ao plano e aos créditos |

Status destacados na interface:

- Conexão/gravação Google: sujeita à homologação.
- Publicação em Instagram/Facebook/TikTok: em homologação.
- Instagram Direct: texto sujeito à configuração do canal, sem prometer todas as modalidades de mídia.
- Mercado Pago: pagamentos reais em homologação.
- Melhor Envio: cotação de frete em homologação, sem promessa de emissão de etiquetas.
- Mercado Livre, Shopee e TikTok Shop: **Beta, acesso controlado**.

Foram considerados os contratos atuais e os registros de `docs/social-publishing-homologacao.md`, `docs/marketplaces-homologacao.md`, `docs/meetings-real-customer-managed-homologation.md` e `docs/operations/production-readiness.md`. A home não promete atribuição automática entre posts e receita nem que toda reunião se vincule automaticamente ao CRM.

## 7. Condições comerciais

Consulta pública, somente leitura, ao catálogo de contratação em 03/11/2026: `priceSource=plan_versions`. Conversas começa em **R$ 149/mês** no plano START. Meetings mostra **R$ 147/mês para capacidade de gravação**, com o plano da conta cobrado à parte. A página repete essa condição junto ao preço e na nota do bloco.

Esses valores são obtidos em runtime pelo catálogo existente, não foram fixados na home. Se a fonte oficial ou a oferta não estiver disponível, a home mostra consulta comercial e oculta valores de referência. Site e configuração do ecossistema ficam sob consulta; não foi inventado um pacote dos quatro produtos usando a soma da Suite atual de dois produtos. O teste de Conversas só é mencionado se o catálogo confirmar seus dias.

CTAs preservam `/signup?plan=...`, `/precos`, páginas existentes de produto e `mailto:comercial@vorixworks.com`. Marketing não recebeu uma rota fictícia: possui seção própria e demonstração em diálogo.

## 8. Verificação

| Check | Resultado |
|---|---|
| Build web otimizado | PASS — `npm run build -- --webpack`, diretório local isolado |
| TypeScript web | PASS — `npm run typecheck` |
| Testes web existentes + novos | PASS — **248 testes em 34 arquivos** |
| Arquitetura | PASS — `npm run architecture:check`, incluindo build backend, 49 contratos e isolamentos |
| ESLint no código TS/TSX alterado da home | PASS — ESLint 9.39.1 + typescript-eslint 8.46.3, configuração recommended temporária; sem acrescentar dependências ao produto |
| Formatação e sintaxe | Prettier aplicado; `node --check` nos scripts e `git diff --check` |
| Browser smoke | PASS — **360, 390, 430, 768, 1024 e 1440 px** |
| Acessibilidade automática | Axe 4.10.3, WCAG A/AA e 2.1 AA: sem violações nas verificações registradas de home, demonstração e menu mobile |

O repositório não possuía script ou configuração de lint web. A checagem ESLint foi executada isoladamente sobre os arquivos desta entrega, sem impor configuração nova ao restante do produto.

O smoke verifica resposta HTTP, um H1, SEO, os quatro produtos, oito etapas, CTAs, fragmentos, rotas reais, proteção de páginas privadas, menu desktop/mobile, foco, Escape, abas por teclado, FAQ, imagens decodificadas, carregamento sob demanda, movimento reduzido, ausência de erros JavaScript e de respostas inesperadas com erro.

Não houve rolagem horizontal nas seis larguras. Os deslocamentos de layout observados no smoke ficaram entre 0 e 0,032, abaixo de 0,1. Os arquivos das imagens efetivamente selecionadas somam aproximadamente **119 KiB no mobile** e **143 KiB no desktop**; isso não representa o peso total de JavaScript/CSS/fontes. São medições locais de revisão, não Core Web Vitals de produção. A verificação automática de acessibilidade não substitui avaliação humana completa.

Evidências: [smoke](../qa/home-redesign-20261103/browser-smoke.json) e [acessibilidade](../qa/home-redesign-20261103/accessibility.json). Entrada do smoke: `node scripts/public-site/browser-smoke.mjs`; é possível definir `VORIX_PUBLIC_BASE_URL` e `VORIX_PUBLIC_EVIDENCE_DIR`, sempre usando localhost.

## 9. Capturas para revisão

| Largura | Página completa | Primeira tela | Produtos |
|---|---|---|---|
| 390 px | [Home](../qa/home-redesign-20261103/home-390.png) | [Hero](../qa/home-redesign-20261103/hero-390.png) | [Produtos](../qa/home-redesign-20261103/products-390.png) |
| 768 px | [Home](../qa/home-redesign-20261103/home-768.png) | [Hero](../qa/home-redesign-20261103/hero-768.png) | [Produtos](../qa/home-redesign-20261103/products-768.png) |
| 1440 px | [Home](../qa/home-redesign-20261103/home-1440.png) | [Hero](../qa/home-redesign-20261103/hero-1440.png) | [Produtos](../qa/home-redesign-20261103/products-1440.png) |

## 10. Limite desta entrega

Implementação institucional, assets, testes e evidências preparados para revisão visual. Nenhuma alteração nos domínios de CRM, Meetings, Marketing, pedidos, estoque, marketplaces ou cobrança. A entrega inicial da prévia ocorreu sem commit, push ou deploy; a publicação foi autorizada posteriormente pelo usuário. A prévia usa um snapshot local do catálogo oficial e não grava eventos ou dados de teste na produção.
