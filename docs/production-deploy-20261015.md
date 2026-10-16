# Vorix — atualização de produção de 15/10/2026

Pedido autorizado: “faça comit e deploy de tudo o que tem local”. Publicação concluída e verificada por volta de 23:06, America/Sao_Paulo. Os logs do servidor usam UTC de 16/10.

```text
DEPLOYED = YES
APPLICATION_REVISION = 3af6255f242823d8ebc80ddb0958e7024e62f812
GIT_MAIN_UPDATED = YES
GIT_FEATURE_BRANCH_UPDATED = YES
API_HEALTH = PASS
API_READINESS = PASS
CONVERSATIONS_WORKER_HEALTH = PASS
WEB_HTTP = 200
MIGRATIONS = 149 aplicadas, 0 pendentes
WEB_TYPECHECK = PASS
WEB_TESTS = 110 PASS
LINUX_BACKEND_RELEVANT_TESTS = 119 PASS
ARCHITECTURE_AND_49_CONTRACTS = PASS
PRODUCTION_BROWSER_SMOKE = PASS
MEETINGS_CONTRACTABLE = NO
SUITE_CONTRACTABLE = NO
MEETINGS_REAL_RECORDING_ENABLED = NO
REAL_CHECKOUT_CREATED_BY_VALIDATION = NO
REAL_PAYMENT_EXECUTED_BY_VALIDATION = NO
```

## Alterações publicadas

Os três commits locais já existentes foram enviados, por fast-forward, para `main` e `feat/meetings-foundation`:

- `9cbf475`: login e cadastro com o visual do site público.
- `4f7d069`: checkout com capacidade, pedido persistido, aplicação idempotente pelo webhook, suporte a trial no cartão e migration `0149`.
- `3af6255`: configurador encaminha plano, usuários e números ao cadastro/pagamento; Meetings/Suite mantêm o botão de contratação desabilitado enquanto o gate comercial está fechado.

Nenhum commit vazio foi criado. Este relatório e as evidências posteriores ficam em commit de documentação, sem alterar a aplicação compilada. O pacote da aplicação veio de `git archive`, preservando LF e excluindo arquivos locais ignorados. SHA-256: `f1ad1ffb579ffb0c52c0555e2e2624d334b3ae182f34994b9db4d920a2d50b4d`.

## Execução em produção

Deploy oficial em duas etapas: API/worker e migration primeiro; frontend depois. Isso permite gerar as páginas públicas com o novo catálogo já disponível, evitando cache inicial de um DTO antigo. Build do frontend com `NEXT_PUBLIC_API_URL=https://api.vorixworks.com`. Ambos os logs terminaram com `DEPLOY_DONE`, web 200, readiness `ready=true` e zero erros fatais na verificação.

Preflight: 148 migrations aplicadas, nenhum checksum divergente, apenas `0149` pendente. Não existiam os novos adicionais de Meetings ou a tabela de pedidos. Migration aplicada sem reparo de dados; verificação final confirma 149 migrations e `billing_checkout_intents` existente.

Preços e capacidades anteriores foram comparados antes/depois pela API pública: os planos e adicionais de Conversas permanecem idênticos. A migration adicionou a oferta oficial de Meetings ao catálogo: base R$147/mês com uma gravação simultânea e R$67/mês por gravação simultânea adicional. Esses preços não abrem a contratação: o gate permanece fechado. Nenhuma liberação comercial ou homologação Google foi aprovada por esta publicação.

Configuração `.env.zuno` com hash igual antes/depois em ambas as etapas. JWT, cookies seguros e gravação real desabilitada confirmados. Bancos, uploads e mídia preservados. Recorders/processamento de Meetings permanecem na homologação WSL2. Foram liberados caches não usados e pacotes temporários antigos; cinco pacotes foram removidos apenas depois de verificar por SHA-256 que tinham cópias locais idênticas. Backups e imagens de rollback foram preservados. Espaço livre final observado: aproximadamente 5,4 GB.

## Validação e limites

- Windows: frontend com 110 testes, typecheck aprovado; backend com 108 testes relevantes aprovados, typecheck, build e arquitetura aprovados.
- Linux isolado, sem segredos ou acesso aos containers de produção: typecheck, build, arquitetura/49 contratos e 119 testes aprovados, incluindo cobrança, checkout automático, webhooks, Mercado Pago com mocks, trial, cadastro e isolamento. Nenhuma falha ou teste omitido nessa seleção. A suíte completa de renderização/CLI não foi repetida nesta alteração de billing/auth.
- Builds de API, worker e frontend no servidor aprovados. API e worker saudáveis. O aviso preexistente de `production_guard` mantém o resumo do readiness como `degraded`; `ready=true`, banco e secrets manager passam. Não foi alterada essa configuração anterior.
- Browser anônimo real em desktop/mobile: páginas públicas, visual de login/cadastro, ausência de overflow e de erros JavaScript, preço do simulador e parâmetros enviados ao cadastro aprovados. Três usuários e um número: R$188. Com Meetings e duas gravações simultâneas, soma oficial exibida de R$402; contratação da Suite desabilitada. Link alternativo permite somente Conversas e não carrega gravações no pedido.
- Endpoint de checkout com corpo válido recusa acesso anônimo com 401. A navegação parou no cadastro, com campos vazios; nenhum usuário, cartão, sessão de checkout ou pagamento foi criado pela validação em produção. A integração real com cartão/provedor não foi homologada por esta rodada; o webhook e trial foram exercitados com fixtures/mocks.

Evidências, capturas, snapshots públicos e script: [qa/production-checkout-20261015](qa/production-checkout-20261015).

## Backups e recuperação

Servidor `209.97.152.212`, aplicação `/opt/zuno`. Revisão nos nomes abaixo: `3af6255f242823d8ebc80ddb0958e7024e62f812`.

- Etapa API/worker, stamp `20261016015518`: `deploy_backups/pre-<revisão>-20261016015518.tgz`, `deploy_backups/db-pre-<revisão>-20261016015518.sql.gz`, configuração em `/root/.env.zuno.pre-<revisão>-20261016015518` e imagens `rollback-20261016015518`.
- Etapa frontend, stamp `20261016020059`: mesmos padrões com `20261016020059` e imagem web `rollback-20261016020059`.
- Logs `/var/log/vorix-deploy-<revisão>-<stamp>.log`; migration em `/var/log/vorix-migrations-<revisão>-20261016015518.log`.

Nenhum rollback foi necessário. Um rollback da aplicação deve considerar as duas etapas e manter a revisão de API/frontend compatível. O script não reverte o banco. Antes de voltar a código anterior à `0149`, revisar/desativar a nova oferta de Meetings para que o catálogo não permaneça ativo em uma versão sem o novo bloqueio de compra desses adicionais; não restaurar dumps automaticamente sobre pagamentos ou dados posteriores.
