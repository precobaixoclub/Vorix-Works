#!/bin/bash
set -euo pipefail
umask 077
cd /opt/zuno
STAMP=$(date -u +%Y%m%d%H%M%S)
crontab -l > "/root/vorix-crontab-before-$STAMP" || true
install -m 600 scripts/operations/vorix-logrotate.conf /etc/logrotate.d/vorix
chmod 700 scripts/backup-postgres.sh scripts/operations/monitor-host.sh scripts/operations/host-maintenance.sh
python3 - "/root/vorix-crontab-before-$STAMP" <<'PY' | crontab -
import sys
lines=open(sys.argv[1]).readlines()
for line in lines:
 if 'docker system prune' in line or any(s in line for s in ['/opt/zuno/scripts/backup-postgres.sh','/opt/zuno/scripts/operations/monitor-host.sh','/opt/zuno/scripts/operations/host-maintenance.sh','/opt/zuno/scripts/operations/backup-volumes.sh']): continue
 print(line.rstrip())
print('30 3 * * * /opt/zuno/scripts/backup-postgres.sh >> /var/log/vorix-backup.log 2>&1')
print('*/5 * * * * /opt/zuno/scripts/operations/monitor-host.sh >> /var/log/vorix-monitor.log 2>&1')
print('15 4 * * 0 /opt/zuno/scripts/operations/host-maintenance.sh >> /var/log/vorix-maintenance.log 2>&1')
print('30 4 * * 0 bash /opt/zuno/scripts/operations/backup-volumes.sh >> /var/log/vorix-media-backup.log 2>&1')
PY
logrotate --debug /etc/logrotate.d/vorix >/dev/null 2>&1
echo "OPERATIONS_INSTALLED previous_crontab=/root/vorix-crontab-before-$STAMP"
