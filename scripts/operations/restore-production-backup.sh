#!/bin/bash
# Restore proof in an isolated internal Docker network: no published ports or provider access.
set -euo pipefail
umask 077
ROOT=/opt/zuno
STAMP=$(date -u +%Y%m%d%H%M%S)
QA="vorix-restore-qa-$STAMP"
OUT="$ROOT/deploy_backups/restore-proof-$STAMP"
mkdir -p "$OUT"
chmod 700 "$OUT"
cleanup() {
  # Names are fixed-prefix artifacts created by this script, never production services/volumes.
  case "$QA" in vorix-restore-qa-[0-9]*) docker rm -f "$QA-api" "$QA-db" >/dev/null 2>&1 || true; docker network rm "$QA" >/dev/null 2>&1 || true ;; esac
  rm -f "$OUT/qa.env"
}
trap cleanup EXIT
DB_BACKUP="${1:-}"
if [ -z "$DB_BACKUP" ]; then
  DB_BACKUP="$OUT/database.sql.gz"
  docker exec zuno-zuno-postgres-1 pg_dump -U zuno -d zuno --no-owner | gzip > "$DB_BACKUP.partial"
  gzip -t "$DB_BACKUP.partial"
  mv "$DB_BACKUP.partial" "$DB_BACKUP"
fi
gzip -t "$DB_BACKUP"
sha256sum "$DB_BACKUP" > "$OUT/backup.sha256"
docker inspect -f '{{.Image}}' zuno-zuno-api-1 > "$OUT/api-image.txt"
IMAGE=$(cat "$OUT/api-image.txt")
# Only necessary settings; external accounts and all external schedulers remain unconfigured.
docker exec zuno-zuno-api-1 node -e 'console.log("JWT_SECRET="+process.env.JWT_SECRET)' > "$OUT/qa.env"
cat >> "$OUT/qa.env" <<EOF
DATABASE_URL=postgres://zuno:qa-restore-only@$QA-db:5432/vorix_restore_qa
AUTH_MODE=jwt
PERSISTENCE_DRIVER=postgres
SECRET_MANAGER_PROVIDER=production
API_PORT=3000
API_HOST=0.0.0.0
ZUNO_LOG_LEVEL=warn
EOF
docker network create --internal "$QA" >/dev/null
docker run -d --name "$QA-db" --network "$QA" --memory 256m --log-opt max-size=5m --log-opt max-file=2 \
  -e POSTGRES_USER=zuno -e POSTGRES_PASSWORD=qa-restore-only -e POSTGRES_DB=vorix_restore_qa postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$QA-db" pg_isready -U zuno -d vorix_restore_qa >/dev/null && break; sleep 1; done
SECONDS=0
gzip -dc "$DB_BACKUP" | docker exec -i "$QA-db" psql -X -v ON_ERROR_STOP=1 -U zuno -d vorix_restore_qa > "$OUT/restore.log" 2>&1
docker exec "$QA-db" psql -X -At -U zuno -d vorix_restore_qa -c "select 'migrations='||count(*) from schema_migrations union all select 'products='||count(*) from products union all select 'orders='||count(*) from commerce_orders union all select 'contacts='||count(*) from contacts" > "$OUT/counts.txt"
docker run -d --name "$QA-api" --network "$QA" --memory 512m --env-file "$OUT/qa.env" --log-opt max-size=5m --log-opt max-file=2 "$IMAGE" node dist/interfaces/api/server.js >/dev/null
docker exec "$QA-api" node scripts/migrate.mjs status > "$OUT/migrations.txt"
docker exec "$QA-api" node --input-type=module -e 'import pg from "pg";import {PostgresSecretManager} from "./dist/infrastructure/operations/postgres-secret-manager.js";const p=new pg.Pool({connectionString:process.env.DATABASE_URL});try{const {rows}=await p.query("select reference from operational_secrets limit 1");if(rows.length){const s=await new PostgresSecretManager(p,process.env.JWT_SECRET).get(rows[0].reference);if(!s?.value)throw Error("RESTORED_SECRET_DECRYPTION_FAILED");console.log("restoredSecretDecryption=PASS");}else console.log("restoredSecretDecryption=NO_STORED_SECRETS");}finally{await p.end();}' > "$OUT/secrets.txt"
for _ in $(seq 1 45); do
  if docker exec "$QA-api" node -e 'fetch("http://127.0.0.1:3000/readyz").then(async r=>{const j=await r.json();if(!j.data?.ready)process.exit(1);console.log(JSON.stringify(j))}).catch(()=>process.exit(1))' > "$OUT/health.json" 2>/dev/null; then break; fi
  sleep 2
done
test -s "$OUT/health.json"
docker exec "$QA-api" node --input-type=module -e 'import pg from "pg";const p=new pg.Pool({connectionString:process.env.DATABASE_URL});try{const {rows}=await p.query("select slug from tenant_sites where published is not null limit 1");if(!rows.length)throw Error("RESTORED_PUBLISHED_SITE_REQUIRED");const r=await fetch("http://127.0.0.1:3000/v1/public/sites/"+rows[0].slug);console.log("publicRouteStatus="+r.status);if(!r.ok)process.exitCode=1;}finally{await p.end();}' > "$OUT/public-route.txt"
echo "RESTORE_TEST=PASS seconds=$SECONDS isolation=internal-network output=$OUT"
cat "$OUT/counts.txt"
tail -1 "$OUT/migrations.txt"
cat "$OUT/public-route.txt"
cat "$OUT/secrets.txt"
