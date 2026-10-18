# Vorix — publicação de produtos, planos e contatos

18/10/2026, America/Sao_Paulo. Pedido: fazer commit e deploy de todo o conteúdo local, atualizando Git e servidor. Publicação concluída pelo procedimento oficial em `209.97.152.212`, aplicação `/opt/zuno`. Smoke final às 09:20.

```text
DEPLOYED = YES
APPLICATION_REVISION = e7ac21615465e22d01d1cc4b6e8070702617f69d
API_HEALTH = PASS
CONVERSATIONS_WORKER_HEALTH = PASS
WEB_HTTP = 200
READYZ_READY = true
MIGRATIONS = 163 aplicadas, 0 pendentes
BACKEND_TESTS = 356 PASS, 0 FAIL, 0 SKIP (40 arquivos selecionados)
FRONTEND_TESTS = 123 PASS (17 arquivos)
BROWSER_FIXTURE_TESTS = 8 PASS
CONTRACTS = 49 PASS
BUILDS_AND_TYPECHECK = PASS
PRODUCTION_BROWSER_SMOKE = PASS
MEETINGS_CONTRACTABLE = NO
CONTACT_CLEANUP_EXECUTED_IN_PRODUCTION = NO
```

## Conteúdo publicado

- `5bff824`: catálogo de produtos no menu Conversas, fotos, filtros e vitrine; quantidades nas oportunidades e alertas de falta ou risco de estoque.
- `3b6f6f7`: correção da autorização das fotos privadas na nova pasta de produtos. Upload verifica o workspace, preview recebe assinatura temporária, gravação preserva URL canônica e recusa URLs externas, traversal e fotos de outro workspace. Teste cobre upload real para storage local, leitura, limites, RBAC e isolamento entre tenants.
- `e7ac216`: preços por unidade e comparação da mensalidade na configuração de capacidade; contatos, armazenamento e automações ilimitados; telefone em destaque nos contatos; prévia e confirmação para limpeza manual de contatos que só possuem LID. A ponte Inbox → CRM aguarda um telefone real antes de criar um novo contato.

Os commits foram publicados por fast-forward em `main` e `feat/meetings-foundation`. Nenhum commit vazio foi criado. A configuração protegida `.env.zuno` manteve o mesmo hash durante os dois deploys. Os hashes dos arquivos de aplicação e migrations conferidos no servidor coincidem com os blobs canônicos do Git.

## Duas publicações verificadas

A primeira publicação, revisão `3b6f6f7`, aplicou a migration `0162`: coluna JSONB `products.image_urls`, não nula, com lista vazia por padrão. API, worker e frontend passaram pelo build e reinício, com 162 migrations aplicadas e nenhuma pendente. O smoke público passou às 09:15. Pacote `git archive` com SHA-256 `6e73813143a3ccfbfb560bb34218e336158ff9f1774ef148d9584052e6433d0e`.

Após a retomada, havia um novo commit local, `e7ac216`. Ele foi validado e publicado em seguida. A migration `0163` atualizou os limites dos planos e desativou a venda dos adicionais antigos de contatos, armazenamento, automações e pacote mensal de créditos. Não remove itens já contratados nem executa limpeza de contatos. A consulta final encontrou zero planos com esses limites inconsistentes e zero adicionais descontinuados ainda ativos. Resultado: 163 migrations aplicadas, nenhuma pendente. Pacote SHA-256 `0d63b4093308df094740e2a36f751a98180373094e5ff23e3f675458af99d1be`, conferido no destino.

## Validação e limites

- Backend em container Linux isolado, sem segredos ou banco de produção: 356 testes aprovados em 40 arquivos selecionados. Inclui cobrança, planos, contatos/LID, CRM, automações, produtos/estoque, uploads privados, relatórios, autenticação e isolamento. A suíte integral de backend/renderização não foi repetida.
- Frontend: typecheck e 123 testes aprovados; builds de produção de API, worker e site aprovados no servidor. Os 49 contratos e o isolamento de CRM, Inbox e AI Gateway passaram.
- Oito testes de navegador com backend controlado passaram: catálogo/fotos, quantidades/estoque, plano personalizado, contatos/LID, metas, créditos/capacidade, trial e relatórios. Há capturas em desktop e celular.
- Smoke anônimo em produção: páginas públicas e de autenticação, mobile sem overflow, configurador, encaminhamento ao cadastro, tratamento seguro de links inválidos e ausência de erros JavaScript. Produtos, upload de fotos, telefones e limpeza LID exigem autenticação, assim como as rotas de cobrança e automações verificadas. A tentativa anônima de limpeza retornou 401 e não alterou contatos.

`/readyz` retorna `ready=true`. O resumo continua `degraded` pelo aviso preexistente de `production_guard`; banco, secrets, estado operacional e fila passam. Esse aviso não surgiu nesta publicação. Meetings continua não contratável.

Não houve limpeza real de contatos, ativação de automação, compra, pagamento, mensagem, chamada paga de IA, login Google, Meet ou gravação real durante a validação. Os fluxos autenticados de negócio foram testados com fixtures; o smoke não operou contas de clientes.

Evidências finais e script: [qa/production-plans-20261018](qa/production-plans-20261018). Evidências da primeira publicação e da correção de fotos: [qa/production-products-20261018](qa/production-products-20261018). Logs Linux preservados também em `/root/vorix-release-plans-20261018/validation.log` e `/root/vorix-release-products-20261018/` no WSL2.

## Backups e operação

Deploy final, stamp `20261018121622` UTC:

- Código: `/opt/zuno/deploy_backups/pre-e7ac21615465e22d01d1cc4b6e8070702617f69d-20261018121622.tgz`.
- Banco: `/opt/zuno/deploy_backups/db-pre-e7ac21615465e22d01d1cc4b6e8070702617f69d-20261018121622.sql.gz`, dump e integridade verificados pelo script.
- Configuração protegida: `/root/.env.zuno.pre-e7ac21615465e22d01d1cc4b6e8070702617f69d-20261018121622`.
- Imagens anteriores: tag `rollback-20261018121622`; três gerações mantidas pelo fluxo oficial.
- Log: `/var/log/vorix-deploy-e7ac21615465e22d01d1cc4b6e8070702617f69d-20261018121622.log`, encerrado com `DEPLOY_DONE`, zero erros fatais detectados.

A primeira publicação também preservou código, banco, configuração e imagens, com revisão `3b6f6f725a8e5cf30807d618779c797267c0f34d` e stamp `20261018115312`, nos mesmos padrões de caminhos. Seu log também termina com `DEPLOY_DONE`.

O servidor terminou com aproximadamente 10,4 GB livres. Não foi necessária limpeza adicional de disco. Este relatório e as evidências formam um commit posterior de documentação, sincronizado ao servidor sem recompilar a revisão de aplicação indicada acima.
