#!/bin/bash
set -euo pipefail
umask 077
BACKUP_DIR=/opt/backups/vorix-media
STAMP=$(date -u +%Y%m%d%H%M%S)
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
exec 9>/run/lock/vorix-media-backup.lock
flock -n 9 || exit 0
OUT="$BACKUP_DIR/media-$STAMP.tgz"
# Read-only named volumes, no network, no changes to source files or live services.
docker run --rm --network none --memory 128m --cpus .5 \
  -v zuno_uploads:/source/uploads:ro -v zuno_inbox_media:/source/inbox-media:ro -v zuno_social_gateway:/source/social-gateway:ro \
  -v "$BACKUP_DIR:/backup" --entrypoint tar zuno-zuno-api:latest -czf "/backup/media-$STAMP.tgz.partial" -C /source .
gzip -t "$OUT.partial"
mv "$OUT.partial" "$OUT"
chmod 600 "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
# Keep at least the last two validated snapshots, even if the schedule has not run for weeks.
mapfile -t files < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'media-*.tgz' | sort -r)
for old in "${files[@]:2}"; do
  if find "$old" -mtime +14 | grep -q .; then rm -f -- "$old" "$old.sha256"; fi
done
echo "MEDIA_BACKUP_OK file=$OUT bytes=$(stat -c%s "$OUT")"
