# Vorix — publicação de Comercial e Design System 2.0

17/10/2026, America/Sao_Paulo. Pedido autorizado: publicar todo o conteúdo local no Git e em produção. Os seis commits de aplicação já estavam salvos localmente e foram enviados por fast-forward a `main` e `feat/meetings-foundation`.

```text
DEPLOYED = YES
APPLICATION_REVISION = dc69d96f17a6b565e6b987fba98573888cb1230e
API_HEALTH = PASS
CONVERSATIONS_WORKER_HEALTH = PASS
WEB_HTTP = 200
MIGRATIONS = 158 aplicadas, 0 pendentes
BACKEND_BUILD = PASS
FRONTEND_TYPECHECK_AND_BUILD = PASS
SELECTED_BACKEND_TESTS = 198 PASS, 0 FAIL, 0 SKIP
FRONTEND_TESTS = 112 PASS
SALES_BROWSER_FIXTURE_TESTS = 8 PASS
CONTRACTS = 49 PASS
PRODUCTION_BROWSER_SMOKE = PASS
MEETINGS_CONTRACTABLE = NO
```

## Publicação

O servidor estava na revisão `b1d5307`, com 154 migrations. Foram publicados catálogo/preços, itens e aprovação comercial, versões e aceite auditado de propostas, metas/desempenho/forecast, insights comerciais de IA e a interface comercial, além do Design System 2.0 com tema escuro padrão e acentos por solução.

API, worker de Conversas e frontend foram compilados em sequência pelo procedimento oficial `scripts/deploy/deploy-production.sh`, alvo `all`. O pacote integral veio de `git archive`, SHA-256 `8c8918ebbab0c0d523a8b78676b6950d2cdee7a401fc55edaf21eff400db1278`, conferido no servidor. Os hashes do caso de uso comercial e do CSS global publicados coincidiram com os blobs do Git.

## Banco e configuração

Consulta somente de leitura antes da publicação: nenhum status de proposta ou gatilho de automação incompatível com as novas constraints; tabelas comerciais novas ausentes. Havia um negócio fechado e duas propostas para os backfills previstos pelas migrations.

As migrations `0155` a `0158` aplicaram pelo fluxo oficial, preservando os checksums anteriores: 158 aplicadas e zero pendentes ao final. A verificação posterior confirmou as sete relações comerciais amostradas, nenhuma proposta sem número/raiz, nenhuma duplicação de número/versão, nenhum negócio fechado antigo ainda com status aberto e uma operação `deal_commercial_insights` registrada. Nenhum reparo manual de dados foi necessário.

O hash de `.env.zuno` permaneceu igual. Dados, volumes e backups foram preservados. O scheduler novo de propostas cria tarefas/alertas internos, sem enviar mensagens ao cliente automaticamente. Nenhuma configuração comercial ou concessão de solução foi alterada pela validação; Meetings continua não contratável.

## Verificação

- Backend compilado no Windows e em container Linux isolado; 20 arquivos selecionados de CRM, Comercial, Sales Engine, IA, administração, soluções e início de conversa: 198 testes aprovados, nenhum omitido ou falho. Os testes usam fixtures/PGlite e não recebem segredos de produção. A suíte completa do backend não foi repetida.
- Frontend: typecheck e 112 testes aprovados; build de produção no servidor aprovado.
- Navegador com backend mockado: oito testes desktop/mobile de aceite e recusa de proposta, versão substituída, cockpit, margem, negociação e impacto na meta, todos aprovados.
- 49 contratos e isolamento arquitetural de CRM, Inbox e AI Gateway aprovados.
- Smoke anônimo em produção: rotas públicas e autenticação, desktop/mobile, tema escuro padrão, configurador e passagem de parâmetros ao cadastro, tratamento de links inválidos de reunião/proposta e ausência de erros JavaScript. As novas rotas comerciais recusam chamadas anônimas com 401. Nenhuma proposta real foi aberta ou aceita pelo teste.
- API e worker saudáveis; site HTTP 200; readiness `ready=true`. O resumo `degraded` permanece pelo aviso preexistente de `production_guard`; os outros checks passam.

Nenhum pagamento, mensagem, login Google, gravação real, chamada paga de IA ou alteração autenticada de cliente foi executado na validação. As telas autenticadas de Comercial foram verificadas com fixtures; o smoke de produção não operou contas de clientes.

Evidências e script do smoke: [qa/production-release-20261017](qa/production-release-20261017). O log da validação Linux também permanece em `/root/vorix-release-20261017/validation.log` no WSL2.

## Backups e encerramento

Servidor `209.97.152.212`, aplicação `/opt/zuno`, stamp `20261017121344` UTC. Smoke concluído às 09:18 de America/Sao_Paulo.

- Código: `/opt/zuno/deploy_backups/pre-dc69d96f17a6b565e6b987fba98573888cb1230e-20261017121344.tgz`.
- Banco: `/opt/zuno/deploy_backups/db-pre-dc69d96f17a6b565e6b987fba98573888cb1230e-20261017121344.sql.gz`.
- Configuração protegida: `/root/.env.zuno.pre-dc69d96f17a6b565e6b987fba98573888cb1230e-20261017121344`.
- Imagens anteriores dos três serviços: tag `rollback-20261017121344`, preservadas as três gerações mais recentes pelo script oficial.
- Log: `/var/log/vorix-deploy-dc69d96f17a6b565e6b987fba98573888cb1230e-20261017121344.log`, terminado com `DEPLOY_DONE`, sem erros fatais detectados.

O servidor terminou com aproximadamente 6,7 GB livres. Não foi necessária limpeza adicional nesta execução, além da rotação de imagens prevista no procedimento oficial.

Este relatório e as evidências são um commit posterior de documentação; a revisão compilada da aplicação é a indicada acima.
