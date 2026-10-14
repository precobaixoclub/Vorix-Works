#!/usr/bin/env bash
set -euo pipefail
lab=${MEETINGS_HOMOLOG_ROOT:-/root/vorix-homolog/customer-managed-20261014}
mkdir -p "$lab/structural-fixtures/evidence"
docker build --build-arg NEXT_PUBLIC_API_URL=http://localhost:3300 \
  -t vorix-meetings-web:structural-fixture-0148 "$lab/source/web" \
  > "$lab/structural-fixtures/evidence/web-build.log" 2>&1
if docker inspect vorix-structural-fixture-web >/dev/null 2>&1; then
  docker start vorix-structural-fixture-web >/dev/null
else
docker run -d --name vorix-structural-fixture-web --network vorix-homolog --restart unless-stopped \
  -e PORT=3301 -e HOSTNAME=0.0.0.0 -e API_INTERNAL_URL=http://vorix-structural-fixture-api:3300 \
  -p 127.0.0.1:3301:3301 vorix-meetings-web:structural-fixture-0148 >/dev/null
fi
printf 'FIXTURE_WEB_STARTED\n'
