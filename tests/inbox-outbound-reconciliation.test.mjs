import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import {
  processOutboundMessage,
  reconcileOrphanedOutboundMessages,
  sendInboxMessage,
} from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Módulo Conversas — correção de bug real (homologação de runtime): `sendInboxMessage` commitava
 * `inbox_messages.status = 'queued'` e SÓ DEPOIS publicava no RabbitMQ; se o publish falhasse
 * (broker indisponível), a linha ficava `queued` para sempre, sem NENHUM mecanismo existente
 * (retry ladder, DLQ, redelivery) jamais a alcançando — reproduzido em runtime real contra
 * RabbitMQ de produção antes desta correção (ver docs/conversas-homologacao-runtime-relatorio.md,
 * seção 1-B). `reconcileOrphanedOutboundMessages` fecha essa lacuna: at-least-once na fila +
 * idempotência no consumidor (CAS `queued → sending` já existente, nunca alterado) — NUNCA uma
 * garantia falsa de "exactly-once".
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55664 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

function makeFakeMessagingProvider() {
  return {
    sentMessages: [],
    async connect() { return {}; },
    async sendText(input) {
      this.sentMessages.push(input);
      return { externalMessageId: `fake-wa-${this.sentMessages.length}` };
    },
  };
}

function makeFakeMetrics() {
  const calls = [];
  const recorder = new Proxy({}, { get: (_target, prop) => (...args) => calls.push({ method: prop, args }) });
  return { recorder, calls };
}

/** Fila de saída de teste — `publish` opcionalmente falha N vezes antes de suceder, simulando
 * RabbitMQ indisponível e depois recuperado. Cada publish bem-sucedido registra o payload em
 * `delivered` — usado pra simular "duas cópias chegaram ao worker" nos testes de idempotência. */
function makeFakeOutboundQueue({ failTimes = 0 } = {}) {
  let failuresLeft = failTimes;
  const delivered = [];
  return {
    delivered,
    async publish(input) {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("RabbitMQ indisponível (simulado)");
      }
      delivered.push(input);
    },
  };
}

async function makeConversation(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);

  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await connectionRepo.updateStatus(connection.id, { status: "connected", externalSessionId: `sess-${connection.id}` });
  const phone = `+55119${++counter}0000`;
  const contact = await contactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: phone, name: "Cliente Teste" });
  const conversation = await conversationRepo.findOrCreate({ tenantId, workspaceId: workspace.id, connectionId: connection.id, contactId: contact.id });
  return { workspace, connection: await connectionRepo.getById(connection.id), contact, conversation: await conversationRepo.getById(conversation.id) };
}

function buildDeps(overrides = {}) {
  return {
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    workspaceRepository: new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }),
    provider: makeFakeMessagingProvider(),
    outboundQueue: makeFakeOutboundQueue(),
    ...overrides,
  };
}

// -----------------------------------------------------------------------------------------------
// 1. Fluxo normal continua igual
// -----------------------------------------------------------------------------------------------

test("fluxo normal: sendInboxMessage publica com sucesso, marca outboundPublishedAt, e a reconciliação nunca a toca de novo", async () => {
  const tenantId = "tenant-orec-1";
  const { conversation } = await makeConversation(tenantId);
  const outboundQueue = makeFakeOutboundQueue();
  const deps = buildDeps({ outboundQueue });

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Olá" });
  assert.equal(outboundQueue.delivered.length, 1, "publicou uma única vez no fluxo normal");

  const fetched = await deps.messageRepository.getById(message.id);
  assert.equal(fetched.status, "queued");
  assert.ok(fetched.outboundPublishedAt, "outboundPublishedAt precisa estar preenchido após publish bem-sucedido");
  assert.equal(fetched.publishAttempts, 0, "publish bem-sucedido de primeira nunca incrementa publishAttempts (isso é só pra FALHAS)");

  // Mesmo com grace period 0 (elegível por idade), uma mensagem JÁ marcada publicada nunca é
  // encontrada pelo reconciliador — é exatamente a distinção exigida entre "queued esperando
  // publicação" e "queued já publicado" (nunca usar só status=queued).
  const result = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 0 });
  assert.equal(result.reconciled, 0);
  assert.equal(outboundQueue.delivered.length, 1, "reconciliação nunca republica uma mensagem já confirmada publicada");
});

// -----------------------------------------------------------------------------------------------
// 2-3. Publish falha depois do commit; broker volta; mensagem é recuperada (cenário exato do bug)
// -----------------------------------------------------------------------------------------------

test("CENÁRIO REAL DO BUG: publish falha após o commit (RabbitMQ off) → mensagem fica órfã → broker volta → reconciliador recupera → worker envia (queued→sending→sent)", async () => {
  const tenantId = "tenant-orec-2";
  const { conversation } = await makeConversation(tenantId);
  const brokerDownQueue = makeFakeOutboundQueue({ failTimes: 1 });
  const deps = buildDeps({ outboundQueue: brokerDownQueue });

  // RabbitMQ OFF: sendInboxMessage ainda comita o insert, mas o publish falha e a exceção sobe
  // (comportamento HTTP-visível preservado — o chamador ainda sabe que algo deu errado).
  await assert.rejects(
    () => sendInboxMessage(deps, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Mensagem que vai ficar órfã" }),
    /RabbitMQ indisponível/,
  );

  const messages = await deps.messageRepository.listByConversation({ tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id });
  const orphan = messages[0];
  assert.equal(orphan.status, "queued", "DB COMMIT aconteceu — a linha existe, mesmo o publish tendo falhado");
  assert.equal(orphan.outboundPublishedAt, undefined, "nunca marcada publicada, já que o publish realmente falhou");
  assert.equal(orphan.publishAttempts, 1);
  assert.match(orphan.lastPublishError, /RabbitMQ indisponível/);

  // RabbitMQ ON: o reconciliador (mesma dep, mas o fake outboundQueue já não falha mais — broker
  // "voltou") encontra e republica a mensagem órfã.
  const reconcileResult = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 0 });
  assert.equal(reconcileResult.reconciled, 1);
  assert.equal(reconcileResult.failed, 0);
  assert.equal(brokerDownQueue.delivered.length, 1, "republicada exatamente uma vez");

  const republished = await deps.messageRepository.getById(orphan.id);
  assert.ok(republished.outboundPublishedAt, "agora marcada publicada");
  assert.equal(republished.status, "queued", "ainda queued — quem processa de fato é o worker (processOutboundMessage), não o reconciliador");

  // Worker consome a mensagem republicada: queued → sending → sent, exatamente como o fluxo normal.
  const processed = await processOutboundMessage(deps, { messageId: orphan.id });
  assert.equal(processed.status, "sent");
  assert.equal(deps.provider.sentMessages.length, 1, "mensagem não fica órfã — o provider foi chamado exatamente uma vez, resultado final é 'sent'");
});

// -----------------------------------------------------------------------------------------------
// 4. Não duplica provider send quando duas cópias chegam ao worker (idempotência via CAS)
// -----------------------------------------------------------------------------------------------

test("idempotência: reconciliador republica uma mensagem que JÁ estava no broker (falso positivo) — duas entregas chegam ao worker, só uma chama o provider", async () => {
  const tenantId = "tenant-orec-3";
  const { conversation } = await makeConversation(tenantId);
  const outboundQueue = makeFakeOutboundQueue();
  const deps = buildDeps({ outboundQueue });

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Duplicidade simulada" });

  // Simula a JANELA B do pedido (seção 6): publish teve sucesso de verdade, mas o processo morreu
  // ANTES de gravar outboundPublishedAt — força isso manualmente pra simular exatamente essa
  // janela de crash (o reconciliador vai achar esta mensagem "não publicada" mesmo já estando).
  await db.pool.query("update inbox_messages set outbound_published_at = null where id = $1", [message.id]);

  const reconcileResult = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 0 });
  assert.equal(reconcileResult.reconciled, 1, "reconciliador republica de boa fé — não tem como saber que já tinha sido publicada de verdade");
  assert.equal(outboundQueue.delivered.length, 2, "duas cópias agora 'no broker' (uma do publish original, uma da reconciliação) — aceito por design, nunca 'exactly-once' fingido");

  // Duas entregas do MESMO messageId chegam ao worker (RabbitMQ redelivery real se comporta assim
  // sob at-least-once) — só a primeira pode chamar o provider.
  const first = await processOutboundMessage(deps, { messageId: message.id });
  const second = await processOutboundMessage(deps, { messageId: message.id });

  assert.equal(deps.provider.sentMessages.length, 1, "provider.sendText chamado EXATAMENTE uma vez, mesmo com duas entregas do mesmo messageId");
  assert.equal(first.status, "sent");
  assert.equal(second.status, "sent", "a segunda entrega encontra status !== 'queued' e retorna sem reenviar (guard já existente em processOutboundMessage)");
});

// -----------------------------------------------------------------------------------------------
// 5-6. Reconciliador repetido é idempotente; duas instâncias reconciliando simultaneamente
// -----------------------------------------------------------------------------------------------

test("reconciliador chamado repetidamente é idempotente — segunda chamada não encontra mais a mensagem já reconciliada", async () => {
  const tenantId = "tenant-orec-4";
  const { conversation } = await makeConversation(tenantId);
  const brokerDownQueue = makeFakeOutboundQueue({ failTimes: 1 });
  const deps = buildDeps({ outboundQueue: brokerDownQueue });

  await assert.rejects(() => sendInboxMessage(deps, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Órfã" }));

  const first = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 0 });
  assert.equal(first.reconciled, 1);
  const second = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 0 });
  assert.equal(second.reconciled, 0, "já não há mais órfãos — outboundPublishedAt já está preenchido");
  assert.equal(brokerDownQueue.delivered.length, 1, "nunca republicada uma segunda vez por chamadas repetidas do reconciliador");
});

test("duas instâncias reconciliando a MESMA mensagem simultaneamente — nenhuma trava, nenhum crash, downstream continua protegido por CAS", async () => {
  const tenantId = "tenant-orec-5";
  const { conversation } = await makeConversation(tenantId);
  const brokerDownQueue = makeFakeOutboundQueue({ failTimes: 1 });
  const deps = buildDeps({ outboundQueue: brokerDownQueue });

  await assert.rejects(() => sendInboxMessage(deps, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Corrida" }));
  const messages = await deps.messageRepository.listByConversation({ tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id });
  const orphan = messages[0];

  // Duas "instâncias" do reconciliador (mesmo processo, deps distintos apontando pro MESMO banco)
  // rodando concorrentemente contra a mesma mensagem órfã.
  const depsA = buildDeps({ outboundQueue: brokerDownQueue, messageRepository: deps.messageRepository });
  const depsB = buildDeps({ outboundQueue: brokerDownQueue, messageRepository: deps.messageRepository });
  const [resultA, resultB] = await Promise.all([
    reconcileOrphanedOutboundMessages(depsA, { gracePeriodMs: 0 }),
    reconcileOrphanedOutboundMessages(depsB, { gracePeriodMs: 0 }),
  ]);

  assert.equal(resultA.reconciled + resultB.reconciled >= 1, true, "pelo menos uma das duas execuções concorrentes reconcilia a mensagem, nenhuma falha/trava");
  const final = await deps.messageRepository.getById(orphan.id);
  assert.ok(final.outboundPublishedAt, "mensagem termina marcada como publicada independente de qual das duas execuções venceu");

  // Mesmo que ambas tenham publicado (corrida real), o CAS no worker garante só um send real.
  const processed1 = await processOutboundMessage(deps, { messageId: orphan.id });
  const processed2 = await processOutboundMessage(deps, { messageId: orphan.id });
  assert.equal(deps.provider.sentMessages.length, 1, "mesmo sob corrida entre reconciliadores, o provider nunca é chamado mais de uma vez");
});

// -----------------------------------------------------------------------------------------------
// 7-9. Mensagens 'sending'/'sent'/'failed' nunca são reconciliadas indevidamente
// -----------------------------------------------------------------------------------------------

test("mensagem 'sending' não é republicada indevidamente pelo reconciliador", async () => {
  const tenantId = "tenant-orec-6";
  const { conversation } = await makeConversation(tenantId);
  const deps = buildDeps();

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Em voo" });
  // Simula estar 'sending' (trava intencional pré-existente, nunca reconciliada automaticamente).
  await db.pool.query("update inbox_messages set status = 'sending', outbound_published_at = null where id = $1", [message.id]);

  const result = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 0 });
  assert.equal(result.reconciled, 0, "reconciliador só olha status='queued' — 'sending' preserva a trava manual já existente por design");
});

test("mensagem 'sent' nunca volta para queued nem é tocada pelo reconciliador", async () => {
  const tenantId = "tenant-orec-7";
  const { conversation } = await makeConversation(tenantId);
  const deps = buildDeps();

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Já enviada" });
  await processOutboundMessage(deps, { messageId: message.id });
  const sent = await deps.messageRepository.getById(message.id);
  assert.equal(sent.status, "sent");

  const result = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 0 });
  assert.equal(result.reconciled, 0);
  const stillSent = await deps.messageRepository.getById(message.id);
  assert.equal(stillSent.status, "sent", "nunca regride de 'sent' pra qualquer outro estado");
});

test("mensagem 'failed' (terminal) nunca é recuperada indevidamente pelo reconciliador", async () => {
  const tenantId = "tenant-orec-8";
  const { conversation } = await makeConversation(tenantId);
  const deps = buildDeps();

  const message = await sendInboxMessage(deps, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Vai falhar" });
  await deps.messageRepository.markFailed(message.id, { lastError: "Erro definitivo simulado", failedAt: new Date().toISOString(), failureCategory: "permanent" });

  const result = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 0 });
  assert.equal(result.reconciled, 0);
  const stillFailed = await deps.messageRepository.getById(message.id);
  assert.equal(stillFailed.status, "failed");
});

// -----------------------------------------------------------------------------------------------
// 10. Aging/grace period — nunca reconcilia uma mensagem recém-criada que ainda pode estar em voo
// -----------------------------------------------------------------------------------------------

test("aging: mensagem recém-criada e ainda dentro da janela de graça NUNCA é reconciliada prematuramente", async () => {
  const tenantId = "tenant-orec-9";
  const { conversation } = await makeConversation(tenantId);
  const brokerDownQueue = makeFakeOutboundQueue({ failTimes: 1 });
  const deps = buildDeps({ outboundQueue: brokerDownQueue });

  await assert.rejects(() => sendInboxMessage(deps, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Muito recente" }));

  // Janela de graça de 10 minutos: a mensagem tem poucos milissegundos de vida, nunca é elegível.
  const tooSoon = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 10 * 60_000 });
  assert.equal(tooSoon.reconciled, 0, "não reconcilia enquanto ainda pode estar em voo no fluxo normal");
  assert.equal(brokerDownQueue.delivered.length, 0);

  // Sem janela de graça (grace=0), a mesma mensagem já é elegível.
  const afterGrace = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 0 });
  assert.equal(afterGrace.reconciled, 1);
});

// -----------------------------------------------------------------------------------------------
// 11. Restart recupera órfã (simulação: reconciliação rodando "pela primeira vez" após um boot)
// -----------------------------------------------------------------------------------------------

test("restart do worker: reconciliação ao subir encontra e recupera órfãs de ANTES do restart, sem depender de nenhum evento futuro", async () => {
  const tenantId = "tenant-orec-10";
  const { conversation } = await makeConversation(tenantId);
  const brokerDownQueue = makeFakeOutboundQueue({ failTimes: 1 });
  const depsBeforeRestart = buildDeps({ outboundQueue: brokerDownQueue });

  await assert.rejects(() => sendInboxMessage(depsBeforeRestart, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Órfã antes do restart" }));

  // "Restart": novo objeto de deps (processo novo), mesmo Postgres/broker — reconciliação roda
  // IMEDIATAMENTE no boot (não espera o primeiro tick do timer), exatamente como
  // `runOutboundReconciliation()` é chamado antes do `setInterval` em `inbox-worker.ts`.
  const depsAfterRestart = buildDeps({ outboundQueue: brokerDownQueue, messageRepository: depsBeforeRestart.messageRepository });
  const result = await reconcileOrphanedOutboundMessages(depsAfterRestart, { gracePeriodMs: 0 });
  assert.equal(result.reconciled, 1, "órfã de antes do restart é recuperada assim que o processo novo roda a reconciliação, sem esperar nenhum evento futuro");
});

// -----------------------------------------------------------------------------------------------
// 12. Isolamento cross-tenant
// -----------------------------------------------------------------------------------------------

test("isolamento cross-tenant: reconciliação de múltiplos tenants nunca mistura tenantId/workspaceId/connectionId", async () => {
  const tenantA = "tenant-orec-11a";
  const tenantB = "tenant-orec-11b";
  const { conversation: convA } = await makeConversation(tenantA);
  const { conversation: convB } = await makeConversation(tenantB);
  const brokerDownQueue = makeFakeOutboundQueue({ failTimes: 2 });
  const deps = buildDeps({ outboundQueue: brokerDownQueue });

  await assert.rejects(() => sendInboxMessage(deps, { tenantId: tenantA, workspaceId: convA.workspaceId, conversationId: convA.id, body: "A" }));
  await assert.rejects(() => sendInboxMessage(deps, { tenantId: tenantB, workspaceId: convB.workspaceId, conversationId: convB.id, body: "B" }));

  const result = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 0, limit: 100 });
  assert.equal(result.reconciled, 2);

  const publishedForA = brokerDownQueue.delivered.find((p) => p.tenantId === tenantA);
  const publishedForB = brokerDownQueue.delivered.find((p) => p.tenantId === tenantB);
  assert.ok(publishedForA && publishedForA.workspaceId === convA.workspaceId && publishedForA.connectionId === convA.connectionId);
  assert.ok(publishedForB && publishedForB.workspaceId === convB.workspaceId && publishedForB.connectionId === convB.connectionId);
  assert.notEqual(publishedForA.workspaceId, publishedForB.workspaceId, "nunca reconcilia com identificadores de outro tenant");
});

// -----------------------------------------------------------------------------------------------
// 13. Pause continua respeitada mesmo com reconciliação ativa
// -----------------------------------------------------------------------------------------------

test("pause: reconciliador republica normalmente, mas o worker pausado NUNCA chama o provider nem esgota o retry budget", async () => {
  const tenantId = "tenant-orec-12";
  const { conversation } = await makeConversation(tenantId);
  const brokerDownQueue = makeFakeOutboundQueue({ failTimes: 1 });
  const deps = buildDeps({ outboundQueue: brokerDownQueue });

  await assert.rejects(() => sendInboxMessage(deps, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Pausado" }));
  const reconcileResult = await reconcileOrphanedOutboundMessages(deps, { gracePeriodMs: 0 });
  assert.equal(reconcileResult.reconciled, 1, "reconciliador republica no broker independente do kill switch — a pausa é aplicada no CONSUMO, não na publicação");

  const messages = await deps.messageRepository.listByConversation({ tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id });
  const message = messages[0];

  const pausedDeps = buildDeps({ outboundQueue: brokerDownQueue, messageRepository: deps.messageRepository, outboundSendPaused: true });
  await assert.rejects(() => processOutboundMessage(pausedDeps, { messageId: message.id }), /operator_paused|pausado/i);
  assert.equal(pausedDeps.provider.sentMessages.length, 0, "provider NUNCA chamado enquanto pausado, mesmo pra uma mensagem que acabou de ser reconciliada");

  const stillQueued = await deps.messageRepository.getById(message.id);
  assert.equal(stillQueued.status, "queued", "mensagem continua recuperável — nunca perdida nem marcada failed só por estar pausada");
  assert.equal(stillQueued.failureCategory, "outbound_paused");
});

// -----------------------------------------------------------------------------------------------
// 14. Métricas incrementam corretamente
// -----------------------------------------------------------------------------------------------

test("métricas: incOutboundPublishFailed/incOutboundReconciled/incOutboundReconcileFailed disparam nos momentos certos", async () => {
  const tenantId = "tenant-orec-13";
  const { conversation } = await makeConversation(tenantId);
  const brokerDownQueue = makeFakeOutboundQueue({ failTimes: 1 });
  const { recorder: metricsOnFail, calls: callsOnFail } = makeFakeMetrics();
  const depsFail = buildDeps({ outboundQueue: brokerDownQueue, metrics: metricsOnFail });

  await assert.rejects(() => sendInboxMessage(depsFail, { tenantId, workspaceId: conversation.workspaceId, conversationId: conversation.id, body: "Métricas" }));
  assert.ok(callsOnFail.some((c) => c.method === "incOutboundPublishFailed"), "incOutboundPublishFailed disparado quando o publish original falha");

  const { recorder: metricsOnReconcile, calls: callsOnReconcile } = makeFakeMetrics();
  const depsReconcile = buildDeps({ outboundQueue: brokerDownQueue, messageRepository: depsFail.messageRepository, metrics: metricsOnReconcile });
  const result = await reconcileOrphanedOutboundMessages(depsReconcile, { gracePeriodMs: 0 });
  assert.equal(result.reconciled, 1);
  assert.ok(callsOnReconcile.some((c) => c.method === "incOutboundReconciled"), "incOutboundReconciled disparado quando a reconciliação republica com sucesso");

  // Reconciliação que falha (broker AINDA fora do ar) — incOutboundReconcileFailed.
  const stillDownQueue = makeFakeOutboundQueue({ failTimes: 999 });
  const { conversation: conversation2 } = await makeConversation(tenantId);
  const depsAlwaysFail = buildDeps({ outboundQueue: stillDownQueue });
  await assert.rejects(() => sendInboxMessage(depsAlwaysFail, { tenantId, workspaceId: conversation2.workspaceId, conversationId: conversation2.id, body: "Broker nunca volta" }));
  const { recorder: metricsFailedReconcile, calls: callsFailedReconcile } = makeFakeMetrics();
  const depsFailedReconcile = buildDeps({ outboundQueue: stillDownQueue, messageRepository: depsAlwaysFail.messageRepository, metrics: metricsFailedReconcile });
  const failedResult = await reconcileOrphanedOutboundMessages(depsFailedReconcile, { gracePeriodMs: 0 });
  assert.equal(failedResult.failed, 1);
  assert.ok(callsFailedReconcile.some((c) => c.method === "incOutboundReconcileFailed"), "incOutboundReconcileFailed disparado quando o broker ainda está fora do ar na reconciliação");
});
