# Vorix — publicação de configurações e ajustes de produto

17/10/2026, America/Sao_Paulo. Pedido: fazer commit e deploy de todo o conteúdo local, atualizando o Git e o servidor. Publicação concluída pelo procedimento oficial; smoke final às 18:32.

```text
DEPLOYED = YES
APPLICATION_REVISION = 43c567290a5260058ec798cf44d71c0c17521d37
API_HEALTH = PASS
CONVERSATIONS_WORKER_HEALTH = PASS
WEB_HTTP = 200
MIGRATIONS = 161 aplicadas, 0 pendentes
BACKEND_TESTS = 335 PASS, 0 FAIL, 0 SKIP (38 arquivos selecionados)
FRONTEND_TESTS = 123 PASS (17 arquivos)
BROWSER_FIXTURE_TESTS = 9 PASS
CONTRACTS = 49 PASS
BUILDS_AND_TYPECHECK = PASS
PRODUCTION_BROWSER_SMOKE = PASS
MEETINGS_CONTRACTABLE = NO
```

## Conteúdo publicado

- `3b70b5b`: máscara de moeda, estoque opcional por produto, metas mensais, capacidade da assinatura, recarga de créditos de IA, bloqueio ao fim do teste gratuito e relatórios com modelos e IA. Inclui a organização das regras comerciais em assuntos e o salvamento explícito.
- `aef1c8a`: assistente de automações em quatro etapas, três exemplos disponíveis para adicionar desativados, revisão/histórico e confirmação antes de ativar. A API e o banco recebem `active=false` na inserção, sem janela de execução da regra ativa.
- `1001101`: retorno do checkout de créditos limitado à origem do produto. Testes cobrem URLs externas, barras, controles e um caminho interno válido, usando gateway simulado.
- `43c5672`: teste de auditoria independente da ordem de eventos com timestamps empatados; preserva a verificação das duas transições e reforça a verificação do ator e da origem.

Os commits foram publicados por fast-forward em `main` e `feat/meetings-foundation`. Pacote integral produzido com `git archive`, SHA-256 `a1492a6bcadee9bfaad7f61ef77a20fe6579adc4c7ccb7dff9ac654709f2851c`, conferido no destino. API, worker de Conversas e frontend compilados em sequência, migrations verificadas antes da troca dos serviços. Os hashes do caso de uso de créditos e do componente de automações no servidor coincidem com os blobs do Git.

## Banco, configuração e operação

Preflight somente de leitura: tabelas, colunas de estoque e operações de relatório novas ainda ausentes; zero regras de automação. Migrations `0159` a `0161` aplicaram sem conflito, com os checksums anteriores preservados: 158 → 161 aplicadas, nenhuma pendente. Nenhum reparo de dados foi necessário.

Postflight: três tabelas novas, três colunas de estoque e duas operações de IA de relatório presentes. Zero regras de automação e zero compras de créditos no banco principal na conferência final. Os exemplos aparecem na tela; o botão **Adicionar exemplos desativados** os salva no workspace escolhido. A publicação não cadastra nem ativa regras automaticamente.

O hash de `.env.zuno` permaneceu igual. Dados, volumes, configuração e backups foram preservados. Meetings permanece não contratável. Readiness retorna `ready=true`; o resumo `degraded` continua pelo aviso preexistente de `production_guard`, enquanto banco, secrets, estado operacional e fila passam.

## Verificação e limites

- Backend em container Linux isolado, sem segredos de produção: 38 arquivos e 335 testes aprovados, nenhum omitido. Cobertura de créditos, gates de Meetings, estoque, relatórios, cobrança/webhooks/Mercado Pago, trial, CRM/comercial, automações, autenticação/JWT e isolamento por tenant. A primeira rodada encontrou um empate de timestamps no teste de auditoria; após a correção do teste, a seleção inteira passou. A suíte completa de backend/renderização não foi repetida.
- Frontend: typecheck e 123 testes aprovados; build de produção passou no servidor. Os 49 contratos e o isolamento de CRM, Inbox e AI Gateway passaram.
- Navegador com backend mockado: quatro testes desktop/mobile de regras comerciais e automações; cinco testes de estoque/moeda, metas, estrutura/créditos, expiração do trial e relatórios/IA. As provas de produto incluem capturas em 1440 e 390 pixels.
- Smoke anônimo em produção: páginas públicas, login/cadastro, tema escuro padrão, mobile, configurador e encaminhamento para cadastro, links inválidos de reunião/proposta tratados com segurança, ausência de erros JavaScript. Rotas de créditos, modelos de relatórios e automações retornam 401 sem autenticação, assim como a tentativa anônima de compra de créditos.

Não houve compra real, chamada paga de IA, pagamento, mensagem, aceite de proposta real ou ativação de automação durante a validação. Os fluxos autenticados de negócio foram verificados com fixtures; não houve homologação de cobrança com cartão real nem operação de contas de clientes no smoke.

Evidências e script: [qa/production-settings-20261017](qa/production-settings-20261017). Validação Linux também em `/root/vorix-release-settings-20261017/validation.log` no WSL2. A rodada inicial, anterior ao ajuste do teste, permanece separada em `validation-initial.log` nesse mesmo diretório.

## Backups

Servidor `209.97.152.212`, aplicação `/opt/zuno`, stamp `20261017212715` UTC:

- Código: `/opt/zuno/deploy_backups/pre-43c567290a5260058ec798cf44d71c0c17521d37-20261017212715.tgz`.
- Banco: `/opt/zuno/deploy_backups/db-pre-43c567290a5260058ec798cf44d71c0c17521d37-20261017212715.sql.gz`.
- Configuração protegida: `/root/.env.zuno.pre-43c567290a5260058ec798cf44d71c0c17521d37-20261017212715`.
- Imagens anteriores: tag `rollback-20261017212715`; mantidas as três gerações mais recentes.
- Log: `/var/log/vorix-deploy-43c567290a5260058ec798cf44d71c0c17521d37-20261017212715.log`, terminado com `DEPLOY_DONE`, zero erros fatais detectados.

O servidor terminou com aproximadamente 6,7 GB livres. Somente a rotação de imagens prevista no script oficial foi necessária. Este relatório e as evidências são um commit posterior de documentação e não alteram a revisão compilada indicada acima.
