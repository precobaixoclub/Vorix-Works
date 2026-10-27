# Mercado Livre — evidências e entrega

Branch: feat/mercado-livre-phase1. Base: main 5d3c613. Worktree independente Vorix-mercado-livre.

## Verificações locais

- Backend específico: 48 testes aprovados com Postgres/PGlite, migrations reais e provider simulado.
- Frontend: 197 testes existentes aprovados, 27 arquivos.
- Navegador: 8 cenários aprovados em Chrome, viewports 390/768/1024/1440. Conexão, divergência, importação em lote, matching, categoria/atributos/garantia, validação/publicação, confirmação destrutiva e somente leitura. Rede simulada; nenhuma operação real em conta externa.
- Builds backend e Next.js aprovados. Typechecks aprovados.
- Arquitetura: architecture:check aprovado; 11 verificações repetidas sobre a versão final, sem falhas.
- Suíte completa de backend: 4.276 testes, 4.274 aprovados, zero falhas e dois skips existentes; 720 segundos, concorrência 2. Comando: node scripts/test-backend.mjs --test-concurrency=2.
- A primeira rodada concorria com recompilações/novos testes e não foi usada como resultado final. O teste legado de vídeo excedeu 60 segundos nessa rodada, passou isoladamente e passou na execução completa final. Os testes novos foram recompilados e reexecutados antes da rodada final.

## Cobertura dos 48 testes novos

OAuth com state de uso único e PKCE; callback com permissão revogada; credenciais cifradas e resposta sem tokens; refresh rotativo, lease concorrente e rotação incerta; isolamento de contas/listings/produtos/variantes/jobs/previews; SKU exato antes de EAN, ambiguidade sem match por nome; preview sem escrita; Product real, descrição/imagens/EAN; vínculo manual e IGNORE; stock inicial consentido e idempotente; variações reais e EAN de variação; rollback de importação; outbox e reservas; safety stock; preço local; conflito externo e resolução condicionada; divergência por variação persistente; pausa/fechamento/inexistência; 429/backoff; idempotência de jobs/publicação; publicação incerta e recuperação por correlação sem POST duplicado; interoperabilidade legacy/UP; descrição POST/PUT; condições de venda e erro condicional seguro; localização canônica de estoque; autorização em rotas e worker; auditoria e redação de logs; sync parcial recuperável; leitura de mais de mil listings.

## Evidências visuais

As imagens em marketplace-evidence/ usam dados fictícios. Há três capturas por viewport:

- connection-{390,768,1024,1440}.png
- import-{390,768,1024,1440}.png
- mapping-{390,768,1024,1440}.png

O teste verifica ausência de rolagem horizontal. A tela aplica mapeamentos salvos da categoria Vorix ao iniciar uma nova publicação.

## Commits

- d9a4042 — domínio, provider oficial e persistência aditiva.
- eafdf4e — OAuth, importação, publicação, sincronização, worker e recuperação.
- d6c3f6a — interface de contas/anúncios/importação e canais do produto.
- c0edb8e — testes, contratos, proteção de retentativas e evidências responsivas.
- Commit final desta entrega — aplicação de mapeamentos salvos na publicação e documentação operacional/QA.

## Validação real

REAL_MERCADO_LIVRE_VALIDATION = BLOCKED

Não foi fornecida uma conta explicitamente destinada e autorizada para QA. Não houve OAuth real, publicação, pausa, fechamento, alteração de preço ou de estoque em Mercado Livre. A documentação oficial e os contratos simulados não substituem homologação real.

## Integração posterior

Migration nova: db/migrations/0184_marketplace_phase1.sql. Não há alterações nas migrations existentes. 0182/0183 permanecem reservadas à integração concorrente; conferir/renumerar 0184 antes de aplicá-la caso haja colisão após o rebase.

Arquivos existentes compartilhados:

- src/interfaces/api/routes/v1/index.ts — composição das rotas novas; ponto com maior chance de conflito textual.
- src/domain/identity/identity.model.ts e access-control.ts — novas permissões e catálogo de acesso.
- src/interfaces/api/http/log-redaction.ts — redação de code/state/tokens na query de callbacks.
- web/components/products/ProductFormModal.tsx — painel de canais isolado da edição central.
- web/components/settings/SettingsShell.tsx e workspace-navigation.ts — entrada e breadcrumb de Marketplaces.
- package.json — comando do worker.

Sem alterações em Order, Checkout, Payment, Shipping, Analytics, Catalog Bulk ou nos respectivos arquivos de implementação. O estoque central existente é utilizado sem alterações em seus serviços. Risco de conflito textual moderado nos arquivos de composição/navegação compartilhados; módulos de marketplace e migration são aditivos.

## Operação

Configuração e limites detalhados em marketplace-phase1.md. É necessário preparar aplicação Mercado Livre separada de Mercado Pago, scopes/permissões e callback no DevCenter, segredos cifrados e worker separado. Full/multi-origem e tipos especializados permanecem bloqueados explicitamente. Nenhum merge, deploy ou migração de produção foi executado.
