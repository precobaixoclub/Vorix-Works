# Vorix Website Builder — auditoria e arquitetura

19/10/2026, America/Sao_Paulo. Escopo: implementar, testar, revisar imagens e criar commit. **Não publicar no Git remoto nem fazer deploy nesta rodada.** A produção continua na versão anterior até nova autorização.

## Auditoria da implementação existente

| Área | Classificação | Decisão |
| --- | --- | --- |
| Cadastro de produtos, variantes e estoque | KEEP | Uma fonte por workspace; nenhum produto é copiado por template. Veículos e imóveis permanecem suportados. |
| `tenant_sites.draft/published` em JSONB | KEEP | Continua sendo um site, uma URL e um catálogo. Configurações visuais cabem na estrutura existente. |
| Revisão otimista, entitlement e RBAC | KEEP | Conflito de revisão continua impedindo sobrescrita; editor salva, owner/admin publica. |
| Domínio, subdomínio e prova TXT | KEEP | Nenhuma troca de endereço ao mudar o modelo. |
| Upload e propriedade da mídia | REFINE | Biblioteca reutiliza referências existentes. Imagens exclusivas de modelos inativos também passam pela verificação de tenant/workspace. Upload do site é convertido para WebP e limitado a 1920 px. |
| Conteúdo, contatos, links, branding e SEO | KEEP | Informações compartilhadas entre modelos; edição global aparece em todos. |
| Histórico local/desfazer | KEEP | Continua disponível para o rascunho, com aviso antes de abandonar alterações. |
| Publicação e recuperação | REFINE | Nova migration aditiva `0169` guarda a publicação anterior e o autor de edição/publicação. Recuperação carrega um rascunho, sem publicar automaticamente. |
| Modelos Catálogo/Institucional/Vitrine | KEEP | Sites existentes preservam sua aparência. Nenhuma migração visual automática. |
| Troca que sobrescrevia a aparência anterior | REWORK | Configurações independentes por modelo, com versão, tema, composição e ordem/visibilidade/estilo das seções. |
| Miniaturas esquemáticas do seletor | REMOVE | Substituídas por galeria com capturas dos renderizadores reais. |
| Preview em iframe | REFINE | Mesmo renderizador do site, navegação interna, computador/tablet/celular e modo de demonstração separado dos dados do cliente. |
| Seções, páginas e banners | KEEP / REFINE | Mantém adicionar, duplicar, remover, ocultar, arrastar e setas de ordenação. Controles incompatíveis com a composição premium são omitidos. |
| Renderização pública | REWORK | Primitivas compartilhadas; cabeçalhos, heros e cartões específicos de Nexus, Aura e Pulse. Identidade preservada nas páginas internas. |
| Categorias e SEO técnico | REFINE | Rotas de categoria, canonical, sitemap, robots e dados estruturados, usando somente dados públicos. |
| Carrinho/checkout | KEEP | Continua indisponível. Reutiliza formulário e consulta de produto; não cria pagamentos fictícios. |
| Analytics/pixels | KEEP | Não havia integração configurável por template. Não foi adicionado rastreamento ou script arbitrário. |

## Modelo de conteúdo e configuração

`content` é compartilhado: marca, mídia, textos, contatos, SEO, links, seções e páginas. Produtos/categorias vêm dos repositórios existentes, sempre sob tenant/workspace.

`activeTemplateId` identifica o modelo selecionado no snapshot. `templateConfigs[id]` contém `templateVersion`, `themeConfig`, `sectionConfig` e `layoutConfig`. As configurações referenciam identificadores de seções e arquivos existentes; não guardam cópias de produtos ou de conteúdo editorial. A troca materializa o layout selecionado sobre os textos compartilhados. Seções removidas não são recriadas por configurações antigas.

O snapshot publicado é separado do rascunho e tem um único modelo ativo. A resposta pública não contém configurações dos outros modelos nem a publicação anterior. Revisões antigas continuam válidas sem seleção automática de um novo modelo.

O registro canônico fica em `src/domain/sites/template-registry.json`. O frontend usa uma cópia gerada e verificada por `scripts/sync-site-template-registry.mjs --check`. Incluir outro modelo exige registrar metadados/tokens e seu renderizador específico; o editor e a persistência não precisam de novos fluxos condicionais. A versão atualmente suportada é 1; versões desconhecidas são recusadas, sem reset silencioso. Isso prepara evolução posterior, sem alegar um sistema de migração de versões que ainda não existe.

## Demos e mídia

As demos públicas em `/modelos/nexus`, `/modelos/aura` e `/modelos/pulse` são estáticas e independentes de tenants. Dados e preços são fictícios, e os envios ficam desabilitados. A opção **Visualizar com meus dados** usa exclusivamente a projeção autenticada do site atual e não salva nem publica o template explorado.

As fotografias originais foram produzidas com a skill `imagegen`, ferramenta integrada, e persistidas em `web/public/site-assets/templates/`. Prompts e caminhos constam em [generated-assets.json](qa/website-builder/generated-assets.json). Demos usam WebP, imagens de hero próprias para celular, carregamento tardio no catálogo e dimensões reservadas. Não há WebGL, vídeo automático ou biblioteca nova de animação.

O salvamento permanece explícito: **editar → salvar rascunho → visualizar → publicar**. Evita gravações concorrentes silenciosas e não altera o site público durante a configuração. A galeria permite salvar todos os modelos e exige confirmação para ativar um deles.
