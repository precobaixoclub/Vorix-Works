# Vorix — home pública multiproduto

14/10/2026, America/Sao_Paulo. Implementação e validação locais concluídas. Direção visual textual autorizada pelo usuário: dark corporativo, verde Vorix, azul/violeta, interfaces de produto, grids e iluminação discreta.

Produção: https://vorixworks.com. Publicação posterior autorizada pelo usuário em 14/10/2026, com API, worker e frontend atualizados. Preview local em http://localhost:3003; homologação preservada. [Relatório do deploy](production-deploy-20261014.md).

## Resultado solicitado

```text
PUBLIC_HOME_REDESIGNED = PASS
DESIGN_DIRECTION = FUTURISTIC_TECH
CONVERSAS_PRESENTED = PASS
MEETINGS_PRESENTED = PASS
MARKETING_HIDDEN = PASS
PRODUCT_SELECTOR_PUBLIC = PASS
CONVERSAS_PRODUCT_PAGE = PASS
MEETINGS_PRODUCT_PAGE = PASS
PRICING_SECTION = PASS
PRICING_CONFIG_CENTRALIZED = PASS
CONVERSAS_PRICE = BRL 149/mês — oficial
MEETINGS_PRICE = BRL 147/mês — referência provisória, sem contratação
SUITE_PRICE = BRL 297/mês — referência provisória, sem contratação
PRICES_ARE_PROVISIONAL = YES — somente referências; Conversas usa preço oficial
SUITE_BUNDLE = PASS — apresentação de conversations + meetings, sem novo entitlement
COMMERCIAL_AVAILABILITY_RESPECTED = PASS
MEETINGS_NON_CONTRACTABLE_HANDLING = PASS
FAQ = PASS
SEO = PASS
MOBILE = PASS
DESKTOP = PASS
ACCESSIBILITY_BASIC = PASS
PUBLIC_CTA_ROUTES = PASS
LOGIN_SIGNUP_PRESERVED = PASS
AUTHENTICATED_APP_UNCHANGED = PASS
VISUAL_BROWSER_REVIEW = PASS
DESKTOP_SCREENSHOT = docs/qa/public-multiproduct-20261014/desktop-1440.png
MOBILE_SCREENSHOT = docs/qa/public-multiproduct-20261014/mobile-390.png
WEB_TYPECHECK = PASS
WEB_TESTS = PASS — 94 testes, 13 arquivos
WEB_BUILD = PASS
BACKEND_RELEVANT_TESTS = PASS — 37 testes
NEW_COMMIT_SHA = e8982d5f21a3b2a5b26dc184bf194690a3ebaf3d
DEPLOYED = YES — publicação inicial e1ce6b4; refinamento e configurador publicados em 8cf7ea8
REMAINING_BLOCKERS = nenhum bloqueio da implementação do site;
                     Meetings/Suite dependem de liberação comercial e ofertas oficiais.
```

## Auditoria de preços e contratação

```text
CURRENT_CONVERSAS_PRICE = BRL 149/mês
CURRENT_MEETINGS_PRICE = BRL 147/mês — provisório
CURRENT_SUITE_PRICE = BRL 297/mês — provisório
PRICE_SOURCE = Conversas: GET /v1/platform/plans -> plan_versions;
               referências: web/features/public-site/catalog.ts
EXISTING_BILLING_INTEGRATION = YES — catálogo e aquisição existentes de Conversas
PUBLIC_PRICE_HARDCODED = YES — apenas referências provisórias centralizadas;
                             preços oficiais vêm do catálogo de billing
MEETINGS_CONTRACTABLE = NO
SUITE_CONTRACTABLE = NO
```

O catálogo oficial encontrado tem Start R$149/mês, Pro R$299/mês e Business R$599/mês, em BRL. Totais anuais oficiais: R$1.490, R$2.990 e R$5.990. O toggle apresenta o total do ciclo anual de Conversas; não cria descontos nem valores anuais para Meetings/Suite. A escolha final da cobrança continua no fluxo existente do produto.

Adicionais de capacidade existentes: usuário R$39/mês, conexão WhatsApp R$79/mês, lidos do catálogo de billing. Nenhum preço por crédito de IA foi inventado.

`PUBLIC_REFERENCE_PRICES` contém os valores autorizados 197/147/297. O valor 197 não substitui o preço oficial 149 de Conversas. Quando o catálogo oficial está inacessível ou não possui metadados reconhecidos, a UI não publica uma cotação alternativa de Conversas nem ativa sua aquisição; oferece contato para confirmar condições. O fallback 197 só é referência quando a fonte oficial confirma ausência de plano configurado.

Os componentes recebem um catálogo único; preços não foram espalhados em páginas e botões. A API recebeu somente `solutions` e `priceSource` no DTO público já existente. A contratabilidade deriva do gate comercial existente, sem concessões, mudanças de disponibilidade ou nova regra de entitlement. Em versões anteriores do domínio que ainda não expõem o gate de readiness, Meetings permanece recusado para contratação.

Meetings direciona para informação/contato; Suite direciona para o comercial. Nenhum checkout de Meetings/Suite foi criado. Para ativar uma oferta futura, o catálogo central deve receber um preço oficial e uma rota de aquisição suportada, além da aprovação comercial da solução; mudar apenas um badge não habilita venda. Limites comerciais de Meetings aparecem como “a definir na oferta”, sem transformar limites internos de homologação em promessas públicas.

A Suite foi destacada com “Experiência integrada”. Não usamos “Mais vantajoso” ou desconto presumido: não existe oferta oficial do bundle e a referência 297 não comprova economia em relação a 149 + 147.

## Implementação e escopo

- Home composta por hero, selector de produtos, dois cards com interfaces, três passos, diferenciais/Core, pricing, FAQ, CTA final e footer.
- Páginas próprias: `/produtos/conversas`, `/produtos/meetings`, `/precos`. `/pricing` preservado como redirect para `/precos`.
- Header com dropdown acessível, drawer mobile, foco/Escape e “Acessar plataforma” para sessão autenticada. CTAs de Conversas apontam para `/signup?plan=START`, conforme o menor plano oficial recebido.
- Mockups em componentes reais, com nomes e dados fictícios identificados como prévia ilustrativa. Nenhuma captura antiga com Marketing ou Creative Engine utilizada.
- Paleta e responsividade em `web/app/public-site.css`; fontes existentes reutilizadas. Animações em CSS, com `prefers-reduced-motion`; nenhuma dependência adicionada para movimento.
- Metadata própria para as páginas, canonical, Open Graph/Twitter e imagem social gerada em `/public-og`.
- Proxy alterado apenas para permitir quatro rotas públicas exatas. Login/signup e proteção das rotas autenticadas preservados.
- Recorder, Google, transcrição, workers, RBAC, entitlements e lógica operacional dos produtos não foram modificados nesta rodada.

## Validação

Web: `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`; 94 testes aprovados e build otimizado concluído. Backend: build TypeScript e 37 testes relevantes aprovados em `public-product-catalog`, `pricing-capacity`, `solutions` e `billing-overview-route`. A nova suíte backend foi adicionada à lista local do executor de testes já preparada na etapa anterior; as demais alterações anteriores desse executor foram preservadas fora do commit do site.

Smoke contra o build otimizado: desktop 1440px, mobile 390px e tablet 768px, sem overflow horizontal. Verificados selector/teclado, dropdown/Escape, anchors, FAQ, pricing/ano, bloqueio comercial, produto Conversas, produto Meetings, login/signup, todos os links internos do footer, Open Graph, rotas privadas e header autenticado com fixture `.invalid`. Simulador de capacidade também aprovado, usando a API existente. Nenhuma compra, pagamento, cadastro Google ou reunião real executada.

A revisão inicial identificou e corrigiu interceptação de cliques por decoração, herança de título grande dentro do mockup, rotas públicas ainda barradas no proxy, alinhamento dos cards e recorte do monograma. A espera de teste por `networkidle` foi substituída por prontidão da página/fontes e asserts de interação, sem usar cliques forçados. Screenshots finais revisados depois dessas correções.

Evidências: [desktop](qa/public-multiproduct-20261014/desktop-1440.png), [mobile](qa/public-multiproduct-20261014/mobile-390.png), [hero desktop](qa/public-multiproduct-20261014/desktop-hero-1440.png), [hero mobile](qa/public-multiproduct-20261014/mobile-hero-390.png), [produtos mobile](qa/public-multiproduct-20261014/mobile-products.png), [pricing](qa/public-multiproduct-20261014/desktop-pricing.png), [footer](qa/public-multiproduct-20261014/desktop-footer.png), [smoke JSON](qa/public-multiproduct-20261014/browser-smoke.json).

Performance básica, uma execução local do build otimizado: CLS observado 0, LCP observado 600ms, JavaScript transferido codificado 265.853 bytes e quatro requests de fontes existentes. Hero sem elementos de imagem/vídeo pesado. Contrastes dos tokens principais contra o fundo: texto 18,17; texto secundário 8,86; verde 12,19; violeta 8,90. Trata-se de checagem local básica, não de medição de campo nem certificação integral de acessibilidade. [Métricas registradas](qa/public-multiproduct-20261014/performance-smoke.json).

Scripts de repetição, com o preview/API preparados e a fixture Vorix existente:

```powershell
node scripts/public-site/browser-smoke.mjs
node scripts/public-site/performance-smoke.mjs
```

Os scripts aceitam `VORIX_PUBLIC_BASE_URL`, `VORIX_PUBLIC_API_URL` e `VORIX_PUBLIC_EVIDENCE_DIR` e recusam hosts externos. O browser smoke permite `PUBLIC_SITE_BROWSER_PATH`; usa Chrome instalado por padrão. As credenciais de fixture presentes no smoke são públicas e fictícias, exclusivas da homologação local.

Site publicado em produção após autorização posterior do usuário. Meetings/Suite continuam sem contratação comercial; nenhuma homologação Google real foi aprovada por esse deploy.
