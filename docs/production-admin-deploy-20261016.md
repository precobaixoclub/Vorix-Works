# Vorix — deploy do painel administrativo em 16/10/2026

Pedido: publicar todo o conteúdo local no Git e no servidor. Os dois commits de aplicação já estavam salvos localmente; foram enviados por fast-forward para `main` e `feat/meetings-foundation`.

```text
DEPLOYED = YES
APPLICATION_REVISION = 849a726339f8ce26a01f2cdc396706cf1bea974f
API_HEALTH = PASS
WORKER_HEALTH = PASS
WEB_HTTP = 200
MIGRATIONS = 153 aplicadas, 0 pendentes
BACKEND_BUILD = PASS
FRONTEND_TYPECHECK_AND_BUILD = PASS
FRONTEND_TESTS = 112 PASS
ADMIN_AND_SOLUTIONS_TESTS = 29 PASS
CONTRACTS = 49 PASS
PRODUCTION_BROWSER_SMOKE = PASS
MEETINGS_CONTRACTABLE = NO
```

## Conteúdo publicado

- `49acf9d`: painel do administrador da plataforma para conceder ou remover soluções por conta, usando a API e o RBAC existentes. Soluções ainda não comerciais recebem concessão interna.
- `849a726`: listagem administrativa com nome da conta e e-mail do responsável, com fallback quando os dados não estão disponíveis.

API, worker de Conversas e frontend foram recompilados e reiniciados pelo procedimento oficial `scripts/deploy/deploy-production.sh`, alvo `all`. O pacote integral veio de `git archive`, com SHA-256 `8e2aac21275ef5ec91fc08fc72f8d75bd50cfd3d09729b2d5e15145d982d0fa2`, conferido no destino. Os arquivos principais do backend e do novo componente foram comparados com os blobs do Git por SHA-256 depois da publicação; o código compilado da API também contém o campo novo.

## Validação e limites

Build do backend, typecheck do frontend, 112 testes do frontend e 29 testes de administração/soluções passaram. Os 49 contratos, o isolamento de runtime e o isolamento de Inbox passaram. Uma verificação adicional com dois tenants fictícios confirmou o nome de cada conta, prioridade do membro owner e fallback diante de falha na consulta de metadados.

O smoke de produção passou em desktop e mobile: páginas públicas e formulários de acesso, configurador e passagem de parâmetros ao cadastro, ausência de erros JavaScript, proteção dos endpoints e tratamento seguro de link público inválido. As rotas administrativas de contas e soluções retornaram 401 para chamadas anônimas; a página administrativa redirecionou para login. A interface administrativa autenticada não foi operada em produção: nenhuma concessão de solução ou conta real foi alterada pela validação.

API e worker ficaram saudáveis; readiness retornou `ready=true`. O resumo `degraded` continua pelo aviso preexistente de `production_guard`, sem alteração da configuração. Migrations antes e depois: 153 aplicadas, nenhuma pendente. O hash de `.env.zuno` permaneceu igual. Meetings continua bloqueado comercialmente. Nenhum pagamento, mensagem, login Google ou gravação real foi executado.

Resumo do smoke: [qa/production-admin-20261016/production-smoke.json](qa/production-admin-20261016/production-smoke.json). Capturas e script desta execução permanecem no diretório local ignorado `tmp/production-deploy/`.

## Backups e operação

Servidor `209.97.152.212`, aplicação `/opt/zuno`, início `20261016224400` UTC. Smoke concluído às 19:51 de America/Sao_Paulo.

- Código: `/opt/zuno/deploy_backups/pre-849a726339f8ce26a01f2cdc396706cf1bea974f-20261016224400.tgz`.
- Banco: `/opt/zuno/deploy_backups/db-pre-849a726339f8ce26a01f2cdc396706cf1bea974f-20261016224400.sql.gz`.
- Configuração protegida: `/root/.env.zuno.pre-849a726339f8ce26a01f2cdc396706cf1bea974f-20261016224400`.
- Imagens anteriores dos três serviços: tag `rollback-20261016224400`; mantidas as três gerações mais recentes.
- Log: `/var/log/vorix-deploy-849a726339f8ce26a01f2cdc396706cf1bea974f-20261016224400.log`, terminado com `DEPLOY_DONE`.

Foram liberados 2,7 GB de journals antigos do sistema, mantendo aproximadamente 1 GB, e removidos cache de builds sem uso há mais de seis horas, uma imagem antiga de teste sem containers associados e a geração de rollback excedente. Dados, volumes, configurações e backups foram preservados. O servidor terminou o deploy com aproximadamente 11 GB livres.

Este relatório é um commit posterior de documentação e não altera a revisão compilada da aplicação indicada acima.
