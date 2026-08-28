# Módulo Conversas — Spike de verificação da Fase 2 (WuzAPI real)

## Por que este documento existe

A Fase 1 (Fundação) implementou o adapter (`wuzapi-client.ts`, `wuzapi-event-mapper.ts`) a partir
de um resumo de documentação pública do projeto `asternic/wuzapi`, sem nenhuma verificação. Antes
deste spike, uma segunda rodada de pesquisa foi direto ao código-fonte real (`routes.go`,
`README.md`, `API.md`, `wmiau.go`, `rabbitmq.go`) e corrigiu várias suposições erradas SEM precisar
de uma instância ao vivo:

- toda resposta HTTP vem envelopada em `{ code, data, success }` (não um objeto solto);
- os dois tipos de chamada (admin e sessão) usam o MESMO header `Authorization` (não um header
  `token` customizado como a Fase 1 assumia);
- **uma sessão precisa ser provisionada via `POST /admin/users` (admin token, escolhendo `name` e
  `token`) antes de `/session/connect` funcionar** — a Fase 1 nunca fazia essa chamada, então o
  fluxo de criar conexão simplesmente não funcionaria contra uma instância real;
- campos de resposta são PascalCase (`QRCode`, `Connected`, `LoggedIn`, `Id`, `Timestamp`, `jid`);
- o payload publicado no RabbitMQ (confirmado linha a linha em `rabbitmq.go:sendToGlobalRabbit`) é
  `{ type, event, state?, userID, instanceName }` — o Vorix sempre define `instanceName` como o
  próprio `MessagingConnection.id`, o que permite ao worker correlacionar um evento à conexão certa
  com um `getById` direto, sem nunca precisar (nem poder) usar o token de sessão pra isso, já que
  o token NUNCA aparece nesse payload.

Essas correções já foram aplicadas ao código (`wuzapi-client.ts`, `wuzapi-messaging-provider.ts`,
`wuzapi-event-mapper.ts`, `messaging-provider.port.ts`) e a suíte de testes existente
(`tests/inbox-persistence.test.mjs`) continua passando. **O que ainda falta — e é o objetivo deste
spike** — é o que nenhuma leitura de código-fonte resolve sozinha:

1. confirmar que os contratos acima realmente se comportam assim numa instância rodando de verdade
   (a pesquisa de código-fonte pode ter lido uma versão ligeiramente diferente da que você vai
   rodar);
2. a FORMA exata de `event.Message` para cada tipo de mídia (imagem/áudio/vídeo/documento) — só
   texto simples (`conversation`) está confirmado; os nomes de campo de
   `sendImage`/`sendAudio`/`sendVideo`/`sendDocument` também são só uma extrapolação por analogia
   com `sendText`, nunca confirmados;
3. o fluxo ponta a ponta (WuzAPI → RabbitMQ → `vorix-worker` → Postgres, e o caminho inverso de
   envio) funciona de verdade, incluindo duplicidade, retry, DLQ, reconexão, logout e
   indisponibilidade temporária de cada componente — nada disso é verificável só lendo código.

Qualquer divergência encontrada deve ser corrigida em `wuzapi-client.ts`/`wuzapi-event-mapper.ts`
e os comentários que hoje dizem "confirmado via código-fonte" corrigidos para citar o comportamento
real observado ao vivo. **Não avançar para a Fase 3 antes de todos os itens da seção "Critério de
conclusão" estarem verdes.**

## Execução — quem roda o quê

Este spike não pode ser executado de dentro do ambiente onde o código é escrito: exige Docker,
uma VPS ou máquina com Docker instalado, e principalmente **um celular real** para escanear o QR
Code e trocar mensagens de teste — nenhuma dessas três coisas está disponível no ambiente que gera
este documento. As seções abaixo assumem que uma pessoa vai executar os comandos (na VPS ou numa
máquina local com Docker) e revisar os resultados; onde fizer sentido, cole os outputs de volta
para revisão em conjunto com o código.

**Nunca use um número de WhatsApp de produção/pessoal para este spike.** Use um número
descartável/de teste — os eventos capturados (mesmo sanitizados) e os logs do worker vão registrar
metadados reais de uma sessão de WhatsApp de verdade.

## 1. Pré-requisitos

- Docker + Docker Compose v2 na máquina onde o spike vai rodar (VPS ou local).
- Um número de WhatsApp dedicado a testes, com o app instalado num celular disponível para
  escanear QR Code.
- Node.js 20+ na mesma máquina (para rodar `vorix-worker` fora de container durante o spike —
  mais fácil de iterar/ver logs do que dentro de um container a cada ajuste).
- Acesso de escrita a este repositório (para aplicar as correções encontradas em
  `wuzapi-client.ts`/`wuzapi-event-mapper.ts`).

## 2. Preparar o ambiente do spike

```bash
# 1) Rede privada (mesmo pré-requisito do módulo em produção)
docker network create conversas_internal

# 2) Copiar e preencher os segredos REAIS do spike (nunca commitar este arquivo)
cp .env.conversas.example .env.conversas
# preencher: WUZAPI_POSTGRES_PASSWORD, RABBITMQ_PASSWORD, WUZAPI_ADMIN_TOKEN,
# WUZAPI_GLOBAL_ENCRYPTION_KEY (gerar com `openssl rand -hex 32`), RABBITMQ_USER

# 3) Subir o gateway real (WuzAPI + RabbitMQ + Postgres dedicado)
docker compose --env-file .env.conversas -f docker-compose.conversas-gateway.yml up -d
docker compose -f docker-compose.conversas-gateway.yml ps
```

Confirme que os três serviços ficam `healthy` (`docker ps` mostra `(healthy)` em cada um) antes de
continuar. Se `wuzapi` não subir saudável, capture `docker logs wuzapi` — o healthcheck usa
`GET /health` (rota pública, sem autenticação, confirmada em `routes.go`); se essa rota não existir
na versão real, ajuste `docker-compose.conversas-gateway.yml`.

Rodar o `vorix-worker` LOCALMENTE (fora do container) apontando pro gateway, com captura de
fixtures ligada:

```bash
export PERSISTENCE_DRIVER=postgres
export DATABASE_URL=postgres://zuno:<senha-local-de-teste>@localhost:5432/zuno   # Postgres do Vorix, não o do WuzAPI
export CONVERSATIONS_MODULE_ENABLED=true
export INBOX_WUZAPI_BASE_URL=http://localhost:8080   # porta publicada só para o spike, ver nota na seção 6
export INBOX_WUZAPI_ADMIN_TOKEN=<mesmo valor de WUZAPI_ADMIN_TOKEN em .env.conversas>
export INBOX_RABBITMQ_URL=amqp://<RABBITMQ_USER>:<RABBITMQ_PASSWORD>@localhost:5672
export INBOX_SPIKE_FIXTURES_DIR=./spike-fixtures   # grava payload bruto + mapeado, sanitizados

npm run build
node dist/interfaces/worker/inbox-worker.js
```

> `INBOX_SPIKE_FIXTURES_DIR` só existe para este spike — nunca configurar em produção (é uma
> variável nova, gated, sem custo quando ausente; ver `inbox-worker.ts`, `captureSpikeFixture`).

## 3. Validar os contratos HTTP (admin/sessão/QR/envio)

Para cada chamada abaixo, registre req/resp REAL (sanitizando token/telefone) num arquivo novo em
`spike-fixtures/http/` e compare com o que `wuzapi-client.ts` espera. Os itens 1-5 já foram
corrigidos a partir do código-fonte real (alta confiança, mas nunca testados ao vivo); o item 6
continua uma extrapolação por analogia, nunca confirmado. Ajustar o cliente imediatamente se algo
divergir — não seguir para o próximo passo com uma suposição não confirmada.

1. `POST /admin/users` (`WUZAPI_ADMIN_TOKEN`) — confirmar que aceita
   `{ name, token, webhook?, events: "Message,ReadReceipt,..." }` (string separada por vírgula,
   não array) e que a resposta é `{ code, data: { id }, success }`. `name` deve ser o
   `MessagingConnection.id` do Vorix — é isso que vira `instanceName` no evento do RabbitMQ.
2. `POST /session/connect` com o token escolhido no passo 1 — confirmar corpo
   `{ Subscribe: [...], Immediate: false }` e que a resposta traz `data.jid` (formato
   `"<telefone>.<device>:<agent>@s.whatsapp.net"`, usado por
   `wuzapi-messaging-provider.ts:extractPhoneFromJid`).
3. `GET /session/qr` — confirmar `data.QRCode` (string `data:image/png;base64,...`) e o tempo real
   de expiração (código assume ~20s).
4. `GET /session/status` — confirmar `data.Connected`/`data.LoggedIn` (sem telefone nesta
   resposta, conforme a documentação).
5. `POST /session/logout` (distinto de `/session/disconnect`) — confirmar `data.Details` e que a
   sessão realmente exige novo QR Code depois disso (usado no teste 5.5).
6. **Não confirmado.** Depois da sessão pareada: `POST /chat/send/image` /`/audio`/`/video`/
   `/document` — confirmar os nomes de campo (`wuzapi-client.ts` assume `Image`/`Audio`/`Video`/
   `Document`/`Caption`/`FileName` por analogia com `sendText`, que É confirmado —
   `{ Phone, Body, Id? }` → resposta `{ code, data: { Id, Timestamp }, success }`).

## 4. Provar o fluxo ponta a ponta

1. Via API do Vorix (`POST /v1/inbox/connections`, depois `GET /v1/inbox/connections/:id/qr`),
   crie a conexão e obtenha o QR Code real; escaneie com o número de teste.
2. Confirme no Postgres: `select status, phone_number from messaging_connections where id = '<id>'`
   deve virar `connected` com o telefone pareado, sem intervenção manual além do scan.
3. **Outbound real**: `POST /v1/inbox/conversations/:id/messages` (crie a conversa manualmente no
   banco se ainda não existir uma, já que a Fase 1 não tem UI de criação de conversa avulsa) e
   confirme que a mensagem chega de verdade no celular de teste. Verifique
   `inbox_messages.status` evoluir `queued → sent` (e depois `delivered`/`read` quando o consumer
   de status processar o recibo).
4. **Inbound real**: responda pelo celular de teste. Confirme que `vorix-worker` loga o
   processamento, que uma fixture nova aparece em `spike-fixtures/`, e que a mensagem aparece em
   `inbox_messages` (`direction = 'inbound'`) e a conversa em `inbox_conversations` com
   `unread_count` incrementado — sem duplicar contato/conversa numa segunda mensagem da mesma
   pessoa.
5. Revise cada fixture capturada em `spike-fixtures/` contra `wuzapi-event-mapper.ts` — para CADA
   discrepância (nome de campo, formato de timestamp, valor de `Type` do receipt, etc.), corrija o
   mapper e adicione um comentário citando que agora é comportamento observado, não suposição.

## 5. Testes de resiliência (obrigatórios antes da Fase 3)

Para cada teste: descreva o resultado observado (mesmo que "passou como esperado") num arquivo de
notas do spike — isto vira a evidência de que a Fase 2 foi "comprovadamente" validada.

### 5.1 Duplicidade (evento entregue duas vezes)

Pegue uma fixture `raw` já capturada e republique manualmente na fila `wuzapi.events.raw`
(RabbitMQ management UI, aba "Publish message", ou um script curto com `amqplib`). Critério de
sucesso: nenhuma linha nova em `inbox_messages` para o mesmo `external_message_id` (a constraint
`unique(connection_id, external_message_id)` já é testada em `tests/inbox-persistence.test.mjs`
contra Postgres real — este passo prova que o CAMINHO REAL via RabbitMQ chega no mesmo resultado).

### 5.2 Retry (erro transitório)

Aponte `INBOX_WUZAPI_BASE_URL` para uma porta inválida (ex.: `http://localhost:9` — conexão
recusada) só no worker, mantenha a API/QR já pareados. Envie uma mensagem outbound. Critério de
sucesso: `inbox_messages.attempt_count` incrementa a cada tentativa, `last_error` é preenchido, e
no RabbitMQ management UI (`http://localhost:15672`, túnel SSH se for na VPS) as filas
`inbox.outgoing.queue.retry-5000ms` → `-15000ms` → `-60000ms` → `-300000ms` recebem a mensagem em
sequência (confirma a escada de backoff, não um retry imediato).

### 5.3 DLQ (esgotar a escada)

Deixe o teste 5.2 rodar até a mensagem esgotar os 4 tiers. Critério de sucesso: a mensagem aparece
em `inbox.outgoing.queue.dlq` (RabbitMQ) e `inbox_messages.status` permanece consultável (não
trava o processamento de outras mensagens da mesma conversa).

### 5.4 Reconexão (queda temporária de rede, sem logout)

`docker restart wuzapi` enquanto a sessão está pareada (sem fazer logout pelo celular). Critério
de sucesso: WuzAPI reconecta sozinho (comportamento do `whatsmeow`), `messaging_connections.status`
reflete a oscilação sem exigir um novo QR Code, e nenhuma mensagem enviada durante a janela de
reconexão é perdida (fica `queued` e é entregue quando a conexão volta).

### 5.5 Logout/revogação (não pode entrar em loop)

Pelo celular: WhatsApp → Aparelhos conectados → remover a sessão. Critério de sucesso: WuzAPI
emite o evento de logout, `messaging_connections.status` vira `requires_repair`
(`MESSAGING_CONNECTION_TERMINAL_STATUSES`), e o worker **não** tenta reconectar repetidamente —
confirme nos logs que não há tentativas automáticas depois do evento.

### 5.6 WuzAPI temporariamente fora do ar

`docker stop wuzapi`. Envie uma mensagem outbound pela API do Vorix. Critério de sucesso: a API
responde 202 normalmente (persiste `queued`), a Inbox/histórico continuam consultáveis
normalmente (Postgres do Vorix não depende do WuzAPI estar de pé), e nenhuma mensagem é perdida —
`docker start wuzapi` depois deve drenar a fila sem duplicar nada já enviado antes da queda.

### 5.7 `vorix-worker` temporariamente fora do ar

Pare o processo do worker (Ctrl+C) enquanto o número de teste envia 2-3 mensagens pelo WhatsApp.
Critério de sucesso: o RabbitMQ acumula os eventos em `wuzapi.events.raw` (fila durável, não
perde nada mesmo com o consumer fora do ar); ao religar o worker, todas as mensagens aparecem no
Postgres, na ordem certa, sem duplicar.

## 6. Isolamento de rede (confirmar antes de fechar o spike)

- `docker ps` no host do spike: `wuzapi` e `rabbitmq` NÃO podem ter coluna `PORTS` com algo do tipo
  `0.0.0.0:xxxx->8080/tcp` publicado permanentemente — a porta `8080`/`15672` exposta na seção 2
  deste documento (`http://localhost:8080`) é **só para o spike rodar o worker fora de container
  na mesma máquina**; em produção, `docker-compose.conversas-gateway.yml` não publica nenhuma
  porta (confirmar que o arquivo usado em produção não tem `ports:` nesses serviços, só
  `networks: [conversas_internal]`).
- De outro container FORA de `conversas_internal` (ex.: `docker run --rm alpine ping wuzapi`,
  sem `--network conversas_internal`), confirmar que `wuzapi`/`rabbitmq` não resolvem/não
  respondem — só quem está na rede privada os alcança.
- Confirmar que o management UI do RabbitMQ (porta 15672) só é acessado via túnel SSH
  (`ssh -L 15672:localhost:15672 <host>`) quando o spike roda na VPS, nunca publicado direto.

## 7. Métricas reais da VPS (antes de fixar limites de recursos)

Rodar UMA VEZ na VPS de produção (não na máquina do spike, se forem diferentes) e colar o
resultado para revisão antes de calibrar `mem_limit`/`cpus` definitivos dos containers:

```bash
free -h
nproc
df -h
docker stats --no-stream
```

Os limites atuais (`docker-compose.zuno.yml`, `docker-compose.conversas-gateway.yml`) são
placeholders conservadores (~192-512m por serviço) até esses números chegarem — não tratar como
definitivos.

## 8. Pendência obrigatória registrada: backup/retenção/restore

`scripts/backup-postgres.sh` existe (dump de `zuno-postgres` e `wuzapi-postgres` via `pg_dump`),
mas **não está agendado em nenhum crontab, não tem retenção validada, e nunca teve um restore
testado**. Isto continua pendente e bloqueia considerar a Fase 2 "operacionalmente pronta" para
produção real, mesmo depois deste spike passar — tratar como item obrigatório antes de conectar um
número de WhatsApp de produção (não de teste) ao módulo.

## Critério de conclusão da Fase 2

Só avançar para a Fase 3 (SSE/realtime, Inbox completa) quando TODOS os itens abaixo estiverem
confirmados com uma instância real:

- [ ] Contratos HTTP (seção 3) confirmados; `wuzapi-client.ts` corrigido onde divergiu.
- [ ] Payloads de evento reais capturados e sanitizados; `wuzapi-event-mapper.ts` corrigido onde
      divergiu (nenhuma suposição da documentação pública restando sem confirmação).
- [ ] Fluxo ponta a ponta inbound e outbound provado (seção 4) com o número de teste.
- [ ] Duplicidade, retry, DLQ, reconexão, logout, WuzAPI fora do ar e worker fora do ar (seção 5)
      todos testados com resultado documentado.
- [ ] Isolamento de rede confirmado (seção 6) — nada exposto além do necessário.
- [ ] Métricas reais da VPS coletadas (seção 7) e limites de recursos recalibrados a partir delas.
- [ ] Backup/retenção/restore (seção 8) OU aceito explicitamente como risco conhecido para seguir
      mesmo assim — nunca esquecido silenciosamente.
