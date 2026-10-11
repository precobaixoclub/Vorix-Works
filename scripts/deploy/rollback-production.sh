#!/bin/sh
# Rollback manual de produção para um deploy anterior (sem rebuild): re-etiqueta as imagens
# `:rollback-<stamp>` como `:latest`, restaura o código do backup correspondente e reinicia.
# O banco NÃO é revertido (migrations são aditivas e compatíveis com a versão anterior); o dump
# `deploy_backups/db-pre-<sha>-<stamp>.sql.gz` existe para recuperação de desastre.
#
# Uso: sh scripts/deploy/rollback-production.sh <stamp> [api|web|all]
#   (o <stamp> e o backup aparecem no log do deploy: /var/log/vorix-deploy-<sha>-<stamp>.log)
set -eu
STAMP="$1"; TARGET="${2:-api}"
ROOT=/opt/zuno
cd "$ROOT"
COMPOSE="docker compose --env-file .env.zuno -f docker-compose.zuno.yml"
case "$TARGET" in
  api) SERVICES="zuno-api vorix-worker" ;;
  web) SERVICES="zuno-web" ;;
  all) SERVICES="zuno-api vorix-worker zuno-web" ;;
  *) echo "alvo inválido"; exit 2 ;;
esac
image_of() { case "$1" in zuno-api) echo zuno-zuno-api ;; vorix-worker) echo zuno-vorix-worker ;; zuno-web) echo zuno-zuno-web ;; esac; }
BACKUP=$(ls deploy_backups/pre-*-"$STAMP".tgz 2>/dev/null | head -1)
[ -n "$BACKUP" ] || { echo "backup de código do stamp $STAMP não encontrado"; exit 1; }
for service in $SERVICES; do
  image=$(image_of "$service")
  docker image inspect "$image:rollback-$STAMP" >/dev/null 2>&1 || { echo "imagem $image:rollback-$STAMP ausente"; exit 1; }
done
ENV_BEFORE=$(md5sum .env.zuno | cut -c1-12)
rm -rf assets db docs examples scripts src tests web Dockerfile docker-compose.zuno.yml package.json package-lock.json tsconfig.json
tar -xzf "$BACKUP" -C "$ROOT"
[ "$(md5sum .env.zuno | cut -c1-12)" = "$ENV_BEFORE" ] || echo "AVISO: .env.zuno do backup difere do atual — conferir"
for service in $SERVICES; do
  image=$(image_of "$service")
  docker tag "$image:rollback-$STAMP" "$image:latest"
done
$COMPOSE up -d --no-build $SERVICES
for _ in $(seq 1 50); do
  sleep 6
  curl -s https://api.vorixworks.com/readyz | grep -q '"ready":true' && break
done
echo "READYZ $(curl -s https://api.vorixworks.com/readyz | grep -o '"ready":[a-z]*')"
echo ROLLBACK_DONE
