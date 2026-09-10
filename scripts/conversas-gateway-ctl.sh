#!/bin/bash
set -euo pipefail

# Módulo Conversas — Fase 10.1 (Pre-Homologação, fechamento de pendências residuais).
#
# Wrapper operacional único para o stack do gateway Conversas (WuzAPI + RabbitMQ + Postgres
# dedicado). Existe para eliminar a classe de incidente já ocorrida em produção: um operador
# rodando `docker compose -f docker-compose.conversas-gateway.yml up -d` direto, sem
# `--env-file`, sobe os três containers com credenciais em branco (ver docs/conversas-runbook.md,
# seção "Comando oficial"). Este script é o ÚNICO jeito suportado de operar o stack no servidor —
# ele SEMPRE injeta o `--env-file` correto, então o operador não precisa lembrar do caminho
# (`/opt/conversas-spike/.env.conversas`, um resquício do spike original — ver
# docs/conversas-pre-homologacao-fechamento-final.md, seção "opt/conversas-spike", pra decisão de
# manter como está nesta fase).
#
# Uso (rodar NO SERVIDOR, a partir de qualquer diretório):
#   scripts/conversas-gateway-ctl.sh up          # sobe/recria o stack (equivalente a `up -d`)
#   scripts/conversas-gateway-ctl.sh restart      # restart de todos os serviços do stack
#   scripts/conversas-gateway-ctl.sh restart wuzapi   # restart só de um serviço
#   scripts/conversas-gateway-ctl.sh logs [serviço]   # segue logs (todos ou de um serviço)
#   scripts/conversas-gateway-ctl.sh ps           # status/health dos containers
#   scripts/conversas-gateway-ctl.sh health       # curl no /health de cada serviço com endpoint HTTP
#   scripts/conversas-gateway-ctl.sh down         # para o stack (NUNCA remove volumes)
#
# Variáveis de override (só pra ambientes não-padrão; produção nunca precisa setar nenhuma):
#   CONVERSAS_COMPOSE_FILE  (default: /opt/zuno/docker-compose.conversas-gateway.yml)
#   CONVERSAS_ENV_FILE      (default: /opt/conversas-spike/.env.conversas)

COMPOSE_FILE="${CONVERSAS_COMPOSE_FILE:-/opt/zuno/docker-compose.conversas-gateway.yml}"
ENV_FILE="${CONVERSAS_ENV_FILE:-/opt/conversas-spike/.env.conversas}"
CMD="${1:-}"
shift || true

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERRO: compose file não encontrado em $COMPOSE_FILE" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "ERRO: env-file não encontrado em $ENV_FILE — NUNCA rode este stack sem ele (credenciais em branco)." >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

case "$CMD" in
  up)
    compose up -d
    ;;
  recreate)
    compose up -d --force-recreate
    ;;
  restart)
    compose restart "$@"
    ;;
  logs)
    compose logs -f --tail 200 "$@"
    ;;
  ps)
    compose ps
    ;;
  health)
    echo "== WuzAPI /health =="
    docker exec conversas-gateway-wuzapi-1 wget -qO- http://localhost:8080/health 2>/dev/null \
      || docker exec conversas-gateway-wuzapi-1 curl -sf http://localhost:8080/health \
      || echo "(indisponível)"
    echo
    echo "== Status dos containers =="
    compose ps
    ;;
  down)
    compose down
    ;;
  *)
    echo "Uso: $0 {up|recreate|restart [serviço]|logs [serviço]|ps|health|down}" >&2
    exit 1
    ;;
esac
