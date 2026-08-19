# Deployment — Plataforma Zuno (RC 1.0)

## Commit e Deploy Vorix Atual

Use este fluxo para atualizar Git e o servidor `vorixworks.com` a partir do workspace local.

Valores operacionais documentados em `.env.zuno.example`:

- `DEPLOY_GIT_BRANCH=main`
- `DEPLOY_SSH_HOST=209.97.152.212`
- `DEPLOY_SSH_USER=root`
- `DEPLOY_SSH_TARGET=root@209.97.152.212`
- `DEPLOY_SSH_AUTH=ssh-key`
- `DEPLOY_SSH_PASSWORD=` — preencher somente no `.env.zuno` privado se o acesso for por senha; nunca commitar valor real.
- `DEPLOY_REMOTE_DIR=/opt/zuno`
- `DEPLOY_COMPOSE_FILE=docker-compose.zuno.yml`
- `DEPLOY_ENV_FILE=.env.zuno`
- `DEPLOY_API_HEALTH_URL=https://api.vorixworks.com/v1/health`
- `DEPLOY_WEB_HEALTH_URL=https://vorixworks.com`
- `DEPLOY_COMMAND=cd /opt/zuno && docker compose --env-file .env.zuno -f docker-compose.zuno.yml up -d --build`

Passo a passo:

1. Conferir pendências:

   ```bash
   git status --short
   ```

2. Validar frontend antes de commitar/deployar:

   ```bash
   cd web
   npm run typecheck
   npm test
   npm run build
   cd ..
   ```

3. Se houver mudanças, commitar e enviar ao Git:

   ```bash
   git add -A
   git commit -m "Mensagem objetiva do ajuste"
   git push origin main
   ```

4. Empacotar e enviar o código local ao servidor sem secrets/runtime:

   **Usar `git archive`, nunca `tar` sobre a working tree crua.** Achado ao vivo (Rodada 2,
   Fatia 3): um `tar -C . .` embarca os bytes exatos que estiverem no disco local no momento —
   inclusive line endings CRLF que um checkout Windows com `core.autocrlf=true` pode ter
   introduzido silenciosamente (`git status` fica limpo porque o autocrlf normaliza para o diff
   do próprio git, mas os bytes crus no disco divergem). O runner de migrations calcula checksum
   sobre esses bytes crus sem normalização — um CRLF a mais já quebra o checksum de uma migration
   já aplicada e bloqueia qualquer migration nova (`MIGRATION_CHECKSUM_MISMATCH`, ver
   `docs/*-final-report*.md` desta fatia para o diagnóstico completo). `git archive` sempre emite
   o conteúdo CANÔNICO do commit (LF, igual ao que está no repositório), nunca o estado do
   checkout local, e já exclui `.git`/arquivos não rastreados automaticamente — não precisa mais
   de `--exclude` manual por diretório.

   ```bash
   git archive --format=tar HEAD | gzip > /tmp/zuno-local-sync.tgz

   scp /tmp/zuno-local-sync.tgz root@209.97.152.212:/tmp/zuno-local-sync.tgz
   ```

   `.gitattributes` (`* text=auto eol=lf`) na raiz do repositório garante que isto continue valendo
   mesmo que alguém rode `git archive` a partir de um checkout Windows — o próprio Git normaliza
   pra LF na hora de gerar o archive, independente do `core.autocrlf` de quem roda o comando.

5. No servidor, criar backup, preservar `.env.zuno` e substituir só o código:

   ```bash
   ssh root@209.97.152.212 'set -euo pipefail; cd /opt/zuno; \
     stamp=$(date +%Y%m%d%H%M%S); \
     mkdir -p deploy_backups; \
     tar -czf "deploy_backups/pre-local-sync-$stamp.tgz" \
       --exclude="./deploy_backups" \
       --exclude="./node_modules" \
       --exclude="./web/node_modules" \
       --exclude="./web/.next" \
       --exclude="./dist" .; \
     rm -rf assets db docs examples scripts src tests web \
       .dockerignore .editorconfig .env.example .env.zuno.example .gitignore \
       CHANGELOG.md Dockerfile README.md docker-compose.zuno.yml \
       package.json package-lock.json tsconfig.json; \
     tar -xzf /tmp/zuno-local-sync.tgz -C /opt/zuno; \
     chown -R root:root /opt/zuno'
   ```

6. Rebuild/restart completo:

   ```bash
   ssh root@209.97.152.212 \
     'cd /opt/zuno && docker compose --env-file .env.zuno -f docker-compose.zuno.yml up -d --build'
   ```

7. Checar saúde:

   ```bash
   curl -I https://vorixworks.com
   curl -s https://api.vorixworks.com/v1/health
   ssh root@209.97.152.212 'docker ps | grep zuno'
   ```

Regras:

- Nunca commitar `.env.zuno` real.
- Nunca commitar senha SSH, token, chave privada ou segredo operacional.
- Nunca sobrescrever `.env.zuno` do servidor durante deploy.
- Sempre criar backup em `/opt/zuno/deploy_backups/` antes de substituir código.
- Se `git status --short` estiver vazio, não criar commit vazio; deployar o HEAD atual.

**Production permanece bloqueada por padrão** (`ProductionGuard`, ver `docs/sprint-24-final-report.md`). Este documento descreve como implantar um ambiente controlado (sandbox/staging) — não um passo a passo de ativação de produção real, que exige aprovação explícita fora do escopo desta sprint.

## Pré-requisitos

- Node.js ≥ 20, PostgreSQL real (não PGlite — PGlite é só para testes).
- Variáveis de ambiente mínimas (ver `.env.example`, com o gap documentado no relatório final — algumas variáveis usadas por `api-config.ts` não estão listadas lá ainda): `DATABASE_URL`, `JWT_SECRET`, `API_CORS_ORIGIN`, `COOKIE_SECURE=true` (fora de `localhost`).

## Passos

1. `npm ci && npm run build` — compila TypeScript, copia manifestos de Skills e assets do Remotion.
2. `npm run db:migrate` — aplica as 49 migrations pendentes (transação por arquivo, checksum verificado contra o que já foi aplicado — falha explícita se um arquivo já aplicado foi alterado).
3. `npm run db:migrate:status` — confirmar que tudo aplicou.
4. Configurar `AUTH_MODE=jwt` (nunca `noop` fora de dev/teste) com `JWT_SECRET` forte e `DATABASE_URL` apontando para o Postgres real.
5. `PERSISTENCE_DRIVER=postgres` (memória nunca deve rodar fora de dev/teste — dados somem a cada restart).
6. `COOKIE_SECURE=true` obrigatório fora de `http://localhost` — o padrão é `false`, então isto **precisa ser setado explicitamente** (achado de configuração crítica no relatório final).
7. `SECRET_MANAGER_PROVIDER` — `local` para sandbox (não durável, aceitável só fora de produção real); `production` hoje é um stub fail-closed sem backend real conectado (bloqueia qualquer fluxo que dependa de segredo de credencial até um backend real existir — ver Riscos residuais).
8. `npm run zuno:api` — sobe a API.
9. `cd web && npm run build && npm start` — sobe o frontend (`NEXT_PUBLIC_API_URL` apontando para a API).
10. Confirmar `GET /readyz` → `ready: true` e `GET /v1/system/release-gate` → `productionEnabled: false` antes de considerar o ambiente "no ar".

## Nunca fazer nesta fase

- Setar `PUBLICATION_PRODUCTION_ENABLED=true` sem um Secret Manager de produção real conectado — o `ProductionGuard` deveria bloquear, mas não confiar cegamente nisso como única camada de defesa.
- Expor a API sem `@fastify/cors` restrito a uma origem conhecida — o padrão já é restrito (`localhost:3001`), mas confirmar `API_CORS_ORIGIN` em cada ambiente.
- Rodar sem headers de segurança adicionais (`helmet`/CSP) — nenhum está registrado hoje (achado do relatório final); não é um bloqueador para sandbox, mas é um requisito antes de qualquer exposição pública real.

## Rollback

Não existe rollback automatizado de migrations (decisão documentada em `migration-runner.ts` — cada migration reverte só a si mesma se falhar durante a aplicação; migrations já commitadas nunca são desfeitas automaticamente). Rollback de uma migration já aplicada = restaurar de backup + reaplicar as migrations anteriores, ou escrever uma migration forward-only de correção. Planejar isso explicitamente antes de qualquer deploy de produção real.
