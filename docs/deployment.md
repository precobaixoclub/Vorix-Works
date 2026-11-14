# Deployment — Plataforma Zuno (RC 1.0)

Operação vigente, disponibilidade dos canais e disaster recovery: [runbook de produção](operations/production-readiness.md).
Para release, usar `scripts/deploy/deploy-production.sh` com pacote de `git archive`; o procedimento automatizado faz backup, build sequencial, migrations, health e rollback. Não usar build conjunto em produção.

## Commit e Deploy Vorix Atual

Use este fluxo para atualizar o Git e o servidor de `vorixworks.com` a partir do workspace local.

### Servidor de produção (desde 10/11/2026)

| Item | Valor |
|---|---|
| Host | `62.83.93.42` (NetCup, Debian 13, 8 vCPU, 16 GB RAM, 320 GB) |
| Acesso | `root`, **somente chave SSH** (senha desativada) |
| Chave local | `~/.ssh/rumoaoaltar_netcup_ed25519` (alias `rumoaoaltar-netcup` no `~/.ssh/config`) |
| Código / env | `/opt/zuno` / `/opt/zuno/.env.zuno` (só existe no servidor; nunca sobrescrever) |
| Gateway WhatsApp | env em `/opt/conversas-spike/.env.conversas`, compose em `/opt/zuno` |
| Proxy / HTTPS | Traefik em `/opt/edge` (compartilhado; não mexer em deploy do Vorix) |
| Git | `origin` → `git@github.com:precobaixoclub/Vorix-Works.git`, branch `main` |

O servidor antigo `143.198.47.74` (DigitalOcean) foi migrado e **desativado**. O mesmo host
também roda o Rumo ao Altar (`/opt/rumoaoaltar`) e o Preço Baixo Club (`/opt/preco-baixo-club`):
um deploy do Vorix nunca deve tocar nessas pastas, nem em `/opt/edge`.

Teste de acesso:

```bash
ssh -i ~/.ssh/rumoaoaltar_netcup_ed25519 root@62.83.93.42 'hostname; docker ps --filter name=zuno --format "{{.Names}} {{.Status}}"'
```

### 1. Conferir pendências

```bash
git status --short
git pull --ff-only origin main
```

Se `git status --short` estiver vazio, não crie commit vazio: deploye o `HEAD` atual.

### 2. Validar antes de commitar

```bash
npm run typecheck
npm test
cd web
npm run typecheck
npm test
npm run build
cd ..
```

Gate oficial em Linux (opcional, igual à imagem de produção): `sh scripts/ci/linux-release-gate.sh <dir> <rótulo>`.

### 3. Commitar e enviar ao Git

```bash
git add -A
git commit -m "Mensagem objetiva do ajuste"
git push origin main
```

Nunca commitar `.env.zuno`, senha, token ou chave privada.

### 4. Gerar o pacote do commit

**Usar `git archive`, nunca `tar` sobre a working tree crua.** Um `tar` embarca os bytes do disco
local, inclusive CRLF introduzido por `core.autocrlf=true` no Windows; o runner de migrations
calcula checksum sobre os bytes crus, e um CRLF a mais quebra o checksum de migration já aplicada
(`MIGRATION_CHECKSUM_MISMATCH`). `git archive` emite o conteúdo canônico do commit (LF, via
`.gitattributes`) e já exclui `.git` e arquivos não rastreados.

```bash
SHA=$(git rev-parse HEAD)
git archive --format=tar HEAD | gzip > "/tmp/zuno-$SHA.tgz"
sha256sum "/tmp/zuno-$SHA.tgz"
```

### 5. Enviar e conferir no servidor

```bash
scp "/tmp/zuno-$SHA.tgz" root@62.83.93.42:/tmp/
ssh root@62.83.93.42 "sha256sum /tmp/zuno-$SHA.tgz"   # deve bater com o hash local
```

### 6. Rodar o deploy oficial

```bash
ssh root@62.83.93.42 "sh /opt/zuno/scripts/deploy/deploy-production.sh /tmp/zuno-$SHA.tgz $SHA all; echo EXIT=\$?"
```

Alvos: `api` (zuno-api + vorix-worker + marketplaces-worker), `web` (zuno-web) ou `all`
(os anteriores + social-provider-gateway). O script faz preflight (8 GB livres), backup de código,
`.env.zuno`, banco e sessões sociais em `/opt/zuno/deploy_backups/`, marca as imagens atuais como
`:rollback-<stamp>`, troca o código, faz build sequencial, aplica migrations antes de trocar os
serviços, sobe e confere health. Se algo falhar, faz **rollback automático**.

A saída vai para o log (`EXIT=0` = sucesso). Conferir o final:

```bash
ssh root@62.83.93.42 "tail -15 \$(ls -t /var/log/vorix-deploy-$SHA-*.log | head -1)"
```

O log deve terminar com `DEPLOYED <sha>` e `DEPLOY_DONE`. `DEPLOY_FAILED`/`ROLLED_BACK` indicam
que nada novo ficou no ar.

### 7. Checar saúde

```bash
curl -I https://vorixworks.com
curl -s https://api.vorixworks.com/v1/health
ssh root@62.83.93.42 'docker ps --filter name=zuno --format "table {{.Names}}\t{{.Status}}"'
```

O `meetings-recorder` (perfil `meetings`) não faz parte dos alvos do script. Se precisar recriá-lo:

```bash
ssh root@62.83.93.42 'cd /opt/zuno && docker compose --env-file .env.zuno -f docker-compose.zuno.yml --profile meetings up -d --no-deps meetings-recorder'
```

O `meetings-worker` segue desligado.

### 8. Rollback manual (sem rebuild)

```bash
ssh root@62.83.93.42 'cd /opt/zuno && sh scripts/deploy/rollback-production.sh <stamp> all'
```

O `<stamp>` está no nome do log e das imagens `:rollback-<stamp>`. O banco nunca é revertido
(migrations são aditivas); o dump fica em `deploy_backups/db-pre-<sha>-<stamp>.sql.gz`.

### Gateway do WhatsApp (Conversas)

Deploy separado; nunca reinicia zuno-api/zuno-web/zuno-postgres. Em produção o stack roda com
projeto `conversas-gateway`, compose em `/opt/zuno` e env em `/opt/conversas-spike`:

```bash
scp docker-compose.conversas-gateway.yml root@62.83.93.42:/opt/zuno/
ssh root@62.83.93.42 'docker compose -p conversas-gateway --env-file /opt/conversas-spike/.env.conversas -f /opt/zuno/docker-compose.conversas-gateway.yml up -d'
ssh root@62.83.93.42 'docker ps --filter name=conversas-gateway --format "table {{.Names}}\t{{.Status}}"'
```

Atenção: `scripts/deploy-conversas-gateway.sh` usa por padrão `/opt/conversas-gateway`, que não é
o layout de produção; use os comandos acima (ou ajuste `DEPLOY_REMOTE_DIR`) até o script ser
alinhado. A sessão do WhatsApp fica em volume Docker e sobrevive ao `up -d`.

### Regras

- Nunca commitar `.env.zuno` real, senha SSH, token, chave privada ou segredo operacional.
- Nunca sobrescrever `.env.zuno` nem `.env.conversas` do servidor durante deploy.
- Sempre usar o script oficial (backup em `/opt/zuno/deploy_backups/` antes de trocar código).
- Nunca `docker compose up --build` com web + api + worker juntos.
- Nunca mexer em `/opt/rumoaoaltar`, `/opt/preco-baixo-club` ou `/opt/edge` num deploy do Vorix.

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
7. `SECRET_MANAGER_PROVIDER` — `local` para sandbox (não durável, aceitável só fora de produção real); `production` usa `PostgresSecretManager` (real, durável) quando `PERSISTENCE_DRIVER=postgres`/`DATABASE_URL` estão configurados (item 5 acima) — só degrada para um stub fail-closed se essas duas variáveis faltarem, o que nunca deveria acontecer numa produção configurada corretamente.
8. `npm run zuno:api` — sobe a API.
9. `cd web && npm run build && npm start` — sobe o frontend (`NEXT_PUBLIC_API_URL` apontando para a API).
10. Confirmar `GET /readyz` → `ready: true` e `GET /v1/system/release-gate` → `productionEnabled: false` antes de considerar o ambiente "no ar".

## Nunca fazer nesta fase

- Setar `PUBLICATION_PRODUCTION_ENABLED=true` sem um Secret Manager de produção real conectado — o `ProductionGuard` deveria bloquear, mas não confiar cegamente nisso como única camada de defesa.
- Expor a API sem `@fastify/cors` restrito a uma origem conhecida — o padrão já é restrito (`localhost:3001`), mas confirmar `API_CORS_ORIGIN` em cada ambiente.
- Rodar sem headers de segurança adicionais (`helmet`/CSP) — nenhum está registrado hoje (achado do relatório final); não é um bloqueador para sandbox, mas é um requisito antes de qualquer exposição pública real.

## Rollback

Não existe rollback automatizado de migrations (decisão documentada em `migration-runner.ts` — cada migration reverte só a si mesma se falhar durante a aplicação; migrations já commitadas nunca são desfeitas automaticamente). Rollback de uma migration já aplicada = restaurar de backup + reaplicar as migrations anteriores, ou escrever uma migration forward-only de correção. Planejar isso explicitamente antes de qualquer deploy de produção real.
