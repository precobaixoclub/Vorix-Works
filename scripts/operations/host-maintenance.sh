#!/bin/bash
# Host-only maintenance. Never prunes volumes, databases, running/rollback images or recent backups.
set -euo pipefail
exec 9>/run/lock/vorix-maintenance.lock
flock -n 9 || exit 0
date -u +%FT%TZ
df -h /
# Build cache has no business data. Preserve a generous recent working set for deploys.
docker builder prune -f --filter until=168h --keep-storage 4GB
echo 'Maintenance complete; backups, volumes and images preserved.'
