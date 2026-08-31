# Módulo Conversas — Spike de verificação da Fase 2 (WuzAPI real)

## Por que este documento existe

A Fase 1 (Fundação) implementou o adapter (`wuzapi-client.ts`, `wuzapi-event-mapper.ts`) a partir
de um resumo de documentação pública do projeto `asternic/wuzapi`, sem nenhuma verificação. Uma
segunda rodada de pesquisa foi direto ao código-fonte real (`routes.go`, `README.md`, `API.md`,
`wmiau.go`, `rabbitmq.go`) e corrigiu várias suposições erradas SEM precisar de uma instância ao
vivo — resposta HTTP envelopada em `{ code, data, success }`, header `Authorization` único pra
admin e sessão, provisionamento obrigatório via `POST /admin/users` antes de `/session/connect`,
campos PascalCase, e o payload real do RabbitMQ (`{ type, event, state?, userID, instanceName }`,
confirmado linha a linha em `sendToGlobalRabbit`). Essas correções já estão no código
(`wuzapi-client.ts`, `wuzapi-messaging-provider.ts`, `wuzapi-event-mapper.ts`,
`messaging-provider.port.ts`) e a suíte de testes existente passa.

O que **nenhuma leitura de código-fonte resolve sozinha** — e é o objetivo deste spike:

1. confirmar que os contratos acima realmente se comportam assim numa instância rodando de verdade;
2. a FORMA exata de `event.Message` para mídia (imagem/áudio/vídeo/documento) — só texto simples
   está confirmado; os nomes de campo de `sendImage`/`sendAudio`/`sendVideo`/`sendDocument` são
   extrapolação por analogia, nunca confirmados;
3. o fluxo ponta a ponta (WuzAPI → RabbitMQ → `vorix-worker` → Postgres, e o caminho inverso de
   envio) funciona de verdade: duplicidade, idempotência, retry, DLQ, reconexão, logout,
   indisponibilidade de WuzAPI/worker/RabbitMQ — nada disso é verificável só lendo código.

Qualquer divergência encontrada deve ser corrigida em `wuzapi-client.ts`/`wuzapi-event-mapper.ts`.
**Não avançar para a Fase 3 antes de todos os itens da seção "Critério de conclusão" estarem
verdes.**

## Postura de segurança (ler antes de rodar qualquer comando)

Este spike roda a produção real do gateway WuzAPI, mas em um projeto Docker **totalmente separado**
do Vorix — nunca no mesmo diretório, nunca no mesmo compose project, nunca na mesma rede Docker
usada pelo Vorix (`zuno_network`).

**Containers do Vorix (`zuno-postgres`, `zuno-api`, `zuno-web`) NUNCA são tocados neste spike** —
nem parados, nem reiniciados, nem reconstruídos. O único ponto de contato é `docker network
create conversas_internal`, que cria uma rede NOVA e não mexe em nenhuma rede/container existente.

Regras que vamos seguir do início ao fim:

- Todo diretório do spike fica em `/opt/conversas-spike` (NUNCA `/opt/zuno`) — clonar/extrair o
  código ali, nunca sobrescrever nada dentro de `/opt/zuno`.
- Todo comando `docker compose` do spike sempre nomeia os arquivos explicitamente
  (`-f docker-compose.conversas-gateway.yml -f docker-compose.conversas-gateway.spike.yml`) —
  nunca um `docker compose down`/`up` sem `-f`, que poderia pegar um arquivo errado por engano.
- Nenhum `docker compose down` GLOBAL — o único `down` deste runbook (etapa final) é escopado ao
  projeto `conversas-gateway`, nunca ao projeto `zuno`.
- Nenhuma porta é publicada em `0.0.0.0`. O overlay `docker-compose.conversas-gateway.spike.yml`
  publica `wuzapi`/`rabbitmq`/o Postgres descartável só em `127.0.0.1` (loopback da própria VPS) —
  inacessível pela internet, só o `vorix-worker` do spike (rodando como processo comum na mesma
  VPS) consegue alcançar.
- O `vorix-worker` do spike grava num Postgres **descartável** (`spike-vorix-postgres`, criado só
  para isto), nunca no `zuno-postgres` real — tráfego de teste de WhatsApp não deve se misturar com
  dado de produção.
- Antes de qualquer comando que possa causar indisponibilidade (mesmo que só do PRÓPRIO gateway de
  teste — nunca do Vorix), eu aviso explicitamente o que vai parar, por quanto tempo, e como
  reverter.
- Nada de `rm -rf`, `docker system prune`, ou qualquer comando destrutivo genérico — toda remoção
  é nomeada (container/volume específico).

## Containers afetados por fase

| Fase | Containers criados/afetados | Containers do Vorix tocados |
|---|---|---|
| Preparação | rede `conversas_internal` (nova) | nenhum |
| Subir gateway | `wuzapi`, `wuzapi-postgres`, `rabbitmq`, `spike-vorix-postgres` (novos) | nenhum |
| Worker do spike | processo `node` comum na VPS (não é container) | nenhum |
| Testes de resiliência | `docker stop/start/restart` **só** em `wuzapi`/`rabbitmq`/`spike-vorix-postgres`, e parar/reiniciar o processo do worker | nenhum |
| Coleta de métricas | leitura (`docker stats`, `free -h`, `df -h`) — nenhuma mudança de estado | nenhum (só leitura) |
| Encerramento | `down -v` do projeto `conversas-gateway` (remove os 4 containers + volumes descartáveis) | nenhum |

## Execução — quem roda o quê

Você roda os comandos na VPS (via SSH) e cola os resultados aqui para eu revisar antes do próximo
passo. **Nunca use um número de WhatsApp de produção/pessoal** — use um número descartável/de
teste; os eventos capturados (mesmo sanitizados) e os logs do worker vão registrar metadados reais
de uma sessão de WhatsApp de verdade.

## 1. Pré-requisitos

- Docker + Docker Compose v2 já instalados na VPS (confirmamos no primeiro comando).
- Um número de WhatsApp dedicado a testes, com o app instalado num celular disponível para
  escanear QR Code.
- Node.js 20+ na VPS (para rodar `vorix-worker` como processo comum durante o spike).
- Espaço em disco livre suficiente para mais 4 imagens/containers Docker (confirmamos com
  `df -h`/`docker system df` antes de começar).

## 2. Preparar o ambiente do spike

Diretório dedicado, isolado de `/opt/zuno`:

```bash
mkdir -p /opt/conversas-spike
```

Levar o código para lá (mesmo padrão de `docs/deployment.md`, mas para um diretório novo):

```bash
git archive --format=tar HEAD | gzip > /tmp/conversas-spike.tgz
# enviar /tmp/conversas-spike.tgz para /opt/conversas-spike na VPS e extrair lá
```

Rede privada nova (não afeta `zuno_network` nem nenhuma rede existente):

```bash
docker network create conversas_internal
```

Segredos do spike (nunca commitar `.env.conversas` real):

```bash
cd /opt/conversas-spike
cp .env.conversas.example .env.conversas
# preencher: WUZAPI_POSTGRES_PASSWORD, RABBITMQ_PASSWORD, WUZAPI_ADMIN_TOKEN,
# WUZAPI_GLOBAL_ENCRYPTION_KEY, SPIKE_VORIX_POSTGRES_PASSWORD (todas via `openssl rand -hex 32`),
# RABBITMQ_USER
```

Subir o gateway (WuzAPI + RabbitMQ + Postgres do WuzAPI + Postgres descartável do Vorix), usando
SEMPRE os dois arquivos juntos:

```bash
docker compose --env-file .env.conversas \
  -f docker-compose.conversas-gateway.yml -f docker-compose.conversas-gateway.spike.yml \
  up -d
docker compose -f docker-compose.conversas-gateway.yml -f docker-compose.conversas-gateway.spike.yml ps
```

Confirme que os quatro serviços ficam `healthy`. Se `wuzapi` não subir saudável, capture
`docker logs wuzapi` — o healthcheck usa `GET /health` (rota pública, sem autenticação, confirmada
em `routes.go`).

Aplicar as migrations do Vorix no Postgres descartável (nunca no `zuno-postgres`):

```bash
DATABASE_URL=postgres://vorix_spike:<SPIKE_VORIX_POSTGRES_PASSWORD>@localhost:5433/vorix_spike \
  npm run db:migrate
```

Rodar o `vorix-worker` como processo comum (fora de container), com captura de fixtures ligada:

```bash
export PERSISTENCE_DRIVER=postgres
export DATABASE_URL=postgres://vorix_spike:<SPIKE_VORIX_POSTGRES_PASSWORD>@localhost:5433/vorix_spike
export CONVERSATIONS_MODULE_ENABLED=true
export INBOX_WUZAPI_BASE_URL=http://localhost:8080
export INBOX_WUZAPI_ADMIN_TOKEN=<mesmo valor de WUZAPI_ADMIN_TOKEN em .env.conversas>
export INBOX_RABBITMQ_URL=amqp://<RABBITMQ_USER>:<RABBITMQ_PASSWORD>@localhost:5672
export INBOX_SPIKE_FIXTURES_DIR=./spike-fixtures

npm run build
node dist/interfaces/worker/inbox-worker.js
```

> `INBOX_SPIKE_FIXTURES_DIR` só existe para este spike — nunca configurar em produção (variável
> opt-in, custo zero quando ausente; ver `inbox-worker.ts`, `captureSpikeFixture`).

Você também vai precisar rodar comandos HTTP contra a API do Vorix para os testes das seções 4/5 —
isso pode ser a própria API real (`zuno-api`, sem reiniciá-la) SE ela já tiver o módulo habilitado
apontando pro Postgres do spike, ou, mais simples e mais seguro, chamando os use cases diretamente
via um script Node curto contra o mesmo `spike-vorix-postgres` — combinamos isso quando chegarmos
lá, sem exigir nenhuma mudança na configuração do `zuno-api` de produção.

## 3. Validar os contratos HTTP (admin/sessão/QR/envio)

Para cada chamada abaixo, registre req/resp REAL (sanitizando token/telefone) em
`spike-fixtures/http/` e compare com o que `wuzapi-client.ts` espera. Itens 1-5 já foram corrigidos
a partir do código-fonte real (alta confiança, nunca testados ao vivo); o item 6 continua uma
extrapolação por analogia. Ajustar o cliente imediatamente se algo divergir.

1. `POST /admin/users` (`WUZAPI_ADMIN_TOKEN`) — `{ name, token, webhook?, events: "Message,ReadReceipt,..." }`
   (string separada por vírgula), resposta `{ code, data: { id }, success }`. `name` = o
   `MessagingConnection.id` do Vorix (vira `instanceName` no evento do RabbitMQ).
2. `POST /session/connect` — `{ Subscribe: [...], Immediate: false }`, resposta com `data.jid`
   (formato `"<telefone>.<device>:<agent>@s.whatsapp.net"`).
3. `GET /session/qr` — `data.QRCode` (`data:image/png;base64,...`) e tempo real de expiração
   (código assume ~20s).
4. `GET /session/status` — `data.Connected`/`data.LoggedIn` (sem telefone nesta resposta).
5. `POST /session/logout` (distinto de `/session/disconnect`) — `data.Details`, e confirma que
   exige novo QR Code depois (usado no teste 5.5).
6. **Não confirmado.** `POST /chat/send/image`/`/audio`/`/video`/`/document` — nomes de campo por
   analogia com `sendText` (confirmado: `{ Phone, Body, Id? }` → `{ code, data: { Id, Timestamp }, success }`).

## 4. Provar o fluxo ponta a ponta

1. Criar a conexão (via rota `/v1/inbox/connections` ou diretamente pelos use cases contra o
   Postgres do spike) e obter o QR Code real; escanear com o número de teste.
2. Confirmar no `spike-vorix-postgres`:
   `select status, phone_number from messaging_connections where id = '<id>'` deve virar
   `connected` com o telefone pareado, sem intervenção manual além do scan.
3. **Outbound real**: enviar uma mensagem outbound e confirmar que chega no celular de teste.
   Verificar `inbox_messages.status` evoluir `queued → sent` (e depois `delivered`/`read` quando o
   consumer de status processar o recibo).
4. **Inbound real**: responder pelo celular de teste. Confirmar log do worker, fixture nova em
   `spike-fixtures/`, mensagem em `inbox_messages` (`direction = 'inbound'`) e conversa em
   `inbox_conversations` com `unread_count` incrementado — sem duplicar contato/conversa numa
   segunda mensagem da mesma pessoa.
5. Revisar cada fixture capturada contra `wuzapi-event-mapper.ts` — corrigir toda discrepância e
   comentar que agora é comportamento observado, não suposição.

## 5. Testes de resiliência (obrigatórios antes da Fase 3)

Para cada teste: descrever o resultado observado (mesmo "passou como esperado") — vira a evidência
de que a Fase 2 foi validada de verdade. **Todos os `docker stop/restart` abaixo afetam SÓ
containers do projeto `conversas-gateway` — nunca o Vorix.** Aviso antes de cada um.

### 5.1 Duplicidade (evento entregue duas vezes)

Republicar manualmente uma fixture `raw` já capturada na fila `wuzapi.events.raw` (RabbitMQ
management UI via túnel SSH, ou script `amqplib`). Critério de sucesso: nenhuma linha nova em
`inbox_messages` para o mesmo `external_message_id`.

### 5.2 Retry (erro transitório)

Apontar `INBOX_WUZAPI_BASE_URL` para uma porta inválida só no worker (ex.: `http://localhost:9`),
manter a sessão pareada. Enviar uma mensagem outbound. Critério de sucesso: `attempt_count`
incrementa, `last_error` preenchido, e as filas `inbox.outgoing.queue.retry-5000ms` →
`-15000ms` → `-60000ms` → `-300000ms` recebem a mensagem em sequência.

### 5.3 DLQ (esgotar a escada)

Deixar o teste 5.2 rodar até esgotar os 4 tiers. Critério de sucesso: mensagem em
`inbox.outgoing.queue.dlq`, `inbox_messages` continua consultável normalmente.

### 5.4 Desconexão temporária / reconexão (sem logout)

**Aviso: `docker restart wuzapi` derruba a sessão de teste por alguns segundos — não afeta o
Vorix.** Critério de sucesso: WuzAPI reconecta sozinho, `messaging_connections.status` reflete a
oscilação sem exigir novo QR Code, nenhuma mensagem enviada durante a janela é perdida.

### 5.5 Logout/revogação (não pode entrar em loop)

Pelo celular: WhatsApp → Aparelhos conectados → remover a sessão. Critério de sucesso:
`messaging_connections.status` vira `requires_repair`, e o worker **não** tenta reconectar
repetidamente.

### 5.6 WuzAPI temporariamente fora do ar

**Aviso: `docker stop wuzapi` — só o gateway de teste, não o Vorix.** Enviar uma mensagem outbound.
Critério de sucesso: resposta normal (persiste `queued`), histórico continua consultável, nenhuma
mensagem perdida; `docker start wuzapi` depois drena a fila sem duplicar.

### 5.7 `vorix-worker` temporariamente fora do ar

Parar o processo do worker (Ctrl+C) enquanto o número de teste envia 2-3 mensagens. Critério de
sucesso: RabbitMQ acumula os eventos (fila durável); ao religar o worker, tudo aparece no Postgres,
na ordem certa, sem duplicar.

### 5.8 RabbitMQ temporariamente fora do ar

**Aviso: `docker stop rabbitmq` — só o broker de teste, não afeta o Vorix (que hoje não depende de
RabbitMQ pra nada fora do módulo Conversas).** Critério de sucesso: WuzAPI loga falha ao publicar
(sem crashar), o worker perde a conexão e tenta reconectar (ou fica claramente parado, sem crash
loop), e ao rodar `docker start rabbitmq` tudo volta a fluir sem exigir reiniciar wuzapi/worker
manualmente (ou documentar exatamente o que precisa de reinício manual, se for o caso).

## 6. Isolamento de rede (confirmar antes de fechar o spike)

- `docker ps`: `wuzapi`/`rabbitmq`/`spike-vorix-postgres` devem mostrar porta publicada só como
  `127.0.0.1:xxxx->yyyy/tcp` — nunca `0.0.0.0:xxxx`. Isso só existe por causa do overlay
  `docker-compose.conversas-gateway.spike.yml`; o arquivo de produção
  (`docker-compose.conversas-gateway.yml`, sozinho) não publica porta nenhuma.
- De outro container FORA de `conversas_internal` (`docker run --rm alpine ping wuzapi`, sem
  `--network conversas_internal`), confirmar que `wuzapi`/`rabbitmq` não resolvem/não respondem.
- Confirmar que o management UI do RabbitMQ (15672) só é acessado via túnel SSH
  (`ssh -L 15672:127.0.0.1:15672 <host>`), nunca publicado direto pra internet.

## 7. Métricas reais da VPS — JÁ COLETADAS, limites recalibrados

Coletado na VPS de produção (`cmdesk-production`, 209.97.152.212) antes de subir o gateway:

```
Mem:  3.8Gi total, 1.8Gi usado, 288Mi livre, 2.0Gi "available", 692Mi de swap já em uso
CPUs: 2
Disco: 33GB livres de 67GB (52% usado) — não é o gargalo, RAM/CPU são
```

**Achado crítico**: esta VPS não é dedicada ao Vorix — hospeda 7 stacks (`zuno`, `cmdesk`,
`rumoaoaltar`, `saas_*`), todos competindo pelos mesmos 3.8GB/2 CPUs.

Consumo REAL medido com os 4 containers do gateway rodando (uma sessão de teste, sem WhatsApp
pareado, sem carga de mensagens de verdade):

| Serviço | Observado (idle) | Limite antigo | Limite recalibrado |
|---|---|---|---|
| wuzapi-postgres | ~50MB | 384m | **192m** |
| rabbitmq | ~136MB | 384m | **320m** |
| wuzapi | ~22MB | 384m | **256m** |
| spike-vorix-postgres (só spike) | ~24MB | — | (não existe em produção) |
| vorix-worker | não medido como container (rodou como processo comum no spike) | 384m | **256m** (estimativa) |

Já aplicado em `docker-compose.conversas-gateway.yml` e `docker-compose.zuno.yml`. **Recalibrar de
novo depois da homologação real** — uma sessão pareada de verdade, com histórico de mensagens e
mídia, consome mais que uma sessão vazia.

## 8. Pendência obrigatória registrada: backup/retenção/restore

`scripts/backup-postgres.sh` existe (dump de `zuno-postgres` e `wuzapi-postgres` via `pg_dump`),
mas **não está agendado em nenhum crontab, não tem retenção validada, e nunca teve um restore
testado**. Continua pendente e bloqueia considerar a Fase 2 "operacionalmente pronta" para produção
real, mesmo depois deste spike passar.

## 9. Encerramento do spike

Remove só o projeto `conversas-gateway` (os 4 containers + volumes descartáveis) — nunca toca no
projeto `zuno`:

```bash
docker compose -f docker-compose.conversas-gateway.yml -f docker-compose.conversas-gateway.spike.yml down -v
docker network rm conversas_internal   # só se não for reaproveitar para o deploy real depois
```

## 10. Resultados desta rodada — tudo que NÃO depende de WhatsApp pareado

Sem celular disponível, validamos tudo que dá pra validar com `FakeMessagingProvider` + eventos
sintéticos (payload no formato real confirmado via código-fonte) contra o gateway real (RabbitMQ +
Postgres containerizados na VPS) e, para os dois testes de indisponibilidade, contra o container
real do WuzAPI (sem sessão pareada). **6 bugs reais encontrados e corrigidos**, nenhum encontrável
só lendo código:

1. Header de sessão errado (`Authorization` → `token`) — seção 3.
2. Casing de campo real (PascalCase → lowercase/camelCase em `/session/status`/`/session/connect`).
3. Tamanho da chave de criptografia (64 → 32 caracteres).
4. `registerInboundMessage` incrementava `unread_count` a cada reentrega do MESMO evento, mesmo a
   mensagem sendo corretamente deduplicada — corrigido com `wasCreated` no retorno de
   `messageRepository.create()`.
5. Mensagem que esgota a escada de retry (DLQ) ficava com `status: 'queued'` PARA SEMPRE — nada
   marcava como `failed`. Corrigido: `onDeadLetter` callback no worker chama `markFailed`.
6. Queda do RabbitMQ derrubava o `vorix-worker` em SILÊNCIO (nenhum log) — `connection.on('error'
   | 'close')` ausente. Corrigido: log claro + `process.exit(1)` (deixa o `restart: unless-stopped`
   do container religar com contexto no log). Shutdown gracioso (SIGTERM) ajustado pra não disparar
   esse mesmo handler.
7. (Refinamento, não bug per se) `classifyHttpError` tratava TODO HTTP 500 como transitório —
   "no session"/"the store doesn't contain a device JID" são permanentes (exigem reautenticação,
   nunca resolvidos por retry). Agora classificados como `session_logged_out` → DLQ imediata em
   vez de gastar os ~380s da escada inteira numa causa que retry nenhum resolve.

Testes executados e resultado, ponta a ponta contra RabbitMQ/Postgres reais:

- [x] Processamento inbound (evento sintético → contato/conversa/mensagem no Postgres).
- [x] Outbound queue (`sendInboxMessage` → `FakeMessagingProvider` → `sent`).
- [x] Idempotência (mesmo evento republicado duas vezes → 1 mensagem só, `unread_count` correto).
- [x] Atualização de status (delivered → read, timestamps corretos, `delivered_at` preservado).
- [x] Retry 5s/15s/60s/300s — progressão cronometrada e confirmada com timestamps reais (não
      estimativa): tier a tier, sem busy-loop, `attempt_count` incrementando corretamente.
- [x] DLQ — confirmada tanto pela escada natural completa (2 mensagens chegaram lá sozinhas) quanto
      por injeção de fronteira (`x-attempt=4`) para verificação rápida.
- [x] ACK/NACK correto — nunca duplicou mensagem, fila principal sempre vazia entre processamentos.
- [x] Graceful shutdown (SIGTERM) — log limpo, sem falso alarme de "conexão caiu".
- [x] Restart do worker após crash (`kill -9`) — sem duplicar, sem perder mensagem.
- [x] Indisponibilidade do WuzAPI (container real parado/religado) — outbound fica `queued`,
      histórico continua consultável, drena sozinho depois (achado extra: sessão precisa de
      `/session/connect` de novo após restart do container — mapeado para Fase 6/health monitor).
- [x] Indisponibilidade do RabbitMQ — WuzAPI tem retry próprio limitado (10 tentativas, ~30s) e
      DESISTE de vez depois disso, sem crashar e sem reportar isso no `/health` — **risco
      operacional real, ver seção 11**. `vorix-worker` agora morre com log claro (item 6 acima) em
      vez de travar em silêncio.
- [ ] Circuit breaker — **fora de escopo ainda** (Fase 6 no plano original, nunca implementado).
- [x] Isolamento cross-tenant — já coberto por 7 testes automatizados contra Postgres real
      (`tests/inbox-persistence.test.mjs`); a correlação de evento usa sempre `connectionRow.
      tenantId/workspaceId` (nunca um valor do payload bruto), seguro por construção.
- [x] Recuperação após falha — worker, RabbitMQ e WuzAPI todos testados e recuperados sem perda.

## 11. Risco operacional novo, registrado para a Fase 6

WuzAPI não reconecta sozinho ao RabbitMQ depois de esgotar as 10 tentativas iniciais (~30s), e seu
`/health` continua respondendo `"status":"ok"` mesmo nesse estado — nem o container crasha (então
`restart: unless-stopped` não ajuda) nem o healthcheck detecta o problema. Uma queda do RabbitMQ
mais longa que ~30s silenciosamente para todo o fluxo de eventos do WhatsApp até alguém reiniciar o
container do WuzAPI manualmente. **Ação necessária na Fase 6** (health monitor): detectar esse
estado (ex.: heartbeat sintético pela fila, ou parsear o log por "Failed to reconnect to RabbitMQ")
e disparar `docker restart wuzapi` automaticamente.

## RUNTIME_VALIDATION_PENDING_QR

Estes itens EXIGEM uma sessão de WhatsApp real autenticada (celular escaneando o QR) e **não estão
comprovados** — não tratar como validados até a rodada de homologação real:

- `RUNTIME_VALIDATION_PENDING_QR`: recebimento real de mensagem pelo WhatsApp (forma exata de
  `event.Message` para texto/mídia — hoje é suposição, mesmo que a validada via wmiau.go).
- `RUNTIME_VALIDATION_PENDING_QR`: envio real para outro número de WhatsApp.
- `RUNTIME_VALIDATION_PENDING_QR`: `delivered`/`read` reais (o teste desta rodada usou eventos
  sintéticos — a FORMA do `state`/`MessageIDs` real nunca foi confirmada ao vivo).
- `RUNTIME_VALIDATION_PENDING_QR`: reconexão após queda de uma sessão AUTENTICADA (o teste desta
  rodada usou uma sessão nunca pareada — comportamento de reconexão do whatsmeow com uma sessão
  real pode diferir).
- `RUNTIME_VALIDATION_PENDING_QR`: logout/revogação reais (evento `LoggedOut` do WuzAPI nunca
  observado ao vivo — só sintetizado).
- `RUNTIME_VALIDATION_PENDING_QR`: nomes de campo de `sendImage`/`sendAudio`/`sendVideo`/
  `sendDocument` (só `sendText` foi confirmado contra a instância real).

## Critério de conclusão da Fase 2

**Aprovada para avançar à Fase 3 com o escopo que não depende de pareamento** (provider abstrato,
fixtures, worker, pipeline de eventos) — mas o módulo **não deve ser habilitado para um número de
produção** até a homologação real fechar os itens `RUNTIME_VALIDATION_PENDING_QR` acima.
`CONVERSATIONS_MODULE_ENABLED` continua `false` em todo lugar até essa homologação acontecer.

- [x] Contratos HTTP (seção 3) confirmados onde testável sem pareamento; `wuzapi-client.ts`
      corrigido (3 achados reais).
- [x] Payloads de evento sintéticos processados corretamente pelo pipeline real;
      `wuzapi-event-mapper.ts` já reflete a estrutura confirmada via código-fonte — a FORMA exata
      de mídia real continua `RUNTIME_VALIDATION_PENDING_QR`.
- [x] Fluxo ponta a ponta inbound e outbound provado (seção 4/10) com `FakeMessagingProvider`.
- [x] Duplicidade, retry, DLQ, restart, WuzAPI/RabbitMQ fora do ar (seção 10) testados e
      documentados — 4 bugs reais corrigidos.
- [x] Isolamento de rede confirmado (seção 6) — nada exposto além do necessário.
- [x] Métricas reais da VPS coletadas (seção 7) e limites de recursos recalibrados com dado real.
- [ ] Backup/retenção/restore (seção 8) — continua pendente, aceito como risco conhecido por
      enquanto (não bloqueia Fase 3, mas bloqueia produção real).
- [ ] `RUNTIME_VALIDATION_PENDING_QR` (seção acima) — bloqueia especificamente habilitar
      `CONVERSATIONS_MODULE_ENABLED` para um número de produção, não bloqueia construir a Fase 3.
- [ ] Confirmado que nenhum container do Vorix foi parado/reiniciado/afetado durante o spike.
