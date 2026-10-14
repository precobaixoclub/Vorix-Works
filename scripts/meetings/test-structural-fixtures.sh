#!/usr/bin/env bash
set -euo pipefail
lab=${MEETINGS_HOMOLOG_ROOT:-/root/vorix-homolog/customer-managed-20261014}
workspace=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
docker run --rm --network host --env-file "$lab/secrets/structural-fixture.env" \
  -e DATABASE_URL="$(docker exec vorix-structural-fixture-api node -e 'const u=new URL(process.env.DATABASE_URL);u.hostname="127.0.0.1";u.port="55470";process.stdout.write(u.toString())')" \
  -v "$workspace/tests:/app/tests:ro" --entrypoint node \
  vorix-meetings-recorder:customer-managed-0148 --test /app/tests/meetings-self-service-browser.test.mjs \
  > "$lab/structural-fixtures/evidence/browser-tests.log" 2>&1
tail -n 15 "$lab/structural-fixtures/evidence/browser-tests.log"
