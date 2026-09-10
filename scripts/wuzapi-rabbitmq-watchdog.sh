#!/bin/bash
set -euo pipefail

# Módulo Conversas — Fase 10.1 (Pre-Homologação, fechamento de pendências residuais).
#
# Mitigação mínima para um risco CONFIRMADO em runtime real (não só suspeitado): a WuzAPI esgota
# 10 tentativas de reconexão ao RabbitMQ em ~30s e depois NUNCA tenta de novo sozinha — ficou
# comprovado derrubando o RabbitMQ de propósito e observando o log da WuzAPI parar completamente
# de mencionar RabbitMQ, mesmo minutos depois do RabbitMQ voltar saudável. `GET /health` da WuzAPI
# continua respondendo {"status":"ok"} o tempo todo, nesse estado — não existe endpoint/env var
# nativo da imagem `asternic/wuzapi` que exponha "RabbitMQ connected: true/false" (auditado:
# `/health`, `/status`, `/metrics` — só o primeiro existe; sem variável de ambiente de tuning de
# retry). A única mitigação real confirmada é reiniciar o container: reconecta em segundos
# (`docker restart` → log "RabbitMQ connection established successfully" quase imediatamente),
# sem efeito colateral observado (nenhuma sessão WhatsApp derruba por causa disso).
#
# Design deliberadamente mínimo (nunca um serviço/container novo, nunca acesso ao docker.sock de
# dentro de um container): um script de shell rodando via CRON NO HOST, que só lê `docker logs`
# (read-only) e, se necessário, chama `docker restart` — a mesma ação que um operador humano faria
# manualmente, só automatizada. Instalar via crontab do root:
#
#   */5 * * * * /opt/zuno/scripts/wuzapi-rabbitmq-watchdog.sh >> /var/log/wuzapi-watchdog.log 2>&1
#
# (a cada 5 minutos é suficiente — o pior caso de mensagens perdidas por atraso de detecção é
# limitado pelo intervalo, mas o outbound tem reconciliação própria — ver docs/conversas-runbook.md
# seção 7 — e o inbound depende da WuzAPI já estar recebendo do WhatsApp, que é o problema real
# aqui, não algo que este watchdog piora).

CONTAINER="conversas-gateway-wuzapi-1"
LOOKBACK="${WUZAPI_WATCHDOG_LOOKBACK:-10m}"
LOCK_FILE="/tmp/wuzapi-rabbitmq-watchdog.lock"

# Evita restarts sobrepostos se uma execução anterior (não deveria, mas defensivo) ainda não saiu.
if [ -e "$LOCK_FILE" ]; then
  echo "[wuzapi-watchdog] $(date -u +%FT%TZ) lock já existe (execução anterior ainda em andamento ou travada) — pulando esta rodada."
  exit 0
fi
touch "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "[wuzapi-watchdog] $(date -u +%FT%TZ) container $CONTAINER não encontrado — nada a fazer."
  exit 0
fi

if ! docker logs --since "$LOOKBACK" --timestamps "$CONTAINER" 2>&1 | grep -q "Failed to reconnect to RabbitMQ after all retries"; then
  echo "[wuzapi-watchdog] $(date -u +%FT%TZ) nenhum erro terminal de RabbitMQ nos últimos $LOOKBACK — saudável."
  exit 0
fi

# Confirma que a WuzAPI não reconectou DEPOIS do erro mais recente (ex.: um restart manual já
# resolveu entre a última execução do cron e esta) — evita um restart redundante.
last_error_ts=$(docker logs --since "$LOOKBACK" --timestamps "$CONTAINER" 2>&1 | grep "Failed to reconnect to RabbitMQ after all retries" | tail -1 | awk '{print $1}')
last_success_ts=$(docker logs --since "$LOOKBACK" --timestamps "$CONTAINER" 2>&1 | grep "RabbitMQ connection established successfully" | tail -1 | awk '{print $1}')

if [ -n "$last_success_ts" ] && [[ "$last_success_ts" > "$last_error_ts" ]]; then
  echo "[wuzapi-watchdog] $(date -u +%FT%TZ) erro encontrado ($last_error_ts), mas já reconectou depois ($last_success_ts) — nada a fazer."
  exit 0
fi

echo "[wuzapi-watchdog] $(date -u +%FT%TZ) WuzAPI sem conexão com RabbitMQ desde $last_error_ts, sem reconexão espontânea — reiniciando o container."
docker restart "$CONTAINER"
echo "[wuzapi-watchdog] $(date -u +%FT%TZ) restart executado."
