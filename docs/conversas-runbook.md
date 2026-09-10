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

## ⚠️ Único jeito suportado de operar a stack Conversas — `conversas-gateway-ctl.sh`

Achado real (Fase 10, Pre-Pilot Hardening): as credenciais reais de `docker-compose.conversas-gateway.yml`
(`WUZAPI_ADMIN_TOKEN`, `WUZAPI_POSTGRES_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`,
`WUZAPI_GLOBAL_ENCRYPTION_KEY`) **não** estão em `/opt/zuno/.env.zuno` nem em nenhum `.env.conversas`
dentro de `/opt/zuno` — vivem em **`/opt/conversas-spike/.env.conversas`**, um diretório
completamente separado (resquício do spike original — ver
`docs/conversas-pre-homologacao-fechamento-final.md`, seção "/opt/conversas-spike", para a decisão
de manter assim nesta fase). Rodar `docker compose -f docker-compose.conversas-gateway.yml up -d`
direto, **sem** `--env-file`, sobe silenciosamente com todas as credenciais em branco e RECRIA os
três containers (`wuzapi`, `wuzapi-postgres`, `rabbitmq`) nesse estado — já aconteceu uma vez em
produção (~90s de credenciais em branco até a correção; nenhum dado foi perdido só porque os
volumes Postgres já estavam inicializados, o que não é garantido na próxima vez).

Por causa disso (Fase 10.1), **não rode `docker compose` direto neste stack**. Use sempre
`scripts/conversas-gateway-ctl.sh` (no servidor, em `/opt/zuno/scripts/`) — ele injeta o
`--env-file` correto automaticamente e recusa rodar se o env-file não existir:

| Operação | Comando |
|---|---|
| Subir stack (primeira vez ou depois de `down`) | `scripts/conversas-gateway-ctl.sh up` |
| Recriar containers (ex.: depois de atualizar a imagem/compose) | `scripts/conversas-gateway-ctl.sh recreate` |
| Restart de tudo | `scripts/conversas-gateway-ctl.sh restart` |
| Restart só da WuzAPI (recuperação manual pós-RabbitMQ — ver seção 4) | `scripts/conversas-gateway-ctl.sh restart wuzapi` |
| Logs (tudo ou um serviço: `wuzapi`, `rabbitmq`, `wuzapi-postgres`) | `scripts/conversas-gateway-ctl.sh logs [serviço]` |
| Status/health de todos os containers | `scripts/conversas-gateway-ctl.sh ps` |
| Verificar WuzAPI (`/health` + status dos containers) | `scripts/conversas-gateway-ctl.sh health` |
| Parar stack (nunca remove volumes) | `scripts/conversas-gateway-ctl.sh down` |
| Verificar worker (processa a fila Conversas, é do stack `zuno`, não `conversas-gateway`) | `docker compose -f /opt/zuno/docker-compose.zuno.yml ps vorix-worker` |

Se por qualquer motivo precisar rodar `docker compose` manualmente (o script não cobre o caso), o
comando completo e correto é:

```bash
docker compose --env-file /opt/conversas-spike/.env.conversas -f /opt/zuno/docker-compose.conversas-gateway.yml up -d
```

Se o comando emitir avisos `"... variable is not set. Defaulting to a blank string."`, **pare
imediatamente** (Ctrl+C se ainda não terminou) — é o sinal de que o env-file não foi carregado.

## 🤖 Watchdog automático WuzAPI↔RabbitMQ

Achado real e testado em runtime de produção (Fase 10.1): a WuzAPI tenta reconectar ao RabbitMQ
exatamente 10 vezes (~30s) após qualquer queda e depois **nunca mais tenta sozinha**, mesmo com o
RabbitMQ saudável de novo — confirmado derrubando o RabbitMQ de propósito e observando o log parar
completamente (`"Failed to reconnect to RabbitMQ after all retries"`), inclusive minutos depois do
RabbitMQ voltar. Não existe configuração nativa de retry na imagem `asternic/wuzapi`, nem endpoint
de status de RabbitMQ (`/health` não tem esse campo; `/status` e `/metrics` não existem).

Mitigação: `scripts/wuzapi-rabbitmq-watchdog.sh`, rodando via cron no host (`*/5 * * * *`, ver
`crontab -l`), lê `docker logs` da WuzAPI (somente leitura) e, se encontrar o erro terminal sem uma
reconexão bem-sucedida depois dele, roda `docker restart conversas-gateway-wuzapi-1` — a mesma ação
que um operador humano faria manualmente. Testado de ponta a ponta em produção: detectou a falha
real, reiniciou o container, WuzAPI reconectou na tentativa 1 em ~2s, e confirmado que o script não
faz nada quando o estado já está saudável (idempotente). Log em `/var/log/wuzapi-watchdog.log`.

Isso **não elimina** a janela entre a queda e a reconexão (até ~5min de detecção + ~2s de restart) —
mensagens outbound não se perdem nessa janela (ficam `queued`, ver seção 4), mas inbound depende da
WuzAPI já estar recebendo do WhatsApp normalmente, que é o problema real, não algo que o watchdog piora.

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

- Nenhuma mensagem em filas duráveis se perde (todas as filas do módulo são `durable: true`) —
  `vorix-worker`/`zuno-api` reconectam sozinhos ao RabbitMQ voltar e retomam o consumo normalmente.
  **A WuzAPI é diferente e NÃO reconecta sozinha** (achado real, Fase 10.1 — ver seção "Watchdog
  automático" acima): esgota 10 tentativas em ~30s e trava nesse estado até um restart.
- Enquanto RabbitMQ estiver fora: envios outbound novos ficam `queued` no Postgres (a API grava a
  linha antes de publicar); mensagens inbound novas do WhatsApp podem se acumular no lado do WuzAPI
  até a fila voltar.
- Recuperação: `scripts/conversas-gateway-ctl.sh restart rabbitmq` se o próprio RabbitMQ precisar
  reiniciar. Depois de qualquer queda de RabbitMQ (mesmo curta), **sempre** verifique se a WuzAPI
  reconectou: `scripts/conversas-gateway-ctl.sh logs wuzapi` procurando
  `"RabbitMQ connection established successfully"` mais recente que o erro. O watchdog automático
  cobre isso em até 5 minutos sozinho; se precisar forçar na hora:
  `scripts/conversas-gateway-ctl.sh restart wuzapi`. Confirme também que `vorix-worker`/`zuno-api`
  reconectaram nos logs (`[inbox-worker] conectado ao RabbitMQ` ou equivalente).

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
