#!/bin/bash
set -euo pipefail
umask 077
BACKUP=${1:?Informe o backup de mídia validado}
case "$BACKUP" in /opt/backups/vorix-media/media-[0-9]*.tgz) ;; *) echo QA_MEDIA_BACKUP_PATH_REQUIRED; exit 1 ;; esac
test -f "$BACKUP"
QA="vorix-restore-media-qa-$(date -u +%Y%m%d%H%M%S)"
cleanup(){ case "$QA" in vorix-restore-media-qa-[0-9]*) docker volume rm "$QA" >/dev/null ;; esac; }
docker volume create "$QA" >/dev/null
trap cleanup EXIT
SECONDS=0
docker run --rm --network none --memory 128m --cpus .5 -v /opt/backups/vorix-media:/backup:ro -v "$QA:/restore" \
  --entrypoint tar zuno-zuno-api:latest -xzf "/backup/$(basename "$BACKUP")" -C /restore
COUNTS=$(docker run --rm --network none --memory 128m -v "$QA:/restore:ro" --entrypoint sh zuno-zuno-api:latest -c 'for d in uploads inbox-media social-gateway; do printf "%s=" "$d"; find "/restore/$d" -type f | wc -l; done')
echo "MEDIA_RESTORE_TEST=PASS seconds=$SECONDS target=discarded-private-QA-volume"
printf '%s\n' "$COUNTS"
