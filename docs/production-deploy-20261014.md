# Vorix — atualização de produção de 14/10/2026

Deploy autorizado pelo usuário: “atualize em produção com tudo o que tem local”. Concluído às 21:38 aproximadamente, America/Sao_Paulo; o servidor registra os horários em UTC de 15/10.

```text
DEPLOYED = YES
APPLICATION_REVISION = e1ce6b455c262c196e639ba7a0ae72ce45375f98
PUBLIC_SITE = https://vorixworks.com
API = https://api.vorixworks.com
API_HEALTH = PASS
API_READINESS = PASS
CONVERSATIONS_WORKER_HEALTH = PASS
WEB_HTTP = 200
MIGRATIONS = 148 aplicadas, 0 pendentes, sem divergência de checksum
PRODUCTION_BROWSER_SMOKE = PASS
CONVERSAS_CONTRACTABLE = YES
MEETINGS_CONTRACTABLE = NO
SUITE_CONTRACTABLE = NO
MEETINGS_REAL_RECORDING_ENABLED = NO
REAL_GOOGLE_HOMOLOGATION = NOT_APPROVED
```

## Conteúdo e configuração

Publicado o HEAD local completo e versionado, incluindo nova home multiproduto, páginas de Conversas/Meetings/preços, catálogo público e implementação estrutural de Meetings. O branch `feat/meetings-foundation` foi enviado ao Git. `origin/main` era ancestral desse HEAD, sem commits divergentes.

O pacote foi produzido com `git archive`, preservando os bytes LF das migrations. SHA-256 do pacote: `9fea72ad08a87042b6d1e406101165675af155d6643900c8271c69a032700353`.

Atualizados os três serviços da stack oficial: `zuno-api`, `vorix-worker` (Conversas) e `zuno-web`. Frontend recompilado com `NEXT_PUBLIC_API_URL=https://api.vorixworks.com`; SSR usa a API pela rede interna. `.env.zuno` preservado, com hash igual antes/depois; autenticação JWT e cookies seguros confirmados. Volumes de banco, uploads e mídia preservados. Não foram transferidos banco local, contas fictícias, cookies Google, segredos locais, `node_modules`, builds Windows ou artefatos não versionados de benchmark.

Os recorders e o processamento de Meetings que estavam no WSL2 continuam exclusivos da homologação. A stack oficial de produção não passa a executar esses serviços por este deploy. APIs, telas e schema de Meetings foram publicados; gravação real permanece desabilitada, sem contas de gravação ou sessões de provisionamento em produção. Isso não libera operação ou venda de Meetings. Google real e provisionamento real continuam pendentes de homologação; o bloqueio mostrado anteriormente pelo Google não foi declarado resolvido.

## Banco e procedimento

Preflight encontrou 142 migrations aplicadas com checksums compatíveis e nenhuma tabela de Meetings preexistente. As migrations `0143` a `0148` aplicaram sem conflito; não foi necessário reparo de dados de produção. Nenhuma migration anteriormente aplicada foi modificada.

O script oficial foi corrigido antes da publicação: falhas reais de `pg_dump` ou migrations não podem ser ocultadas pelo exit code de um pipeline; migrations usam a imagem nova em processo temporário antes da troca dos serviços. Build sequencial e rollback do script foram preservados. Execução com `umask 077`; backups novos têm permissão `600`.

Foram removidos 6,37 GB de cache de build antigo e não utilizado. Nenhum volume, banco ou container de outra aplicação foi removido.

## Validação

- Backend: typecheck, build, arquitetura e 49 contratos aprovados. Suíte Linux com 3.567 testes: 3.564 aprovados, dois externos omitidos e um timeout conhecido da CLI de renderização sob quota de 1,5 CPU. Esse caso passou isoladamente com quatro CPUs em cerca de 23 segundos, sem aumentar o timeout ou alterar o teste. A quota da suíte foi ampliada para quatro CPUs durante a execução restante. O resultado bruto da suíte continua registrado como `rc=1`; a exceção de capacidade e a repetição ficam explícitas nos logs.
- Frontend: 94 testes em 13 arquivos aprovados; build de produção no servidor aprovado. Build de API também aprovado.
- Produção: API e worker `healthy`, web 200, `/readyz` com `ready=true`, zero erros fatais na verificação do deploy. O aviso preexistente de `production_guard` mantém o readiness geral em `degraded`; checks de banco, secrets e estado operacional passam. A configuração existente de publicação/canary não foi alterada.
- Browser real anônimo: desktop e mobile sem overflow; menus, seletor, páginas públicas, login/signup, redirecionamento `/pricing`, proteção de rotas privadas, Open Graph e ausência de erros JavaScript aprovados. Endpoint de contas de gravação com query válida recusa acesso anônimo com 401. Nenhuma conta de teste foi cadastrada em produção.
- Preços públicos coincidem com `plan_versions`: Start R$149, Pro R$299, Business R$599 mensais. Meetings não é contratável na API; seu CTA permanece informativo. Suite permanece sem checkout.
- Estado final do banco: 148 migrations, zero reuniões, zero contas de gravação, zero sessões abertas de provisionamento. Nenhum login Google ou gravação foi executado por este deploy.

Evidências em [qa/production-deploy-20261014](qa/production-deploy-20261014): logs do deploy/migrations/gate Linux, repetição isolada da CLI, script e JSON do smoke, capturas desktop/mobile e estado final agregado, sem segredos.

## Backup e rollback

Servidor `209.97.152.212`, aplicação `/opt/zuno`, stamp `20261015003723`:

- Código: `/opt/zuno/deploy_backups/pre-e1ce6b455c262c196e639ba7a0ae72ce45375f98-20261015003723.tgz`.
- Banco: `/opt/zuno/deploy_backups/db-pre-e1ce6b455c262c196e639ba7a0ae72ce45375f98-20261015003723.sql.gz`, dump não vazio e gzip validado.
- Configuração: `/root/.env.zuno.pre-e1ce6b455c262c196e639ba7a0ae72ce45375f98-20261015003723`.
- Imagens anteriores: `zuno-zuno-api`, `zuno-vorix-worker`, `zuno-zuno-web` com tag `rollback-20261015003723`.
- Log: `/var/log/vorix-deploy-e1ce6b455c262c196e639ba7a0ae72ce45375f98-20261015003723.log`, encerrado com `DEPLOY_DONE`.

Rollback de aplicação, somente se necessário, a partir de `/opt/zuno`:

```sh
sh scripts/deploy/rollback-production.sh 20261015003723 all
```

Esse comando restaura código/imagens; não reverte automaticamente o banco. O dump foi preservado para recuperação controlada. Nenhum rollback foi necessário nesta publicação.
