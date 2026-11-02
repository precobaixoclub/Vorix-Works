#!/bin/sh
# Consultas locais autenticadas, sem iniciar outra VM Erlang a cada healthcheck.
# Os endpoints são compatíveis com o RabbitMQ 3.13 usado pelo gateway.
set -eu
[ -n "${RABBITMQ_DEFAULT_USER:-}" ] && [ -n "${RABBITMQ_DEFAULT_PASS:-}" ]
auth=$(printf '%s:%s' "$RABBITMQ_DEFAULT_USER" "$RABBITMQ_DEFAULT_PASS" | base64 | tr -d '\n')
for check in virtual-hosts protocol-listener/amqp; do
  wget -q -T 4 -O /dev/null --header="Authorization: Basic $auth" "http://127.0.0.1:15672/api/health/checks/$check"
done
