#!/bin/bash
set -euo pipefail
umask 077
exec 9>/run/lock/vorix-monitor.lock
flock -n 9 || exit 0
ENVFILE=$(mktemp /tmp/vorix-monitor-env.XXXXXX)
trap 'rm -f "$ENVFILE"' EXIT
# Inspect works even when the API process has stopped. Credentials stay in a private temporary file.
docker inspect zuno-zuno-api-1 | python3 -c 'import json,sys; c=json.load(sys.stdin)[0]; print(next(v for v in c["Config"]["Env"] if v.startswith("DATABASE_URL=")))' > "$ENVFILE"
FAILURES=$(python3 - <<'PY'
import subprocess,json,shutil
failures=[]
for name in ['zuno-zuno-api-1','zuno-vorix-worker-1','zuno-marketplaces-worker-1','zuno-social-provider-gateway-1','zuno-zuno-web-1','zuno-zuno-postgres-1']:
 try:
  c=json.loads(subprocess.check_output(['docker','inspect',name]))[0]
  if not c['State']['Running'] or c['State'].get('Health',{}).get('Status','healthy')=='unhealthy': failures.append(name+': unavailable')
  logs=subprocess.run(['docker','logs','--since','6m','--tail','1000',name],capture_output=True,text=True)
  count=sum(any(code in line.lower() for code in ['webhook de pagamento','marketplace notification failed','marketplace_worker_iteration_failed','fatal','uncaught']) for line in (logs.stdout+logs.stderr).splitlines())
  if count: failures.append(name+': operational_errors='+str(count))
 except Exception: failures.append(name+': inspection failed')
disk=shutil.disk_usage('/')
if disk.free/disk.total<.20: failures.append('disk: less than 20% free')
print(json.dumps(failures))
PY
)
IMAGE=$(docker inspect -f '{{.Image}}' zuno-zuno-api-1)
docker run --rm --network zuno_network --memory 128m --env-file "$ENVFILE" -e "OPERATIONS_HOST_FAILURES=$FAILURES" "$IMAGE" node scripts/operations/monitor.mjs
