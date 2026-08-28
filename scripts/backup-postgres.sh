#!/usr/bin/env bash
# Backup automatizado de Postgres — lacuna pré-existente encontrada na auditoria do módulo
# Conversas: NENHUM backup automatizado existia (nem para o `zuno-postgres` atual, nem para
# qualquer outro banco). Faz `pg_dump` de `zuno-postgres` e, se o container existir,
# `wuzapi-postgres` também — via `docker exec`, sem precisar expor porta nenhuma dos bancos.
#
# Uso recomendado: crontab do HOST (não um container dedicado — mantém a infra simples, ver plano
# técnico "Não criar complexidade excessiva"), ex.: rodar 1x/dia às 03:00:
#   0 3 * * * /opt/zuno/scripts/backup-postgres.sh >> /var/log/vorix-backup.log 2>&1
#
# Backup não testado não é backup confiável — validar restore periodicamente com:
#   gunzip -c <arquivo>.sql.gz | docker exec -i <container> psql -U <user> -d <db_temporario>
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d%H%M%S)"

mkdir -p "$BACKUP_DIR"

dump_container() {
  local container="$1" user="$2" db="$3"
  if ! docker inspect "$container" >/dev/null 2>&1; then
    echo "==> $container não encontrado, pulando."
    return 0
  fi
  local out="$BACKUP_DIR/${db}-${STAMP}.sql.gz"
  echo "==> Backup de $container ($db) -> $out"
  docker exec "$container" pg_dump -U "$user" -d "$db" | gzip > "$out"
}

dump_container "zuno-postgres" "zuno" "zuno"
dump_container "wuzapi-postgres" "wuzapi" "wuzapi"

echo "==> Removendo backups com mais de ${RETENTION_DAYS} dias em $BACKUP_DIR"
find "$BACKUP_DIR" -name "*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "==> Backup concluído: $(ls -1 "$BACKUP_DIR" | wc -l) arquivo(s) em $BACKUP_DIR"
