# Vorix Website Builder — entrega dos modelos premium

19/10/2026, America/Sao_Paulo. Implementação local de Nexus, Aura e Pulse, com conteúdo centralizado, configurações independentes e publicação explícita. **Sem push e sem deploy nesta rodada.**

## Revisão visual

[Comparar os três modelos lado a lado](qa/website-builder/comparison.html) · [Imagem da comparação](qa/website-builder/comparison.webp) · [Auditoria KEEP/REFINE/REWORK/REMOVE](website-builder-premium-audit.md)

| Modelo | Direção | Computador | Tablet | Celular | Produto |
| --- | --- | --- | --- | --- | --- |
| Nexus | Grafite, fotografia dominante, tipografia ampla, grade técnica e cartões com profundidade | [Home](qa/website-builder/nexus-desktop.webp) | [Tablet](qa/website-builder/nexus-tablet.webp) | [Home](qa/website-builder/nexus-mobile.webp) | [Desktop](qa/website-builder/nexus-product.webp) / [mobile](qa/website-builder/nexus-product-mobile.webp) |
| Aura | Editorial claro, tipografia serifada, composição assimétrica e catálogo limpo | [Home](qa/website-builder/aura-desktop.webp) | [Tablet](qa/website-builder/aura-tablet.webp) | [Home](qa/website-builder/aura-mobile.webp) | [Desktop](qa/website-builder/aura-product.webp) / [mobile](qa/website-builder/aura-product-mobile.webp) |
| Pulse | Contraste forte, hero comercial em blocos, categorias visíveis e descoberta rápida | [Home](qa/website-builder/pulse-desktop.webp) | [Tablet](qa/website-builder/pulse-tablet.webp) | [Home](qa/website-builder/pulse-mobile.webp) | [Desktop](qa/website-builder/pulse-product.webp) / [mobile](qa/website-builder/pulse-product-mobile.webp) |

Evidências do produto: [galeria](qa/website-builder/desktop-gallery.webp), [editor](qa/website-builder/desktop-editor.webp), [prévia com dados próprios de fixture](qa/website-builder/desktop-customer-preview.webp), [troca de modelo](qa/website-builder/desktop-template-switch.webp), [recuperação como rascunho](qa/website-builder/desktop-recovery-draft.webp). As mesmas telas possuem capturas mobile no diretório de evidências.

As miniaturas da galeria são capturas dos renderizadores reais. As oito fotografias originais foram geradas com a ferramenta integrada de imagem; [prompts, ferramenta e caminhos](qa/website-builder/generated-assets.json). Não há dependência de imagens de outro cliente. As demos públicas usam somente produtos fictícios e ficam fora da indexação.

## Comportamento entregue

`Site → Modelos` reúne demonstração interativa, miniaturas desktop/mobile, prévia com o catálogo do próprio cliente, personalização e publicação com confirmação. A prévia possui larguras de computador, tablet e celular, navegação por produtos, categorias e páginas internas. Abrir uma prévia não salva nem publica.

O cadastro de produtos continua sendo a única fonte. Marca, contatos, textos, imagens, páginas e SEO são compartilhados. Cada modelo guarda seu tema, composição, hero, produto destacado e ordem/visibilidade/estilo das seções. A troca Nexus → Aura → Pulse → Nexus preserva as configurações anteriores; não duplica produtos nem altera URLs. Seções removidas não reaparecem ao recuperar configurações antigas.

O editor existente continua com branding, cores/fontes controladas, cabeçalho, aviso, banners desktop/mobile, seções, arrastar/ordenar por botões, desfazer/refazer, páginas, catálogo, filtros, rodapé, contatos, SEO e domínio. Os controles respeitam as capacidades de cada modelo. O retorno aos modelos anteriores permanece disponível na galeria.

Somente owner/admin publica; editor salva e viewer consulta. Tenant, workspace, entitlement, propriedade das imagens e revisão otimista são verificados na API, inclusive para imagens de configurações inativas. A resposta pública contém somente a apresentação ativa; não expõe configurações privadas dos outros modelos nem a publicação anterior.

O registro canônico e versionado concentra metadados, tokens, seções e capacidades. O mapa de renderizadores concentra a resolução visual. A versão suportada é 1; versões desconhecidas são recusadas. Adicionar outro modelo exige seus metadados/renderizador, sem reconstruir editor, catálogo ou persistência. Migração automática entre versões futuras não foi criada.

## Publicação, recuperação e compatibilidade

Rascunho e publicado continuam separados. A publicação anterior pode ser recuperada como rascunho, sem alterar o site público. Recuperar um modelo antigo preserva as configurações mais recentes dos outros modelos, inclusive alterações ainda não salvas na tela. Há teste específico desse comportamento.

A migration aditiva [0169](../db/migrations/0169_site_template_publication_recovery.sql) acrescenta a publicação anterior e autoria de edição/publicação. Não altera conteúdo nem troca o modelo de sites existentes. Foi validada nos bancos descartáveis, incluindo aplicação e repetição idempotente. **Não foi aplicada em produção.** A implantação futura precisa executar o fluxo oficial de migrations antes de iniciar a API desta versão.

## Validação

| Verificação | Resultado |
| --- | --- |
| Regressão selecionada do backend | 428 testes aprovados em 45 arquivos, nenhuma falha ou omissão. Inclui permissões, produtos, sites, comercial e os testes novos. Não representa execução de toda a suíte do backend. |
| Foco Website Builder, API, mídia e publicação | 47 testes aprovados, nenhuma falha. Inclui 8 testes específicos novos da API. |
| Frontend | 154 testes aprovados em 20 arquivos, nenhuma falha. |
| Navegador — regressão completa | 35 aprovados, zero falhas, uma omissão intencional: a matriz de larguras executa uma única vez no projeto desktop. API/JWT/Next.js/PostgreSQL reais com fixtures controladas. |
| Navegador — recuperação após revisão final | 7 aprovados, zero falhas, uma omissão intencional da matriz duplicada. |
| Responsividade | 24 verificações: três modelos em 320, 360, 375, 390, 430, 768, 1024 e 1440 px, sem overflow horizontal ou erros JavaScript na matriz. |
| Acessibilidade revisada | Um h1 por home, controles nomeados, rótulos de campos, alt das imagens, menu por teclado, foco visível e reduced motion. Contraste do CTA: Nexus 15,55:1; Aura 12,50:1; Pulse 16,41:1. |
| Arquitetura | 49 contratos, regras de isolamento e paridade do registro aprovados. |
| Backend build/typecheck | Aprovado por `npm run test:website-builder`, que executa o build TypeScript. |
| Frontend build/typecheck | Build Next.js de produção e `tsc --noEmit` aprovados após a revisão final. |

Desempenho revisado: imagens WebP, versões de hero para celular, dimensões reservadas, prioridade somente no hero e lazy loading no catálogo. Uploads do site aplicam orientação, removem metadados e limitam resolução a 1920 px. Sem biblioteca nova de animação, vídeo automático ou WebGL. Isso é uma revisão estrutural e visual; não é uma pontuação Lighthouse nem certificação WCAG completa.

[Matriz responsiva](qa/website-builder/responsive-metrics.json) · [Revisão de acessibilidade e tamanhos dos assets](qa/website-builder/accessibility-performance.json) · [Manifesto das capturas](qa/website-builder/screenshots.json)

Os testes usam bancos e contas fictícios, não efetuam cobrança, não acessam Google e não modificam produção. O container PostgreSQL descartável é encerrado e removido pelo executor.

## Repetição

```powershell
npm.cmd run test:website-builder
npm.cmd --prefix web test
npm.cmd --prefix web run build
npm.cmd --prefix web run typecheck
npm.cmd run architecture:check
$env:WEBSITE_BUILDER_QA='1'
node scripts/sites/test-builder-browser.mjs
Remove-Item Env:WEBSITE_BUILDER_QA
```

O teste de browser exige Docker/PostgreSQL e Chrome/Playwright disponíveis. Usa somente sua fixture descartável. Enquanto esse executor mantém as portas locais 3390/3391 abertas, a revisão adicional pode ser repetida com `node scripts/sites/audit-template-accessibility.mjs`; o script verifica o escopo de fixture antes de abrir os previews. As miniaturas são atualizadas a partir das capturas reais com `node scripts/sites/build-template-thumbnails.mjs`.

## Campos de aceite solicitados

```text
EXISTING_WEBSITE_BUILDER_AUDITED = PASS
CONTENT_TEMPLATE_SEPARATION = PASS
TEMPLATE_REGISTRY = PASS
TEMPLATE_VERSIONING_PREPARED = PASS
MULTIPLE_TEMPLATE_CONFIGS_PER_SITE = PASS
ACTIVE_TEMPLATE_MODEL = PASS
SWITCH_WITHOUT_CONTENT_LOSS = PASS
SWITCH_WITHOUT_TEMPLATE_CONFIG_LOSS = PASS
DRAFT_PUBLISHED_SEPARATION = PASS
TEMPLATE_GALLERY = PASS
INTERACTIVE_DEMOS = PASS
PREVIEW_WITH_CUSTOMER_DATA = PASS
RESPONSIVE_PREVIEW = PASS
EDITOR = PASS
SECTION_EDITOR = PASS
SECTION_REORDER = PASS
BRANDING_EDITOR = PASS
PRODUCT_SOURCE_SHARED = PASS
SEO_PRESERVED_ACROSS_TEMPLATES = PASS
URLS_PRESERVED_ACROSS_TEMPLATES = PASS
TENANT_ISOLATION = PASS
RBAC = PASS
NEXUS = PASS
AURA = PASS
PULSE = PASS
NEXUS_DESKTOP_SCREENSHOT = docs/qa/website-builder/nexus-desktop.webp
NEXUS_MOBILE_SCREENSHOT = docs/qa/website-builder/nexus-mobile.webp
AURA_DESKTOP_SCREENSHOT = docs/qa/website-builder/aura-desktop.webp
AURA_MOBILE_SCREENSHOT = docs/qa/website-builder/aura-mobile.webp
PULSE_DESKTOP_SCREENSHOT = docs/qa/website-builder/pulse-desktop.webp
PULSE_MOBILE_SCREENSHOT = docs/qa/website-builder/pulse-mobile.webp
TEMPLATE_GALLERY_SCREENSHOT = docs/qa/website-builder/desktop-gallery.webp
EDITOR_SCREENSHOT = docs/qa/website-builder/desktop-editor.webp
TEMPLATE_SWITCH_TEST = PASS
SHARED_CONTENT_TEST = PASS
MOBILE = PASS
ACCESSIBILITY = PASS (escopo de revisão descrito acima)
PERFORMANCE_REVIEW = PASS (revisão estrutural, sem alegação de benchmark)
TYPECHECK = PASS
TESTS = PASS
BUILD = PASS
BACKEND_CHANGED = YES
MIGRATION_CREATED = YES (0169)
NEW_COMMIT_SHA = informado na entrega final e consultável com git log -1 --format=%H
DEPLOYED = NO
REMAINING_BLOCKERS = nenhum para a implementação e revisão local; deploy fora desta etapa
```

## Fechamento

Validação concluída. Foram organizadas 31 capturas, a comparação dos três modelos e os manifestos. O commit local reúne implementação, testes, migration, assets e documentação. Seu SHA consta na mensagem final e pode ser consultado com `git log -1 --format=%H -- docs/website-builder-premium-report.md`. Nenhum push ou deploy foi executado. A produção permanece na versão anterior.

Não há bloqueio técnico conhecido para revisar esta entrega local. Acessibilidade e desempenho têm o escopo de revisão declarado acima; não foi feita certificação completa ou medição em tráfego de produção. A implantação futura precisa aplicar a migration 0169.
