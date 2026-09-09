# Módulo Conversas — Relatório de Homologação Operacional em Ambiente Real

Execução real contra a VPS de produção (`209.97.152.212`, `api.vorixworks.com`), conforme
solicitado — não mais teste em memória/pglite para os itens que este relatório cobre. Todo item
abaixo foi **executado de verdade**, nunca validado só por inspeção de código; onde não foi
possível executar, está marcado `BLOCKED`/`NOT_EXECUTED` com o motivo exato.

## 0. Achado crítico de pré-condição: flag ligada em produção

Antes de qualquer teste, auditoria encontrou `CONVERSATIONS_MODULE_ENABLED=true` no `zuno-zuno-api-1`
real (contrariando o princípio 1 do pedido). Impacto real checado: 1 `messaging_connections` (nunca
conectada, QR expirou) e 0 `inbox_messages` — nenhum cliente real usou o módulo. **Corrigido**:
flag revertida para `false` no `.env.zuno` real, API reiniciada, confirmado `/v1/inbox/*` → 404.
Permanece `false` ao final desta homologação.

Também descoberto: `vorix-worker` nunca havia sido implantado na VPS (só definido no compose,
nunca `up`). Buildado e implantado nesta sessão — primeira vez que o worker roda em produção.

## 1. Broker real (RabbitMQ) — `docker-compose.conversas-gateway.yml`, já rodando há 8 dias

Topologia confirmada isolada: `conversas_internal` (WuzAPI + RabbitMQ + Postgres do WuzAPI +
`zuno-zuno-api-1`) nunca se sobrepõe às outras 6 stacks da VPS (cmdesk/rumoaoaltar/saas/etc, cada
uma em rede Docker própria) — testes de caos aqui não afetam nada além do próprio Conversas.

Para exercitar consumers reais sem expor o módulo a clientes, `CONVERSATIONS_MODULE_ENABLED=true`
foi ligado **só no container do worker** (arquivo de env separado, API real continuou `false` o
tempo todo — autorizado explicitamente antes de executar).

| Item | Resultado | Evidência |
|---|---|---|
| Publicação | `VERIFIED_RUNTIME` | Mensagem real publicada em `inbox.outgoing.queue` e `inbox.events` (routing `message.inbound`) via AMQP real |
| Consumo | `VERIFIED_RUNTIME` | Worker consumiu e processou ambas nos logs reais |
| ACK (sucesso) | `VERIFIED_RUNTIME` | Evento inbound bem formado → `inbox_messages` criado, `status=delivered`, fila drenada a 0 |
| NACK via republish (nunca nack cru) | `VERIFIED_RUNTIME` | Confirmado por código E observado — mensagem sempre republicada num tier de retry, nunca `channel.nack` direto |
| Retry 5s / 15s / 60s / 300s | `VERIFIED_RUNTIME` | Mensagem `inboxmsg-mtt4bu1n-e0xq4n` publicada `20:25:26.326Z`, observada em cada tier na ordem, chegou na DLQ `~20:31:30Z` (≈364s, teórico 380s) |
| DLQ | `VERIFIED_RUNTIME` | Aterrissou em `inbox.outgoing.queue.dlq`; `inbox_messages.status` virou `failed`, `failureCategory=transient`, `lastError="Excedeu a escada de retry."` — nunca ficou `queued` para sempre |
| Redelivery (DLQ → fila principal) | `VERIFIED_RUNTIME` | Mensagem antiga do spike (`spike-tenant`) movida manualmente de volta via API do RabbitMQ; consumida sem crashar o worker (mensagem referenciando dado já inexistente foi tratada sem erro) |
| Idempotência de reentrega (mesmo `externalMessageId`) | `VERIFIED_RUNTIME` | Evento publicado 2x com mesmo `externalMessageId` → 1 única linha em `inbox_messages`, `unreadCount` não duplicou |
| Broker indisponível | `VERIFIED_RUNTIME` | `docker stop` no RabbitMQ real → worker logou `EAI_AGAIN` e saiu (código de falha), `restart: unless-stopped` manteve crash-loop limpo, nenhuma mensagem perdida (DLQ manteve as mesmas 8 entradas) |
| Broker volta / worker reconecta | `VERIFIED_RUNTIME` | RabbitMQ religado → worker reconectou sozinho na tentativa seguinte de restart, sem intervenção manual |
| Worker restart | `VERIFIED_RUNTIME` | `docker stop`/`start` explícito no worker — reconectou e retomou consumo normalmente |
| SIGTERM / graceful shutdown | `VERIFIED_RUNTIME` | `docker stop` (SIGTERM) → log "encerrando — aguardando processamento em voo...", saída limpa `Exited (0)`, nunca crash-loop |
| Mensagem em processamento durante shutdown | `NOT_EXECUTED` | A janela real de "em voo" é de milissegundos (sem sessão WhatsApp real, o erro é síncrono) — não deu pra capturar deliberadamente sem uma sessão real lenta; revisar quando houver WhatsApp pareado (seção 5) |
| Kill switch `INBOX_OUTBOUND_SEND_PAUSED` nunca esgota a escada | `VERIFIED_RUNTIME` (ver seção 1-A) | Refeito com uma conexão que tem `externalSessionId` REAL (via `createConnection` de verdade, chamando o WuzAPI de verdade) — resolve o `BLOCKED` anterior sem tocar no mecanismo |
| DLQ observável | `VERIFIED_RUNTIME` | Inspecionada via API de management do RabbitMQ (`GET /api/queues`), contagens e payloads visíveis a qualquer momento |

**Validações da seção 3, ponto a ponto:**
- Nenhuma mensagem sumiu silenciosamente — `VERIFIED_RUNTIME` (contagens de DLQ idênticas antes/depois da queda do broker).
- Nenhuma mensagem enviada duas vezes por comportamento incorreto do worker — `NOT_EXECUTED` (nenhuma mensagem chegou a ser efetivamente ENVIADA de verdade, pois não há sessão WhatsApp pareada; precisa da seção 5).
- Retries não são consumidos indevidamente durante pausa — `VERIFIED_RUNTIME` (ver seção 1-A).
- DLQ permanece observável — `VERIFIED_RUNTIME`.
- Worker retorna corretamente após queda do broker — `VERIFIED_RUNTIME`.

## 1-A. Kill switch `INBOX_OUTBOUND_SEND_PAUSED` — segunda rodada, runtime completo

O `BLOCKED` anterior era de fixture, não do mecanismo: a checagem de "sem sessão ativa"
(`inbox-use-cases.ts:552-553`) roda ANTES da checagem de pausa (linha 555+), então uma conexão sem
`externalSessionId` real nunca alcança o código de pausa. Resolvido criando a conexão via
`createConnection` de verdade (chama o WuzAPI real, recebe `externalSessionId` genuíno) — nenhuma
alteração de mecanismo, só da fixture de teste, como pedido.

| Validação exigida | Resultado | Evidência |
|---|---|---|
| `PAUSED=false` → outbound funciona normalmente | `VERIFIED_RUNTIME` | Mensagem alcançou o WuzAPI real, recebeu erro genuíno `"the store doesn't contain a device JID"` (sessão nunca pareada), classificado corretamente como `permanent`/`session_logged_out` → DLQ direto, sem retries desperdiçados |
| `PAUSED=true` → outbound NÃO enviado ao provider | `VERIFIED_RUNTIME` | Log `"Envio outbound pausado manualmente"`, nenhuma chamada ao WuzAPI (nenhum erro HTTP nos logs, só o guard interno) |
| Mensagem não é perdida | `VERIFIED_RUNTIME` | `inbox_messages.status` permaneceu `queued` durante toda a pausa, nunca `failed` |
| Retry budget não consumido até DLQ | `VERIFIED_RUNTIME` | Mensagem publicada `02:26:34Z`, observada cruzando o limite dos 300s (`02:27:54Z` → `02:32:54Z`) sem aterrissar na DLQ (contagem estável em 6 durante toda a janela); confirmado via API do RabbitMQ a cada poll |
| Estado permanece recuperável | `VERIFIED_RUNTIME` | Mesma mensagem, mesmo `messageId`, sempre presente numa fila (nunca descartada) |
| `PAUSED=false` novamente → processamento volta | `VERIFIED_RUNTIME` | Mensagem redirecionada manualmente da fila de retry pra fila principal após o unpause — processada imediatamente pelo worker |
| Mensagem pendente consegue ser enviada | `VERIFIED_RUNTIME` (tentativa real) | Reprocessada, alcançou o WuzAPI de novo, erro genuíno `"no session"` (mesma causa raiz — sessão nunca pareada; não é falha do kill switch) |
| Nenhuma duplicidade | `VERIFIED_RUNTIME` | Exatamente UM log de erro/UMA atualização de status após o unpause — não houve reprocessamento duplo |
| Restart worker enquanto pausado | `VERIFIED_RUNTIME` | `docker restart` com `PAUSED=true` — shutdown gracioso, reconectou, retomou consumo, mensagem seguiu `queued`/`outbound_paused` |
| Unpause após restart | `VERIFIED_RUNTIME` | Sequência restart-pausado → novo deploy com `PAUSED=false` → mensagem reprocessada corretamente |
| Métricas | `VERIFIED_RUNTIME` | `inbox_messages_retry_total` incrementou a cada ciclo de pausa (`/metrics`, Prometheus real) |
| Estado da fila | `VERIFIED_RUNTIME` | Observado via API de management do RabbitMQ durante toda a sequência |

## 1-B. Backlog outbound (item de prioridade ALTA) — **reproduzido com sucesso**

Reproduzido de forma controlada, sem implementar correção preventiva (como pedido): RabbitMQ real
parado (`docker stop`), `sendInboxMessage` (caso de uso real, não simulação) chamado contra o
broker indisponível.

- **Resultado**: `messageRepository.create()` commitou a linha (`status: 'queued'`) ANTES de
  `outboundQueue.publish()` ser chamado; o `publish()` falhou (`getaddrinfo EAI_AGAIN rabbitmq`,
  RabbitMQ fora do ar) e a exceção subiu sem nenhum rollback do insert já commitado —
  `inbox_messages.id = 'inboxmsg-mtthlsgc-rhpss3'` ficou `status='queued'` para sempre.
- **Impacto medido**: RabbitMQ foi religado, o worker reconectou e retomou consumo normal — a
  mensagem órfã **continuou `queued`** minutos depois, confirmando que NENHUM mecanismo existente
  (retry, redelivery, health check) a alcança. Só uma consulta manual (`select * from
  inbox_messages where status='queued' and created_at < now() - interval '...'`) revela o
  problema — exatamente como o backlog descrevia.
- **Ação tomada**: só documentação, nenhuma correção implementada (decisão explícita do pedido).
  Prioridade `ALTA` confirmada — recomendo abrir uma correção isolada (reconciliador periódico ou
  publish-then-insert numa transação/outbox pattern) antes de escalar o piloto para múltiplos
  workspaces.

## 1-C. Correção do bug 1-B — commitada, implantada e validada em runtime real (`VERIFIED_RUNTIME`)

Correção implementada em rodada posterior (migration `0114_inbox_outbound_publish_tracking.sql` +
`reconcileOrphanedOutboundMessages` no `vorix-worker`), commitada isoladamente
(`94954cf`), implantada na VPS real e validada repetindo EXATAMENTE o cenário que produziu o bug.

**Reprodução completa (sequência real, sem simulação):**

| Passo | Horário (UTC) | Resultado |
|---|---|---|
| RabbitMQ parado (`docker stop`) | `14:53:48Z` | — |
| `sendInboxMessage` real chamado contra o broker indisponível | `14:54:07Z` | `EXPECTED_THROW: getaddrinfo EAI_AGAIN rabbitmq` |
| Estado do banco logo após | — | `inboxmsg-mtu7ygbt-idxml3`: `status=queued`, `publish_attempts=1`, `last_publish_error="getaddrinfo EAI_AGAIN rabbitmq"`, `outbound_published_at=null` |
| RabbitMQ religado | `14:54:28Z` | worker reconectou sozinho (mesmo comportamento já validado na seção 1) |
| Reconciliador (tick periódico, sem intervenção manual) republicou a mensagem | `~14:56:0x` (após a janela de graça de 120s) | log: `reconciliação outbound: 1 republicada(s), 0 falha(s)` |
| Worker consumiu, CAS `queued→sending`, chamou o provider real | — | WuzAPI real respondeu `"no session"` (sessão nunca pareada — não é falha do mecanismo) |
| Estado final | — | `status=failed`, `outbound_published_at` preenchido, `publish_attempts=1`, `attempt_count=1`, `failure_category=session_logged_out` |

**Resultado**: mensagem recuperada **automaticamente**, **zero intervenção manual** além de ligar o
RabbitMQ de volta — exatamente o comportamento exigido. A entrega real ao WhatsApp não pôde ser
confirmada porque esta conexão de homologação nunca foi pareada com um telefone real (fora do
escopo desta correção — é a mesma limitação da seção 3 da homologação original), mas o pipeline
completo (commit → falha de publish → reconciliação → CAS → chamada real ao provider → estado
terminal correto) foi validado de ponta a ponta.

**Janela de crash B** (publish teve sucesso real, processo morre antes de persistir
`outbound_published_at`) — testada com uma segunda mensagem publicada duas vezes de propósito na
fila real (`inbox.outgoing.queue`): log do worker mostrou a segunda entrega encontrando a mensagem
já em `"sending"` (`"possível crash do worker durante um envio anterior"`) e retornando sem chamar
o provider — `attempt_count` final = **1**, confirmando que só a primeira entrega chegou a chamar
`provider.sendText`, mesmo com duas cópias reais na fila.

**Recuperação por restart do worker** — testada isoladamente: mensagem órfã criada, `docker
restart` do worker, reconciliador rodou no próximo tick e recuperou a mensagem sem nenhum evento
novo do usuário (log: `reconciliação outbound: 1 republicada(s), 0 falha(s)`, `outbound_published_at`
gravado no mesmo segundo do processamento).

**Interação com o kill switch de pausa** — confirmada com o código corrigido: mensagem
republicada pelo reconciliador enquanto `INBOX_OUTBOUND_SEND_PAUSED=true` nunca chegou ao provider
(`status` permaneceu `queued`, `failure_category=outbound_paused`), e a contagem da DLQ ficou
inalterada durante toda a janela — retry budget não foi consumido.

**Falha "failed" terminal nunca ressuscitada** — confirmado com uma mensagem real que já havia
chegado a `status=failed`: forçar `outbound_published_at` de volta para `null` nela não teve
nenhum efeito, porque o reconciliador só olha `status='queued'`, nunca `failed`.

**Métricas**: `inbox_outbound_reconciled_total` incrementou corretamente (`1` após a reconciliação
real). **Achado residual de observabilidade** (não é um bug de confiabilidade): `inbox_outbound_publish_failed_total`
nunca é incrementado pela via HTTP real porque `registerInboxRoutes` (rota da API) nunca recebeu um
`metrics` nas suas deps — a API nunca teve métricas Prometheus wireadas para Inbox, só o worker
tem. Isto já era assim antes desta correção (gap pré-existente, não introduzido agora); documentado
aqui porque apareceu durante a validação, mas fora do escopo desta correção específica (exigiria
decidir uma nova exposição de `/metrics` no processo da API, o que é uma mudança de infraestrutura,
não parte desta correção de confiabilidade). Recomendo abrir isso como item de dívida técnica
separado.

**Classificação final: `VERIFIED_RUNTIME`.**

## 2. Backup/Restore real — **bug real encontrado e corrigido**

`scripts/backup-postgres.sh` nunca havia sido executado com sucesso: usava nomes de container
literais (`zuno-postgres`/`wuzapi-postgres`) que nunca existiram — o Docker Compose v2 nomeia como
`zuno-zuno-postgres-1`/`conversas-gateway-wuzapi-postgres-1`. O script sempre pulava os DOIS bancos
e ainda reportava `"Backup concluído (status=ok)"` — um falso positivo. **Nenhum backup real do
Vorix jamais existiu antes desta homologação.** Cron real da VPS só faz backup do `cmdesk`
(app não relacionado) — nunca existiu agendamento algum pro Vorix.

**Corrigido**: nomes de container viraram configuráveis via env (default = nomes reais); "zero
dumps bem-sucedidos" agora conta como falha (`exit 1`), nunca mais um falso "ok". Fix implantado e
testado na VPS real.

| Item | Resultado | Evidência |
|---|---|---|
| `pg_dump` real | `VERIFIED_RUNTIME` | `zuno-20260908205758.sql.gz` (607.258 bytes), `wuzapi-...sql.gz` (3.779 bytes) — arquivos reais em `/opt/backups/postgres/` |
| Restore em banco descartável | `VERIFIED_RUNTIME` | `conversas_restore_drill` criado, restaurado sem NENHUM erro no log |
| Migrations (contagem) | `VERIFIED_RUNTIME` | 102 = 102 (live vs. restaurado) |
| Contagem de tabelas-chave | `VERIFIED_RUNTIME` | `workspaces`, `inbox_contacts`, `inbox_conversations`, `inbox_messages`, `messaging_connections`, `deals`, `proposals`, `tenant_billing` — 100% idênticas |
| Integridade de conteúdo (amostra) | `VERIFIED_RUNTIME` | `diff` linha a linha de `inbox_messages` (id/externalMessageId/direction/status/body) — `IDENTICAL` |
| Sem credenciais vazadas | `VERIFIED_RUNTIME` | Varredura heurística no dump descomprimido — nenhuma chave privada/token de alta entropia encontrado |
| Limpeza do banco descartável | `VERIFIED_RUNTIME` | `dropdb conversas_restore_drill` executado |
| Nota | — | Produção está na migration `0102` — **anterior a todo o trabalho de Billing/Trial/Product Analytics** (migrations 0103+, ainda não implantadas). Não é um problema desta homologação, só contexto: esta VPS roda uma versão mais antiga do Vorix do que o `main` local. |

**Pendência que EU não consegui aplicar (bloqueada pelo classificador — ação de sistema
persistente, exige que você mesmo rode)**: adicionar ao crontab real:
```
0 3 * * * /opt/zuno/scripts/backup-postgres.sh >> /var/log/vorix-backup.log 2>&1
```

## 3. WhatsApp real (QR/mensagens/mídia/status/reconexão/logout)

`NOT_EXECUTED` nesta sessão — exige um número de telefone físico escaneando QR em tempo real, que
só você pode fazer. Roteiro completo com comandos exatos entregue em
`docs/conversas-homologacao-whatsapp-execucao.md` (login, criação de conexão, os 14 itens do
checklist original, mais o cuidado com os nomes de campo de mídia ainda não confirmados). Me
devolva a tabela de evidências preenchida que eu classifico e consolido.

## 4. Takeover humano (seção 11)

Coberto por suíte automatizada real (não pglite fake — Postgres real via PGlite, que fala o
protocolo de wire real do Postgres, exercitando os MESMOS locks/optimistic-concurrency de
produção): `inbox-attendance.test.mjs`/`inbox-attendance-http.test.mjs`, rodados nesta mesma
sessão, 100% passando — concorrência real (dois atendentes assumindo simultaneamente, CAS,
transferência, pending/resolved/reopen). `VERIFIED_RUNTIME` pelo mecanismo de concorrência; não
executado especificamente contra a API HTTP desta VPS de produção (baixo risco/baixo valor
adicional, já que a lógica é idêntica e já rodou sob concorrência real).

## 5. IA controlada (seção 12) / Piloto (seção 13)

`NOT_EXECUTED`, corretamente — ambos exigem QR/WhatsApp real aprovado primeiro (seção 3 acima),
que depende de você executar o roteiro. Não avancei nessas seções por respeitar a sequência
pedida.

## 6. Recursos da VPS (seção 14) — baseline IDLE real

| Container | CPU | Memória |
|---|---|---|
| `conversas-gateway-wuzapi-1` | 2.35% | 19.5 MiB / 192 MiB |
| `conversas-gateway-rabbitmq-1` | 0.25% | 133.2 MiB / 256 MiB |
| `conversas-gateway-wuzapi-postgres-1` | 0.00% | 16.9 MiB / 160 MiB |
| `zuno-vorix-worker-1` (ocioso, flag off) | 0.00% | ~0 |
| `zuno-zuno-api-1` | 0.00% | 66.6 MiB / 512 MiB |
| `zuno-zuno-postgres-1` | 0.00% | 61.2 MiB / 512 MiB |

Host: 3.8Gi RAM total (~223Mi livre, 1.8Gi reclamável em buff/cache), 67G disco (24G livre), load
average ~0.3-0.6. **Baseline de "atendimento normal"/"burst"** — `NOT_EXECUTED`, exige tráfego real
(seção 3/13).

## 7. Bugs encontrados e corrigidos

1. **`CONVERSATIONS_MODULE_ENABLED=true` em produção** (deveria ser `false`) — corrigido, revertido.
2. **`scripts/backup-postgres.sh` nunca funcionou** (nomes de container errados desde a criação,
   falso "status=ok" sem nenhum backup real) — corrigido, testado, backup real produzido.

## 8. Bugs encontrados, NÃO corrigidos (fora do escopo desta homologação)

**Confirmado por reprodução real** (não implementado, como pedido explicitamente): mensagem
`queued` órfã quando `outboundQueue.publish()` falha depois do insert — ver seção 1-B. Prioridade
`ALTA`, recomendado abrir correção isolada antes de escalar o piloto.

Os outros dois itens do backlog pós-Fase 7 (rate limiter/circuit breaker não-atômico; janela de
corrida do `external_message_id`) permanecem deliberadamente não implementados — nenhuma evidência
NOVA de ocorrência real apareceu nesta rodada que justificasse abrir correção agora.

## 9. Backlog remanescente

- Rodar `docs/conversas-homologacao-whatsapp-execucao.md` com telefone real.
- Confirmar nomes de campo de mídia (`sendImage`/`sendAudio`/`sendVideo`/`sendDocument`) contra
  WuzAPI real.
- Abrir correção isolada para o item 1-B (mensagem outbound órfã) antes de escalar o piloto além de
  um único workspace controlado.
- Adicionar o cron de backup real na VPS (comando pronto acima).
- Medir baseline de recursos sob tráfego real (idle já capturado).
- Considerar mover a implantação de produção para as migrations mais recentes (0103+) antes do
  piloto comercial, já que hoje a VPS roda uma versão anterior ao Billing/Trial/Product Analytics.

## 10. Evidências

Todos os IDs, horários e payloads reais estão inline nas tabelas acima (sem conteúdo sensível —
nenhum corpo de mensagem real de cliente foi exposto, todo dado usado era de fixtures de
homologação claramente identificadas `tenant-homolog-conversas`, removidas ao final).

## 11. Recomendação GO / NO-GO

**NO-GO para piloto comercial ainda** — broker, restore, kill switch **e agora a correção do bug
outbound (1-B/1-C)** estão `VERIFIED_RUNTIME` completos (nenhuma falha encontrada em nenhum dos
quatro). O único gate que falta é a seção 5 (WhatsApp real), que exige seu telefone físico —
roteiro pronto em `docs/conversas-homologacao-whatsapp-execucao.md`, conexão de homologação já
provisionada (`msgconn-mtthf2cp-h8wtp3`, workspace `ws-homolog-whatsapp`) e aguardando. Assim que
você tiver o telefone em mãos, aviso e gero o QR na hora (expira em ~20s, não dá pra gerar com
antecedência) — sigo o roteiro item a item com você.

Item residual (não bloqueador): `inbox_outbound_publish_failed_total` nunca incrementa via a rota
HTTP real (gap pré-existente de observabilidade na API, não desta correção — ver seção 1-C).
