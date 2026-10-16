# Vorix — atualização de produção de 16/10/2026

Pedido autorizado: “faça commit e deploy de tudo o que tem local”. Aplicação publicada e smoke concluído por volta de 09:54, America/Sao_Paulo; registros finais e limpeza concluídos depois. Logs do servidor em UTC.

```text
DEPLOYED = YES
APPLICATION_REVISION = e650eb1b3e6a6d262d2e373ac5152c3aed3055c2
GIT_MAIN_UPDATED = YES
GIT_FEATURE_BRANCH_UPDATED = YES
API_HEALTH = PASS
API_READINESS = PASS
CONVERSATIONS_WORKER_HEALTH = PASS
WEB_HTTP = 200
MIGRATIONS = 153 aplicadas, 0 pendentes
WEB_TYPECHECK = PASS
WEB_TESTS = 112 PASS
LINUX_BACKEND_RELEVANT_TESTS = 539 PASS, 2 SKIP, 0 FAIL
ARCHITECTURE_AND_49_CONTRACTS = PASS
PRODUCTION_BROWSER_SMOKE = PASS
MEETINGS_CONTRACTABLE = NO
SUITE_CONTRACTABLE = NO
MEETINGS_REAL_RECORDING_ENABLED = NO
REAL_PAYMENTS_MESSAGES_RECORDINGS_BY_VALIDATION = NONE
```

## Código e Git

Publicados os nove commits locais posteriores a `48c97b6`, já existentes no início desta tarefa. `main` e `feat/meetings-foundation` foram atualizados por fast-forward; sem reescrever histórico ou criar commit vazio. Este relatório e as evidências posteriores são registrados em commit de documentação, sem alterar a aplicação compilada.

- Conversas: iniciar conversa, respostas rápidas, notas internas, histórico/alertas, regras de horário/ausência, encerramento/CSAT e triagem por equipe, com correções de isolamento por tenant e concorrência.
- Meetings: inteligência/colaboração, modelos de resumo, falantes, perguntas com citações, follow-up/CRM, links públicos, exportação, preferências e exclusão LGPD; importações nativas de Meet/Zoom e gravação presencial na interface, com revisões de permissão, quota e duplicação.
- Cobrança: correções de status de preapproval do Mercado Pago, periodicidade anual, vínculo do pedido de checkout à sessão, caminhos de retorno e apresentação do plano/trial.

Pacote completo produzido com `git archive`, SHA-256 `242ae0d6a773ae5f7f7f395a5d1849f7460cfca7ebbcfab561894adfa9e13a86`. Publicados API, worker de Conversas e frontend da stack oficial. Build sequencial pelo script existente; frontend recompilado com a API pública correta.

## Banco, configuração e infraestrutura

Preflight: 149 migrations com checksums compatíveis; nenhum evento histórico incompatível com a constraint de `0150`; tabelas novas ausentes. Migrations `0150` a `0153` aplicaram sem conflito ou reparo de dados. Verificação final: 153 aplicadas e nenhuma pendente.

`.env.zuno` preservado com hash idêntico antes/depois. JWT, cookies seguros e gravação real desabilitada confirmados. Banco, uploads, mídia e backups preservados. Nenhuma regra de triagem/ausência/CSAT foi habilitada pela validação. Recorders e processamento de Meetings permanecem na homologação WSL2; esta publicação não iniciou esses serviços na produção.

Google Calendar e Zoom permanecem desabilitados no ambiente da API. Importações reais dependem de configuração OAuth/escopos e autorização posterior; nenhuma conta foi conectada nesta tarefa. A diarização opcional exige suas dependências no processamento e não foi ativada por este deploy. Meetings/Suite continuam bloqueados comercialmente.

## Validação

- Frontend: typecheck e 112 testes em 15 arquivos aprovados; build de produção no servidor aprovado.
- Backend: typecheck, build, isolamento arquitetural e 49 contratos aprovados. Em container Linux isolado, sem segredos de produção: 56 arquivos, 541 testes; 539 aprovados, dois omitidos e nenhuma falha. Cobertura selecionada de Inbox, Meetings, billing/Mercado Pago, calendário, gateway de IA, Instagram DM, cadastro, trial, equipes, kanban, notificações e integração CRM.
- Omitidos por configuração explícita ausente: concorrência contra PostgreSQL externo descartável (`VORIX_REAL_PG_URL`) e browser self-service de provisionamento com fixtures. A suíte completa de renderização/CLI não foi repetida.
- Produção: API e worker saudáveis, web 200, readiness `ready=true`, zero erros fatais na checagem do deploy. O resumo `degraded` do readiness continua devido ao aviso preexistente de `production_guard`; banco/secrets passam. A configuração anterior não foi modificada.
- Browser anônimo desktop/mobile: páginas públicas, login/cadastro, configurador, parâmetros levados ao cadastro, ausência de overflow e erros JavaScript aprovados. Endpoints novos de regras, respostas rápidas, uso de Meetings e Zoom recusam acesso anônimo com 401.
- Link público inválido: API 404, página com mensagem segura, sem redirecionamento para login, metadata `noindex` e nenhum áudio/vídeo exposto. Compartilhamento válido, expiração/revogação, permissões e isolamento foram validados com fixtures na suíte, sem publicar reunião real.
- O smoke não criou usuário, pagamento, sessão de checkout, mensagem, gravação, link compartilhado válido ou importação real. Interfaces autenticadas e serviços externos não foram homologados com dados/clientes reais nesta rodada.

Evidências, snapshots agregados e script: [qa/production-release-20261016](qa/production-release-20261016).

## Backup e capacidade

Servidor `209.97.152.212`, aplicação `/opt/zuno`, stamp `20261016124706`:

- Código: `/opt/zuno/deploy_backups/pre-e650eb1b3e6a6d262d2e373ac5152c3aed3055c2-20261016124706.tgz`.
- Banco: `/opt/zuno/deploy_backups/db-pre-e650eb1b3e6a6d262d2e373ac5152c3aed3055c2-20261016124706.sql.gz`.
- Configuração: `/root/.env.zuno.pre-e650eb1b3e6a6d262d2e373ac5152c3aed3055c2-20261016124706`.
- Imagens anteriores dos três serviços com tag `rollback-20261016124706`; log `/var/log/vorix-deploy-e650eb1b3e6a6d262d2e373ac5152c3aed3055c2-20261016124706.log`, encerrado com `DEPLOY_DONE`.

Foram removidos caches não usados, candidatos temporários de builds anteriores e pacotes de envio duplicados, preservando imagens em uso e rollback. Quatro pacotes antigos de `/tmp` foram copiados ao arquivo privado local WSL `/root/vorix-deploy-packages-20261016`, comparados por SHA-256 e só então removidos do servidor; `VERIFIED.sha256` identifica as quatro cópias conferidas. Uma transferência parcial e uma cópia não verificada foram identificadas com sufixos próprios; seus originais permaneceram no servidor. O arquivo local tem acesso restrito e não faz parte do Git/OneDrive.

Espaço livre final observado: aproximadamente 3.187 MiB. O preflight de um próximo deploy exige 4.000 MiB; será necessário recuperar mais espaço antes de outro build. Nenhum backup de banco ou volume de outra aplicação foi removido.

Nenhum rollback foi necessário. Para recuperar a aplicação anterior, o procedimento preparado é `sh scripts/deploy/rollback-production.sh 20261016124706 all`, em `/opt/zuno`. Ele não reverte o banco: revisar compatibilidade com os novos dados de eventos/regras, compartilhar links e integrações de cobrança antes de reverter código; não restaurar dumps automaticamente sobre dados posteriores.
