# Módulo Conversas — Roteiro para Fechar RUNTIME_VALIDATION_PENDING_BROKER

Execução real contra RabbitMQ (via `docker-compose.conversas-gateway.yml`), quando houver
acesso a Docker/VPS. Nenhum item aqui pode ser marcado validado sem execução real — a suíte de
testes automatizados já cobre a lógica de aplicação (retry/DLQ/idempotência) contra pglite; o que
falta é o comportamento do broker de verdade, que nenhum teste em memória reproduz fielmente.

## Pré-condição

`docker compose -f docker-compose.conversas-gateway.yml up -d` de pé (WuzAPI pode ficar com um
duplo/fake nesta etapa — o foco aqui é RabbitMQ, não o WhatsApp em si) e `vorix-worker` apontando
para esse RabbitMQ real via `INBOX_RABBITMQ_URL`.

## Roteiro

1. **Conexão inicial** — subir o worker; confirmar nos logs que ele conecta e declara toda a
   topologia (`ensureInboxTopology`): exchanges, filas principais, filas de retry, DLQs.
2. **RabbitMQ para** — `docker compose -f docker-compose.conversas-gateway.yml stop rabbitmq`
   com o worker rodando; confirmar que o worker detecta a queda (log claro de erro de conexão),
   não trava nem derruba o processo inteiro.
3. **RabbitMQ volta** — `docker compose ... start rabbitmq`; confirmar reconexão automática do
   worker sem restart manual, e que a topologia (filas/DLQ) sobrevive (declarada como `durable`).
4. **Mensagens não desaparecem durante a queda** — enfileirar algumas mensagens outbound
   (`sendInboxMessage`) enquanto o RabbitMQ está fora; confirmar que ficam `queued` no Postgres e
   são processadas normalmente assim que o broker volta (nenhuma perdida).
5. **ACK/NACK reais** — forçar uma falha transitória no provider (ex.: `FakeMessagingProvider`
   configurado para falhar N vezes) e confirmar que a mensagem realmente percorre a escada de
   retry (5s→15s→60s→300s) olhando as filas `*.retry-*ms` na management UI (via túnel SSH — nunca
   exposta publicamente), não só o comportamento do lado da aplicação.
6. **DLQ real** — forçar um erro permanente (`session_logged_out`/`permanent`) e confirmar que a
   mensagem cai na fila `*.dlq` correspondente, e que `onDeadLetter` marca a linha como `failed`
   no Postgres (ver `docs/conversas-runbook.md`, seção 5).
7. **SIGTERM / shutdown gracioso** — com mensagens em voo (handler em execução), enviar `SIGTERM`
   ao processo do worker; confirmar que ele espera os handlers em andamento terminarem (dentro do
   timeout de `INBOX_WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS`) antes de fechar o canal — nenhuma mensagem
   em voo perdida nem processada parcialmente duas vezes.
8. **Fan-out do SSE via RabbitMQ real** — com duas instâncias de `zuno-api` rodando
   simultaneamente (ou simulando via dois processos locais), confirmar que uma notificação
   publicada em `inbox.realtime` chega às DUAS instâncias e é filtrada corretamente por
   tenant/workspace em cada uma (`shouldDeliverInboxNotification` já testado isoladamente — aqui
   valida o transporte real).

Documentar o resultado de cada item (passou/falhou/observação) e só então atualizar a
classificação de `RUNTIME_VALIDATION_PENDING_BROKER` para `VERIFIED_RUNTIME` no relatório da
Fase 7.
