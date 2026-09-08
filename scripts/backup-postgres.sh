#!/usr/bin/env bash
# Backup automatizado de Postgres — Fase 6 (Módulo Conversas: Resiliência/Observabilidade).
# Reforça o script já existente (lacuna original encontrada na auditoria da Fase 1: NENHUM backup
# automatizado existia, nem para `zuno-postgres`). Faz `pg_dump` de `zuno-postgres` e, se o
# container existir, `wuzapi-postgres` também — via `docker exec`, sem expor porta nenhuma dos
# bancos e sem senha em texto na linha de comando (a credencial já é local ao container).
#
# Uso recomendado: crontab do HOST (não um container/scheduler dedicado — mantém a infra simples,
# ver plano técnico "não criar complexidade excessiva"), ex.: rodar 1x/dia às 03:00:
#   0 3 * * * /opt/zuno/scripts/backup-postgres.sh >> /var/log/vorix-backup.log 2>&1
#
# Fase 6 — o que mudou em relação à primeira versão:
#   1) Uma falha em UM banco nunca impede o backup do outro (antes, `set -e` abortava tudo na
#      primeira falha) — cada dump é tentado independentemente, o exit code final reflete se
#      ALGUM falhou.
#   2) Log estruturado de sucesso/falha por execução em `$BACKUP_DIR/backup.log` (uma linha por
#      dump, sempre com timestamp), além do stdout/stderr já redirecionados pelo cron.
#   3) Cópia opcional para fora da VPS (`REMOTE_BACKUP_DEST`, via `rsync`/`scp`) — um disco local
#      sozinho nunca é backup de verdade contra perda da própria VPS. Best-effort: falha na cópia
#      remota nunca apaga/invalida o backup local já feito, só é logada separadamente.
#   4) `BACKUP_MANIFEST` (JSON, uma linha por execução) para o restore drill automatizado
#      (`scripts/restore-drill.mjs`) e para uma futura integração de alerta (Fase 7) saberem, sem
#      parsear log de texto, se a última execução teve sucesso.
#
# ACHADO REAL (homologação operacional, execução ao vivo na VPS): os nomes de container abaixo
# eram literais (`zuno-postgres`/`wuzapi-postgres`) desde a criação deste script, mas o Docker
# Compose v2 nomeia containers como `<nome-do-projeto>-<serviço>-<réplica>` — o nome real em
# produção é `zuno-zuno-postgres-1`/`conversas-gateway-wuzapi-postgres-1`. Resultado: este script
# rodou (quando rodado manualmente) sempre caindo no ramo "container não encontrado" pros DOIS
# bancos, e ainda reportava "Backup concluído (status=ok)" — nenhum backup real do Vorix jamais
# foi feito por este mecanismo. Corrigido para nomes configuráveis via env (default = nomes reais
# de produção) e pra `overall_status` refletir "zero dumps bem-sucedidos" como falha, não sucesso.
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
REMOTE_BACKUP_DEST="${REMOTE_BACKUP_DEST:-}"
ZUNO_POSTGRES_CONTAINER="${ZUNO_POSTGRES_CONTAINER:-zuno-zuno-postgres-1}"
WUZAPI_POSTGRES_CONTAINER="${WUZAPI_POSTGRES_CONTAINER:-conversas-gateway-wuzapi-postgres-1}"
STAMP="$(date +%Y%m%d%H%M%S)"
LOG_FILE="$BACKUP_DIR/backup.log"
MANIFEST_FILE="$BACKUP_DIR/backup-manifest.jsonl"

mkdir -p "$BACKUP_DIR"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" | tee -a "$LOG_FILE"
}

overall_status=0
success_count=0

dump_container() {
  local container="$1" user="$2" db="$3"
  if ! docker inspect "$container" >/dev/null 2>&1; then
    log "SKIP db=$db container=$container motivo=container_nao_encontrado"
    echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"db\":\"$db\",\"status\":\"skipped\",\"reason\":\"container_not_found\"}" >> "$MANIFEST_FILE"
    return 0
  fi
  local out="$BACKUP_DIR/${db}-${STAMP}.sql.gz"
  if docker exec "$container" pg_dump -U "$user" -d "$db" | gzip > "$out"; then
    local size_bytes
    size_bytes="$(stat -c%s "$out" 2>/dev/null || stat -f%z "$out" 2>/dev/null || echo 0)"
    log "OK db=$db container=$container arquivo=$out tamanho_bytes=$size_bytes"
    echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"db\":\"$db\",\"status\":\"ok\",\"file\":\"$out\",\"sizeBytes\":$size_bytes}" >> "$MANIFEST_FILE"
    success_count=$((success_count + 1))
  else
    log "FAIL db=$db container=$container — pg_dump/gzip falhou, ver saída acima."
    echo "{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"db\":\"$db\",\"status\":\"failed\"}" >> "$MANIFEST_FILE"
    rm -f "$out"
    overall_status=1
  fi
}

dump_container "$ZUNO_POSTGRES_CONTAINER" "zuno" "zuno"
dump_container "$WUZAPI_POSTGRES_CONTAINER" "wuzapi" "wuzapi"

# Zero dumps bem-sucedidos é sempre uma falha, mesmo que cada `dump_container` individualmente
# tenha "só" pulado por container não encontrado (nunca lançou erro) — é exatamente o cenário real
# encontrado na homologação: nomes de container errados faziam os dois serem pulados em silêncio,
# e o script ainda reportava "status=ok" no final.
if [ "$success_count" -eq 0 ]; then
  log "FALHA: nenhum backup real foi produzido nesta execução (nenhum container respondeu). Verifique ZUNO_POSTGRES_CONTAINER/WUZAPI_POSTGRES_CONTAINER."
  overall_status=1
fi

if [ -n "$REMOTE_BACKUP_DEST" ]; then
  log "Copiando backups desta execução para destino remoto: $REMOTE_BACKUP_DEST"
  if rsync -az "$BACKUP_DIR"/*"-${STAMP}.sql.gz" "$REMOTE_BACKUP_DEST" 2>>"$LOG_FILE"; then
    log "OK cópia remota concluída."
  else
    # Best-effort: cópia remota falhando NUNCA invalida o backup local já feito com sucesso —
    # só é registrado separadamente para investigação (ex.: alerta futuro na Fase 7).
    log "AVISO: cópia remota falhou (rsync) — backup local permanece válido, mas sem redundância fora da VPS nesta execução."
  fi
else
  log "AVISO: REMOTE_BACKUP_DEST não configurado — backup existe SÓ nesta VPS (sem redundância geográfica)."
fi

log "Removendo backups locais com mais de ${RETENTION_DAYS} dias em $BACKUP_DIR"
find "$BACKUP_DIR" -name "*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

log "Backup concluído (status=$([ $overall_status -eq 0 ] && echo ok || echo com_falhas)): $(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l) arquivo(s) em $BACKUP_DIR"
exit $overall_status
