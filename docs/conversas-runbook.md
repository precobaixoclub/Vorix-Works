# Módulo Conversas — Runbook de Incidente

Documento operacional, não arquitetural. Cada seção é "o que fazer agora", não "como o sistema
funciona por dentro" (isso está no relatório da Fase 7 e no código). Assume acesso SSH à VPS e
`docker compose` nos dois stacks (`docker-compose.zuno.yml` e `docker-compose.conversas-gateway.yml`).

## Onde olhar primeiro (sempre)

1. `GET /v1/system/health?workspaceId=` — visão consolidada (circuit breakers, rate limits, secrets, backpressure).
2. `GET /v1/system/circuit-breakers?workspaceId=` — se `messaging_provider` estiver `open`, o outbound está deliberadamente pausado (proteção, não bug).
3. Worker: arquivo de heartbeat (`INBOX_WORKER_HEARTBEAT_FILE`) e `GET http://<worker>:<INBOX_WORKER_METRICS_PORT>/metrics` (default 9464).
4. `docker compose -f docker-compose.zuno.yml logs -f vorix-worker` e `zuno-api`.

Lembrete: um container `healthy` no Docker **não** significa "WhatsApp conectado" — sempre confirme
o status real da conexão via `GET /v1/inbox/connections?workspaceId=` (campo `status`).

---

## 1. WhatsApp desconectado (`disconnected` / `reconnecting`)

- Confirme se é uma queda transitória (`reconnecting`) — o monitor de saúde interno
  (`INBOX_HEALTH_CHECK_INTERVAL_MS`) e o próprio WuzAPI/whatsmeow tentam reconectar sozinhos.
  Normalmente resolve em minutos sem ação nenhuma.
- Se ficar `disconnected` por mais que alguns ciclos de health check, verifique se o container
  `wuzapi` está de pé (`docker compose -f docker-compose.conversas-gateway.yml ps`) e sua conexão
  com a internet/WhatsApp.
- **Nunca** reinicie o `vorix-worker` como primeira tentativa — ele não é o dono da sessão
  WhatsApp, só reflete o estado. Reiniciá-lo não reconecta nada.

## 2. WhatsApp `logged_out` ou `requires_repair`

- Este é um estado **terminal por design** (ver `MESSAGING_CONNECTION_TERMINAL_STATUSES`) — o
  sistema nunca tenta reconectar sozinho, e a Fase 7 fechou uma brecha onde um evento de fila
  atrasado poderia "ressuscitar" a conexão silenciosamente. Isso é intencional.
- Requer novo pareamento manual: `GET /v1/inbox/connections/:id/qr` na UI ("Conectar WhatsApp"),
  escanear com o celular de novo.
- Depois de reconectado, confirme `POST /v1/inbox/connections/:id/refresh-status`.

## 3. Worker crashou (`vorix-worker` caiu ou reiniciando em loop)

- `docker compose -f docker-compose.zuno.yml ps vorix-worker` — se `Restarting`, olhe o log
  imediatamente anterior ao crash (`docker compose logs --tail 200 vorix-worker`).
- Mensagens outbound NUNCA se perdem num crash — ficam `queued` (ou, numa janela estreita, `sending`
  — ver seção 6) e o RabbitMQ redelivera assim que o worker volta. Não é necessário reenviar nada
  manualmente.
- Se o crash for em loop (`CrashLoopBackOff` equivalente), suba o worker com
  `INBOX_OUTBOUND_SEND_PAUSED=true` temporariamente para isolar se a causa é o envio outbound
  específico, investigue o stack trace, corrija, depois volte a `false`.

## 4. RabbitMQ caiu

- Nenhuma mensagem em filas duráveis se perde (todas as filas do módulo são `durable: true`) — ao
  RabbitMQ voltar, o worker reconecta e retoma o consumo normalmente.
- Enquanto RabbitMQ estiver fora: envios outbound novos ficam `queued` no Postgres (a API grava a
  linha antes de publicar); mensagens inbound novas do WhatsApp podem se acumular no lado do WuzAPI
  até a fila voltar (WuzAPI as re-publica quando a conexão AMQP dele se restabelecer).
- `docker compose -f docker-compose.conversas-gateway.yml restart rabbitmq`, depois confirme
  `vorix-worker`/`zuno-api` reconectaram nos logs (`[inbox-worker] conectado ao RabbitMQ` ou
  equivalente).

## 5. DLQ crescendo

- `GET /v1/system/queues?workspaceId=` (se exposto) ou inspecione direto via management UI do
  RabbitMQ (túnel SSH — nunca exposta publicamente) as filas `*.dlq`.
- Cada mensagem na DLQ tem `inbox_messages.status = 'failed'` com `failureCategory` preenchido
  (`auth`, `session_logged_out`, `permanent`, ou esgotou a escada de retry como `transient`) — dá
  pra diagnosticar sem reabrir log bruto.
- DLQ crescendo rápido geralmente = conexão em `requires_repair`/`logged_out` (ver seção 2) ou
  circuit breaker aberto por muito tempo (ver seção 6 — mensagens legítimas expirando a escada).
- Reprocessamento manual da DLQ é uma operação RabbitMQ padrão (mover de volta pra fila principal)
  — faça isso só depois de resolver a causa raiz, nunca antes.

## 6. IA consumindo demais / respondendo errado

- **Pausa imediata, sem afetar atendimento humano**: `AI_INBOX_AUTO_REPLY_ENABLED=false` no
  `.env` do worker + restart do `vorix-worker`. Mensagens inbound continuam chegando e visíveis na
  Inbox normalmente — só param de gerar resposta automática. Nenhuma mensagem é perdida.
- Alternativa mais granular (sem restart, por conversa): `POST /v1/inbox/conversations/:id/ai`
  com `{"enabled": false}`, ou simplesmente assumir a conversa (`take-over`) — a IA nunca responde
  numa conversa com `assignedUserId` preenchido, mesmo que `aiEnabled` ainda esteja `true` (a UI já
  mostra isso claramente desde a Fase 7).
- Para conter custo imediatamente (billing): `AI_INBOX_AUTO_REPLY_BILLING_ENABLED` não é um kill
  switch de custo — ele só liga/desliga o *gating* de crédito. O kill switch de custo é sempre
  `AI_INBOX_AUTO_REPLY_ENABLED=false`.

## 7. Suspeita de envio outbound duplicado

- Filtre `inbox_messages` pela conversa/período suspeito. Uma mensagem genuinamente duplicada teria
  duas linhas com `body` idêntico e `external_message_id` diferentes.
- Verifique se alguma delas ficou parada em `status = 'sending'` — esse estado só existe entre o
  claim (`tryMarkSending`) e a confirmação do envio; se encontrar uma mensagem `sending` há mais de
  alguns minutos, é sinal de um crash do worker exatamente no meio de um envio anterior (ver relatório
  da Fase 7, achado crítico corrigido) — **verifique manualmente no WhatsApp real do cliente** se a
  mensagem chegou antes de decidir reenviar ou marcar como falha à mão. O sistema deliberadamente
  nunca reenvia sozinho uma mensagem nesse estado, para não arriscar duplicidade real.
- Se confirmar duplicidade de fato enviada: não há como "desenviar" no WhatsApp — documente o
  incidente e trate como bug se a causa não for o cenário acima (já coberto).

## 8. Kill switches disponíveis (referência rápida)

| Situação | Variável | Efeito | Precisa restart? |
|---|---|---|---|
| Emergência grave, parar TUDO do módulo | `CONVERSATIONS_MODULE_ENABLED=false` | Rotas `/v1/inbox/*` somem, worker para de processar | Sim (API e worker) |
| IA problemática, manter atendimento humano | `AI_INBOX_AUTO_REPLY_ENABLED=false` | Sem resposta automática; inbound/humano continuam normais | Sim (worker) |
| Incidente no envio (ex.: provider instável, decisão de pausar por precaução) | `INBOX_OUTBOUND_SEND_PAUSED=true` | Nenhuma mensagem outbound é enviada; todas ficam `queued`, retornam à fila indefinidamente (nunca vão para DLQ enquanto a pausa durar, mesmo além do tempo normal da escada de retry) | Sim (worker) |

Nenhum dos três apaga dado nem derruba a sessão do WhatsApp no WuzAPI — são todos reversíveis
apenas revertendo a variável e reiniciando.

## 9. Restaurar backup (procedimento seguro)

- **NUNCA** execute contra o banco de produção como destino de teste. Todo restore de verificação
  vai para um banco descartável.
- Dump: `scripts/backup-postgres.sh` (mesmo mecanismo agendado). Drill de restauração/integridade:
  `scripts/restore-drill.mjs` (ver `docs/` — este script SEMPRE recusa rodar contra uma string de
  conexão que pareça produção, ver `assertNotProduction`).
- Restauração real de incidente (perda de dado em produção): `pg_dump` mais recente →
  `pg_restore`/`psql` num banco novo → validar contagens de tabelas-chave (`inbox_conversations`,
  `inbox_messages`, `messaging_connections`) → só então promover esse banco a produção (troca de
  string de conexão + restart dos serviços), nunca sobrescrever o banco vivo diretamente.
- Depois de qualquer restore real, rode as migrations pendentes (`db:migrate`) antes de subir a
  aplicação — o runner é idempotente e seguro de rodar de novo mesmo se todas já estiverem aplicadas.
