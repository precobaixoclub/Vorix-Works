# QA de catálogo em massa — 27/10/2026

Resultado final: aprovado. Execução local, banco PGlite efêmero e contas `.invalid`; nenhuma escrita em produção, merge ou deploy.

| Verificação | Resultado |
| --- | --- |
| Backend completo (`node scripts/test-backend.mjs`) | 4.236 aprovados, 2 ignorados, 0 falhas; 4.238 testes |
| Integração final de catálogo (`node --test tests/catalog-bulk.test.mjs`) | 24/24, incluindo conexão transacional de autorização e pool de uma conexão |
| Web (`npm --prefix web test`) | 203/203, 28 arquivos |
| E2E (`playwright.catalog-bulk.config.ts`) | 4/4; `.last-run.json`: passed, failedTests vazio |
| Typecheck | Backend e web aprovados |
| Build | Backend e Next.js aprovados |
| Architecture check | Aprovado, incluindo contratos, isolamento e registry de templates |
| Catálogo grande | 10 mil produtos; página limitada a 50 itens (83 ms na última execução local; não é benchmark de produção) |
| Arquivo grande | Parser de CSV com 50 mil linhas; rejeição de 50.001; processamento em lotes e preview paginado verificados |

A primeira execução completa encontrou ausência do binário local de FFmpeg na instalação isolada. Após restaurar a dependência, as suítes afetadas passaram e a suíte completa foi repetida sem falhas. A última alteração de conexão/taxonomia foi revalidada nos 24 testes de catálogo e no E2E completo.

O E2E exercita upload, sugestão de mapeamento para `Cod Produto`/`Valor venda`, validação, preview com linha inválida, relatório, confirmação, progresso/conclusão, seleção de produto, edição em massa e download XLSX. Há asserções de ausência de overflow horizontal no catálogo e no diálogo, em todos os quatro tamanhos.

| Largura | Catálogo | Preview |
| --- | --- | --- |
| 390 px | [Imagem](390px-catalog.png) | [Imagem](390px-preview.png) |
| 768 px | [Imagem](768px-catalog.png) | [Imagem](768px-preview.png) |
| 1024 px | [Imagem](1024px-catalog.png) | [Imagem](1024px-preview.png) |
| 1440 px | [Imagem](1440px-catalog.png) | [Imagem](1440px-preview.png) |

Para reproduzir, consultar [operações de catálogo](../../operations/catalog-bulk-operations.md). O fixture local deve estar ativo antes do Playwright; a configuração inicia apenas o servidor Next.js.
