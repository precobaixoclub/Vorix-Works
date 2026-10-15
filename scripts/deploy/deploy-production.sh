#!/bin/sh
# Deploy de produção do Vorix (host único, docker compose) — procedimento OFICIAL e automatizado.
#
# Uso (no host, como root):
#   sh scripts/deploy/deploy-production.sh <tarball-do-commit.tgz> <sha> [api|web|all]
#     api (padrão) = zuno-api + vorix-worker; web = zuno-web; all = os três (em sequência).
#
# Etapas (qualquer falha antes do restart aborta sem tocar no que está no ar):
#  1. preflight: espaço em disco, .env presente, compose válido;
#  2. backup: código atual (tgz), .env.zuno e BANCO (pg_dump comprimido) em deploy_backups/;
#  3. imagens atuais re-etiquetadas `:rollback-<stamp>` (rollback instantâneo, sem rebuild);
#  4. troca do código pelo tarball do commit (o .env.zuno nunca é tocado; hash conferido);
#  5. build SEQUENCIAL, um serviço por vez — o build conjunto (web + api + worker) estoura a memória
#     do host (achado operacional);
#  6. migrations em processo temporário com a imagem nova; falhas impedem a troca dos serviços;
#  7. restart dos serviços com as imagens novas (`--no-build`);
#  8. health: containers healthy, /readyz, web 200, logs sem fatal/uncaught;
#  9. se o health falhar: ROLLBACK automático para as imagens `:rollback-<stamp>` e código anterior.
set -eu
# O passo 4 substitui scripts/: o sh lê o arquivo aos poucos, então nunca executa a partir do repo.
case "$0" in
  /tmp/vorix-deploy-run-*) ;;
  *) RUN_COPY="/tmp/vorix-deploy-run-$$.sh"; cp "$0" "$RUN_COPY"; exec sh "$RUN_COPY" "$@" ;;
esac
TARBALL="$1"; SHA="$2"; TARGET="${3:-api}"
ROOT=/opt/zuno
COMPOSE="docker compose --env-file .env.zuno -f docker-compose.zuno.yml"
STAMP="$(date +%Y%m%d%H%M%S)"
LOG="/var/log/vorix-deploy-$SHA-$STAMP.log"
KEEP_ROLLBACK_IMAGES=3
exec > "$LOG" 2>&1
echo "DEPLOY $SHA target=$TARGET stamp=$STAMP"
cd "$ROOT"

case "$TARGET" in
  api) SERVICES="zuno-api vorix-worker" ;;
  web) SERVICES="zuno-web" ;;
  all) SERVICES="zuno-api vorix-worker zuno-web" ;;
  *) echo "alvo inválido: $TARGET"; echo DEPLOY_FAILED; exit 2 ;;
esac
image_of() { case "$1" in zuno-api) echo zuno-zuno-api ;; vorix-worker) echo zuno-vorix-worker ;; zuno-web) echo zuno-zuno-web ;; esac; }

# 1. preflight
[ -f "$TARBALL" ] || { echo "tarball ausente"; echo DEPLOY_FAILED; exit 1; }
[ -f .env.zuno ] || { echo ".env.zuno ausente"; echo DEPLOY_FAILED; exit 1; }
FREE_MB=$(df -Pm / | awk 'NR==2{print $4}')
[ "$FREE_MB" -ge 4000 ] || { echo "PREFLIGHT_DISK: só ${FREE_MB}MB livres (mínimo 4000)"; echo DEPLOY_FAILED; exit 1; }
tar -tzf "$TARBALL" docker-compose.zuno.yml Dockerfile >/dev/null || { echo "tarball sem compose/Dockerfile"; echo DEPLOY_FAILED; exit 1; }
echo "PREFLIGHT_OK free=${FREE_MB}MB"

# 2. backup
mkdir -p deploy_backups
ENV_BEFORE=$(md5sum .env.zuno | cut -c1-12)
cp .env.zuno "/root/.env.zuno.pre-$SHA-$STAMP"
tar -czf "deploy_backups/pre-$SHA-$STAMP.tgz" --exclude=./deploy_backups --exclude=./node_modules --exclude=./web/node_modules --exclude=./web/.next --exclude=./dist .
umask 077
DB_DUMP="deploy_backups/db-pre-$SHA-$STAMP.sql"
docker exec zuno-zuno-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' > "$DB_DUMP" || { echo "BACKUP_DB_FAILED"; echo DEPLOY_FAILED; exit 1; }
[ -s "$DB_DUMP" ] || { echo "BACKUP_DB_EMPTY"; echo DEPLOY_FAILED; exit 1; }
gzip "$DB_DUMP"
gzip -t "$DB_DUMP.gz"
echo "BACKUP code=deploy_backups/pre-$SHA-$STAMP.tgz db=deploy_backups/db-pre-$SHA-$STAMP.sql.gz env=/root/.env.zuno.pre-$SHA-$STAMP"

# 3. imagens atuais → :rollback-<stamp>
for service in $SERVICES; do
  image=$(image_of "$service")
  docker image inspect "$image:latest" >/dev/null 2>&1 && docker tag "$image:latest" "$image:rollback-$STAMP" && echo "ROLLBACK_TAG $image:rollback-$STAMP"
done

rollback() {
  echo "ROLLBACK: $1"
  rm -rf assets db docs examples scripts src tests web Dockerfile docker-compose.zuno.yml package.json package-lock.json tsconfig.json
  tar -xzf "deploy_backups/pre-$SHA-$STAMP.tgz" -C "$ROOT"
  for service in $SERVICES; do
    image=$(image_of "$service")
    docker image inspect "$image:rollback-$STAMP" >/dev/null 2>&1 && docker tag "$image:rollback-$STAMP" "$image:latest"
  done
  $COMPOSE up -d --no-build $SERVICES
  echo "ROLLED_BACK (banco não é revertido: migrations são aditivas; dump em deploy_backups/db-pre-$SHA-$STAMP.sql.gz)"
  echo DEPLOY_FAILED
  exit 1
}

# 4. troca do código
rm -rf assets db docs examples scripts src tests web .dockerignore .editorconfig .env.example .env.zuno.example .gitignore CHANGELOG.md Dockerfile README.md docker-compose.zuno.yml package.json package-lock.json tsconfig.json scratch-creative-benchmark.mjs
tar -xzf "$TARBALL" -C "$ROOT"
chown -R root:root "$ROOT"
ENV_AFTER=$(md5sum .env.zuno | cut -c1-12)
echo "ENV before=$ENV_BEFORE after=$ENV_AFTER"
[ "$ENV_BEFORE" = "$ENV_AFTER" ] || rollback "ENV_CHANGED: .env.zuno mudou durante a troca de código"


# 5. build sequencial (memória do host)
for service in $SERVICES; do
  echo "BUILD $service"
  $COMPOSE build "$service" || rollback "build de $service falhou"
done

# 6. Valida/aplica migrations com a imagem nova ANTES de trocar processos ativos.
# Saídas em arquivo preservam o exit code real: em /bin/sh, `cmd | tail` pode esconder falhas.
if echo "$SERVICES" | grep -q zuno-api; then
  MIGRATION_LOG="/var/log/vorix-migrations-$SHA-$STAMP.log"
  $COMPOSE run --rm --no-deps zuno-api node scripts/migrate.mjs status > "$MIGRATION_LOG" 2>&1 || rollback "consulta de migrations falhou"
  if grep -q "CHECKSUM DIVERGENTE" "$MIGRATION_LOG"; then rollback "divergência de checksum de migration"; fi
  echo "MIGRATIONS_BEFORE $(tail -1 "$MIGRATION_LOG")"
  $COMPOSE run --rm --no-deps zuno-api node scripts/migrate.mjs >> "$MIGRATION_LOG" 2>&1 || rollback "migration falhou; consultar $MIGRATION_LOG"
  $COMPOSE run --rm --no-deps zuno-api node scripts/migrate.mjs status >> "$MIGRATION_LOG" 2>&1 || rollback "verificação final de migrations falhou"
  echo "MIGRATIONS_AFTER $(tail -1 "$MIGRATION_LOG")"
fi

$COMPOSE up -d --no-build $SERVICES || rollback "restart falhou"

# 8 (parcial). espera healthy antes de migrar
wait_healthy() {
  for _ in $(seq 1 50); do
    ok=1
    for service in $SERVICES; do
      [ "$service" = "zuno-web" ] && continue
      status=$(docker inspect -f '{{.State.Health.Status}}' "zuno-$service-1" 2>/dev/null || echo none)
      [ "$status" = "healthy" ] || ok=0
    done
    [ "$ok" = 1 ] && return 0
    sleep 6
  done
  return 1
}
wait_healthy || rollback "containers não ficaram healthy"

# 8. health final
READY=$(curl -s https://api.vorixworks.com/readyz | grep -o '"ready":[a-z]*' || true)
WEB="000"
for _ in $(seq 1 12); do
  WEB=$(curl -s -o /dev/null -w '%{http_code}' https://vorixworks.com/ || true)
  [ "$WEB" = "200" ] && break
  sleep 5
done
ERRORS=$(for service in $SERVICES; do docker logs --since 3m "zuno-$service-1" 2>&1; done | grep -icE 'fatal|uncaught|unhandled' || true)
echo "READYZ $READY WEB $WEB LOG_ERRORS $ERRORS"
[ "$READY" = '"ready":true' ] || rollback "readyz falhou"
[ "$WEB" = "200" ] || rollback "web não respondeu 200"
[ "$ERRORS" = "0" ] || rollback "erros fatais nos logs"

# limpeza: mantém só as últimas N imagens de rollback por serviço
for service in $SERVICES; do
  image=$(image_of "$service")
  docker images --format '{{.Tag}}' "$image" | grep '^rollback-' | sort -r | tail -n +$((KEEP_ROLLBACK_IMAGES + 1)) | while read -r tag; do docker rmi "$image:$tag" >/dev/null 2>&1 || true; done
done
echo "DEPLOYED $SHA"
echo DEPLOY_DONE
