#!/usr/bin/env bash
# Deploy do gateway do módulo Conversas (WuzAPI + RabbitMQ + Postgres dedicado) —
# DELIBERADAMENTE separado de docs/deployment.md (deploy do Vorix). Sincroniza só
# `docker-compose.conversas-gateway.yml` e sobe/atualiza esse stack; NUNCA toca em
# zuno-api/zuno-web/zuno-postgres. Requisito do módulo Conversas: um deploy não pode reiniciar o
# outro (ver plano técnico, "Containers").
#
# Uso: scripts/deploy-conversas-gateway.sh
# Variáveis (mesmo padrão de .env.zuno.example, mas para este stack):
#   DEPLOY_SSH_TARGET   (default: root@209.97.152.212, mesmo host do Vorix — VPS única por ora)
#   DEPLOY_REMOTE_DIR   (default: /opt/conversas-gateway — DIFERENTE de /opt/zuno, propositalmente)
set -euo pipefail

DEPLOY_SSH_TARGET="${DEPLOY_SSH_TARGET:-root@209.97.152.212}"
DEPLOY_REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/conversas-gateway}"
COMPOSE_FILE="docker-compose.conversas-gateway.yml"

echo "==> Pré-requisito: rede conversas_internal precisa existir (idempotente)."
ssh "$DEPLOY_SSH_TARGET" "docker network inspect conversas_internal >/dev/null 2>&1 || docker network create conversas_internal"

echo "==> Enviando $COMPOSE_FILE para $DEPLOY_SSH_TARGET:$DEPLOY_REMOTE_DIR"
ssh "$DEPLOY_SSH_TARGET" "mkdir -p $DEPLOY_REMOTE_DIR"
scp "$COMPOSE_FILE" "$DEPLOY_SSH_TARGET:$DEPLOY_REMOTE_DIR/$COMPOSE_FILE"

echo "==> ATENÇÃO: .env.conversas nunca é sincronizado por este script (segredo real só existe no"
echo "    servidor). Na primeira vez, copie manualmente a partir de .env.conversas.example e"
echo "    preencha os valores reais em $DEPLOY_REMOTE_DIR/.env.conversas — nunca sobrescrever depois."

echo "==> Subindo/atualizando o gateway (nunca toca em zuno-api/zuno-web/zuno-postgres)."
ssh "$DEPLOY_SSH_TARGET" "cd $DEPLOY_REMOTE_DIR && docker compose --env-file .env.conversas -f $COMPOSE_FILE up -d"

echo "==> Checando saúde dos serviços."
ssh "$DEPLOY_SSH_TARGET" "docker ps --filter name=conversas-gateway --format 'table {{.Names}}\t{{.Status}}'"
