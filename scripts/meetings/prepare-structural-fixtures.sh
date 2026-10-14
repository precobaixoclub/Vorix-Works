#!/usr/bin/env bash
set -euo pipefail
lab=${MEETINGS_HOMOLOG_ROOT:-/root/vorix-homolog/customer-managed-20261014}
workspace=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
mkdir -p "$lab/structural-fixtures/storage" "$lab/structural-fixtures/evidence"
chown -R 10001:10001 "$lab/structural-fixtures"
LAB_ROOT="$lab" python3 <<'PY'
import pathlib,os,secrets,urllib.parse
lab=pathlib.Path(os.environ['LAB_ROOT'])
env=dict(line.split('=',1) for line in (lab/'secrets/runtime.env').read_text().splitlines() if '=' in line)
target=lab/'secrets/structural-fixture.env'
url=urllib.parse.urlsplit(env['DATABASE_URL'])
assert url.hostname=='vorix-homolog-pg'
env['DATABASE_URL']=urllib.parse.urlunsplit(url._replace(path='/vorix_structural_fixture_20261014'))
previous=dict(line.split('=',1) for line in target.read_text().splitlines() if '=' in line) if target.exists() else {}
env.update(JWT_SECRET=previous.get('JWT_SECRET') or secrets.token_urlsafe(48),API_PORT='3300',API_CORS_ORIGIN='http://localhost:3301',OBJECT_STORAGE_LOCAL_DIR='/data/objects',OBJECT_STORAGE_PUBLIC_BASE_URL='http://localhost:3300/uploads',VORIX_STRUCTURAL_FIXTURE_API_URL='http://localhost:3300',VORIX_STRUCTURAL_FIXTURE_WEB_URL='http://localhost:3301',VORIX_STRUCTURAL_FIXTURE_CONTROL_URL='http://localhost:3310')
target.write_text(''.join(f'{k}={v}\n' for k,v in env.items()));target.chmod(0o600)
PY
exists=$(docker exec vorix-homolog-pg psql -U postgres -d vorix_homolog -tAc "select count(*) from pg_database where datname='vorix_structural_fixture_20261014'")
if [[ "$exists" == 0 ]]; then docker exec vorix-homolog-pg createdb -U postgres vorix_structural_fixture_20261014; fi
docker run --rm --network vorix-homolog --env-file "$lab/secrets/structural-fixture.env" \
  -v "$lab/source/db:/app/db:ro" vorix-meetings-homolog-tools:0148 npm run db:migrate \
  > "$lab/structural-fixtures/evidence/migrations.log" 2>&1
if docker inspect vorix-structural-fixture-api >/dev/null 2>&1; then
  docker start vorix-structural-fixture-api >/dev/null
else
docker run -d --name vorix-structural-fixture-api --network vorix-homolog --restart unless-stopped \
  --env-file "$lab/secrets/structural-fixture.env" -v "$lab/structural-fixtures/storage:/data/objects" \
  -v "$workspace/tests:/app/tests:ro" -p 127.0.0.1:3300:3300 --entrypoint node \
  vorix-meetings-recorder:customer-managed-0148 /app/tests/fixtures/meetings-structural-api.mjs >/dev/null
fi
if docker inspect vorix-structural-fixture-provisioner >/dev/null 2>&1; then
  docker start vorix-structural-fixture-provisioner >/dev/null
else
docker run -d --name vorix-structural-fixture-provisioner --network vorix-homolog --restart unless-stopped \
  --env-file "$lab/secrets/structural-fixture.env" -v "$workspace/tests:/app/tests:ro" \
  -p 127.0.0.1:3310:3310 --entrypoint node \
  vorix-meetings-recorder:customer-managed-0148 /app/tests/fixtures/meetings-structural-provisioner.mjs >/dev/null
fi
printf 'FIXTURE_API_AND_SIMULATOR_STARTED\n'
