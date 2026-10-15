# Vorix — commit, Git e produção atualizados

14/10/2026, America/Sao_Paulo. Pedido: “faça commit e deploy de tudo atualizando em produção e git tambem”. Publicação concluída e validada às 22:54 aproximadamente; logs do servidor usam UTC de 15/10.

```text
DEPLOYED = YES
APPLICATION_REVISION = 8cf7ea8bc611e32a581cc00d2fc42dc530d0281f
GIT_MAIN_UPDATED = YES
GIT_FEATURE_BRANCH_UPDATED = YES
PUBLIC_SITE = https://vorixworks.com
API_HEALTH = PASS
API_READINESS = PASS
CONVERSATIONS_WORKER_HEALTH = PASS
WEB_HTTP = 200
WEB_TYPECHECK = PASS
WEB_TESTS = 107 PASS
BACKEND_RELEVANT_TESTS = 37 PASS
PRODUCTION_BUILD = PASS
PRODUCTION_BROWSER_SMOKE = PASS
MIGRATIONS = 148 aplicadas, 0 pendentes
MEETINGS_CONTRACTABLE = NO
SUITE_CONTRACTABLE = NO
```

## Publicação e Git

Incluído o commit local `a7d2d43`, com refinamento visual da home e configurador “Monte seu Vorix”. O commit `8cf7ea8` versionou as 43 evidências de benchmark que estavam pendentes, o smoke anônimo de produção e a exclusão explícita de `/tmp/` do Git. `main` foi atualizado por fast-forward, assim como `feat/meetings-foundation`; nenhum histórico foi reescrito. O relatório e as evidências posteriores são registrados em commit de documentação, sem alteração da aplicação compilada.

O pacote completo veio de `git archive HEAD`, SHA-256 `0836c063f4404f842ae8753350513921bf8c0b6baed4360cfa81755e930f8b74`. Foram atualizados API, worker de Conversas e frontend pelo script oficial, com builds sequenciais e rollback preparado. O build do frontend usa `https://api.vorixworks.com`.

Segredos e configuração `.env.zuno` preservados, com hash igual antes/depois. Banco, uploads e mídia permanecem nos volumes existentes. Diretórios temporários, credenciais, banco local e dependências locais não foram incluídos no pacote. Nenhuma mudança de backend, migration ou configuração de serviços foi introduzida pelo refinamento; as 148 migrations continuam aplicadas, sem pendência ou divergência.

## Verificação

- Frontend: typecheck e 107 testes em 14 arquivos aprovados; build otimizado no servidor aprovado.
- Backend: 37 testes relevantes de catálogo público, capacidade/preços, cobrança e acesso por solução aprovados. O backend operacional não mudou desde a publicação anterior; não foi repetida a suíte completa já documentada no [primeiro deploy](production-deploy-20261014.md).
- Produção: API e worker saudáveis, web 200, readiness com `ready=true`, zero erros fatais na verificação do deploy. O aviso preexistente de `production_guard` mantém o estado geral do readiness como `degraded`; não foi alterado por esta publicação.
- Browser real anônimo: home, preços, páginas de produtos, login/signup, menus, seletor, desktop/mobile sem overflow, redirects, Open Graph e proteção de rotas privadas aprovados. Nenhum erro JavaScript observado.
- Configurador: total inicial R$149; três usuários e um número resultam em R$188, igual ao simulador oficial da API. Selecionar Meetings apresenta a Suite e contato comercial. Duas gravações simultâneas mantêm o adicional como “a definir”; não inventam preço nem liberam checkout.
- Nenhum login, cadastro de fixture, login Google, MFA ou gravação real foi executado em produção. Meetings/Suite permanecem sem contratação. Recorders e processamento de Meetings continuam no ambiente de homologação WSL2.

Evidências e script de repetição: [qa/production-refine-20261014](qa/production-refine-20261014). O smoke usa navegação anônima e o simulador público; não usa credenciais e não contrata produtos.

## Backup e rollback

Servidor `209.97.152.212`, diretório `/opt/zuno`, stamp `20261015014916`:

- Código: `/opt/zuno/deploy_backups/pre-8cf7ea8bc611e32a581cc00d2fc42dc530d0281f-20261015014916.tgz`.
- Banco: `/opt/zuno/deploy_backups/db-pre-8cf7ea8bc611e32a581cc00d2fc42dc530d0281f-20261015014916.sql.gz`.
- Configuração: `/root/.env.zuno.pre-8cf7ea8bc611e32a581cc00d2fc42dc530d0281f-20261015014916`.
- Imagens dos três serviços preservadas com tag `rollback-20261015014916`.
- Log `/var/log/vorix-deploy-8cf7ea8bc611e32a581cc00d2fc42dc530d0281f-20261015014916.log`, encerrado com `DEPLOY_DONE`.

Rollback, apenas se necessário, no diretório `/opt/zuno`:

```sh
sh scripts/deploy/rollback-production.sh 20261015014916 all
```

Nenhum rollback foi necessário. A documentação final foi sincronizada no servidor após registrar as evidências no Git; a aplicação compilada corresponde à revisão indicada acima.
