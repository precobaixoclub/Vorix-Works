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
import { PostgresInboxServiceSettingsRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-service-settings-repository.js";
import { PostgresInboxMetricsRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-metrics-repository.js";
import {
  applyInboundServiceRules, closeConversation, getInboxServiceSettings, registerInboundMessage, reopenConversation, startInboxConversation, updateInboxServiceSettings,
} from "../dist/application/inbox/inbox-use-cases.js";
import { isWithinBusinessHours, normalizeWeeklySchedule, parseCsatScore } from "../dist/domain/inbox/service-settings.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Regras de atendimento (migration 0151): horário/ausência, motivos de encerramento, pesquisa de
 * satisfação e reabertura quando o cliente volta a escrever. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-rules-${++counter}`;

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => { await db.stop(); });

async function setup(tenantId) {
  const deps = {
    workspaceRepository: new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }),
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    serviceSettingsRepository: new PostgresInboxServiceSettingsRepository(db.pool),
    outboundQueue: { published: [], async publish(input) { this.published.push(input); } },
    providers: { wuzapi: { async sendText() { return { externalMessageId: "x" }; } } },
  };
  const workspace = await deps.workspaceRepository.create({ tenantId, name: "W" });
  const connection = await deps.connectionRepository.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await deps.connectionRepository.updateStatus(connection.id, { status: "connected", externalSessionId: `sess-${connection.id}` });
  const phone = `+55119${String(++counter).padStart(8, "0")}`;
  const { conversation } = await startInboxConversation(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, phone, body: "Olá", startedByUserId: "agent-1" });
  const inbound = async (body, externalMessageId = nextId("in")) => {
    const registered = await registerInboundMessage(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, chatId: `${phone.slice(1)}@s.whatsapp.net`, chatPhoneE164: phone, isGroup: false, fromMe: false, senderId: phone, externalMessageId, type: "text", body, occurredAt: new Date().toISOString() });
    return registered.message;
  };
  const outboundBodies = async () => (await deps.messageRepository.listByConversation({ tenantId, workspaceId: workspace.id, conversationId: conversation.id })).filter((m) => m.direction === "outbound").map((m) => m.body);
  return { deps, workspace, connection, conversation, inbound, outboundBodies, ctx: { tenantId, workspaceId: workspace.id } };
}

test("domínio: horário por fuso, validação de intervalos e leitura da nota", () => {
  const settings = { timezone: "America/Sao_Paulo", businessHours: normalizeWeeklySchedule({ mon: [{ start: "08:00", end: "18:00" }] }) };
  assert.equal(isWithinBusinessHours(settings, new Date("2026-10-12T12:00:00Z")), true, "segunda 09:00 em SP");
  assert.equal(isWithinBusinessHours(settings, new Date("2026-10-12T22:00:00Z")), false, "segunda 19:00 em SP");
  assert.equal(isWithinBusinessHours(settings, new Date("2026-10-11T12:00:00Z")), false, "domingo");
  assert.throws(() => normalizeWeeklySchedule({ mon: [{ start: "18:00", end: "08:00" }] }), /INBOX_SERVICE_SETTINGS_INVALID/);
  assert.throws(() => normalizeWeeklySchedule({ mon: [{ start: "08:00", end: "12:00" }, { start: "11:00", end: "14:00" }] }), /INBOX_SERVICE_SETTINGS_INVALID/);
  for (const [text, score] of [["5", 5], [" 4 ", 4], ["nota 3", 3], ["2 estrelas", 2], ["5️⃣", 5], ["⭐⭐⭐⭐", 4], ["1/5", 1]]) assert.equal(parseCsatScore(text), score, text);
  for (const text of ["6", "obrigado", "5 reais", "0", "tenho 3 dúvidas"]) assert.equal(parseCsatScore(text), undefined, text);
});

test("configurações: padrões, validação e motivo obrigatório só com motivos cadastrados", async () => {
  const { deps, ctx } = await setup("tenant-rules-1");
  const defaults = await getInboxServiceSettings(deps, ctx);
  assert.equal(defaults.awayEnabled, false);
  assert.ok(defaults.closingReasons.length > 0);
  await assert.rejects(updateInboxServiceSettings(deps, { ...ctx, timezone: "Mars/Olympus" }), /INBOX_SERVICE_SETTINGS_INVALID/);
  const saved = await updateInboxServiceSettings(deps, { ...ctx, closingReasons: [" Venda ", "Venda", "Dúvida"], requireClosingReason: true });
  assert.deepEqual(saved.closingReasons, ["Venda", "Dúvida"]);
  const empty = await updateInboxServiceSettings(deps, { ...ctx, closingReasons: [] });
  assert.equal(empty.requireClosingReason, false, "sem motivos cadastrados nunca exige motivo");
});

test("finalizar: exige motivo quando configurado, grava quem/quando/motivo e envia a pesquisa", async () => {
  const { deps, conversation, outboundBodies, ctx } = await setup("tenant-rules-2");
  await updateInboxServiceSettings(deps, { ...ctx, closingReasons: ["Venda realizada"], requireClosingReason: true, csatEnabled: true });
  await assert.rejects(closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "agent-1" }), /INBOX_CLOSING_REASON_REQUIRED/);
  await assert.rejects(closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "agent-1", closingReason: "Outro" }), /INBOX_CLOSING_REASON_INVALID/);

  const closed = await closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "agent-1", closingReason: "Venda realizada" });
  assert.equal(closed.status, "resolved");
  assert.equal(closed.closingReason, "Venda realizada");
  assert.equal(closed.closedBy, "agent-1");
  assert.equal(closed.csatStatus, "awaiting");
  assert.ok((await outboundBodies()).some((body) => body.includes("1 (ruim) a 5")));
});

test("pesquisa: nota do cliente é gravada, agradece e NÃO reabre; texto comum reabre e expira a pesquisa", async () => {
  const { deps, conversation, inbound, outboundBodies, ctx } = await setup("tenant-rules-3");
  await updateInboxServiceSettings(deps, { ...ctx, csatEnabled: true });
  await closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "agent-1" });

  const answer = await inbound("5");
  const rules = await applyInboundServiceRules(deps, { ...ctx, conversationId: conversation.id, messageId: answer.id });
  assert.deepEqual(rules, { csatAnswered: true, reopened: false, awayMessageSent: false });
  let current = await deps.conversationRepository.getById(conversation.id);
  assert.equal(current.status, "resolved");
  assert.equal(current.csatScore, 5);
  assert.equal(current.unreadCount, 0);
  assert.ok((await outboundBodies()).includes("Obrigado pela sua avaliação!"));

  const metrics = await new PostgresInboxMetricsRepository(db.pool).getMetrics(ctx);
  assert.equal(metrics.csatAverage, 5);
  assert.equal(metrics.csatResponses, 1);
  assert.deepEqual(metrics.csatByAgent, [{ userId: "agent-1", average: 5, responses: 1 }]);

  // Novo encerramento, cliente responde outra coisa: reabre e a pesquisa expira.
  await reopenConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "agent-1" });
  await closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "agent-1" });
  const text = await inbound("Na verdade preciso de mais uma coisa");
  const second = await applyInboundServiceRules(deps, { ...ctx, conversationId: conversation.id, messageId: text.id });
  assert.equal(second.reopened, true);
  current = await deps.conversationRepository.getById(conversation.id);
  assert.equal(current.status, "open");
  assert.equal(current.csatStatus, "expired");
});

test("cliente escrevendo numa conversa finalizada (sem pesquisa) reabre a conversa", async () => {
  const { deps, conversation, inbound, ctx } = await setup("tenant-rules-4");
  await closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "agent-1" });
  const message = await inbound("Oi de novo");
  const rules = await applyInboundServiceRules(deps, { ...ctx, conversationId: conversation.id, messageId: message.id });
  assert.equal(rules.reopened, true);
  assert.equal((await deps.conversationRepository.getById(conversation.id)).status, "open");
});

test("ausência: só fora do horário, no máximo uma a cada 12h", async () => {
  const { deps, conversation, inbound, outboundBodies, ctx } = await setup("tenant-rules-5");
  await updateInboxServiceSettings(deps, { ...ctx, awayEnabled: true, awayMessage: "Estamos fora do horário.", businessHours: { mon: [{ start: "08:00", end: "18:00" }] } });
  const sundayNight = new Date("2026-10-11T23:00:00Z");
  const inside = new Date("2026-10-12T13:00:00Z");

  const first = await inbound("Oi?");
  assert.equal((await applyInboundServiceRules(deps, { ...ctx, conversationId: conversation.id, messageId: first.id, now: inside })).awayMessageSent, false);
  assert.equal((await applyInboundServiceRules(deps, { ...ctx, conversationId: conversation.id, messageId: first.id, now: sundayNight })).awayMessageSent, true);
  const second = await inbound("Alguém?");
  assert.equal((await applyInboundServiceRules(deps, { ...ctx, conversationId: conversation.id, messageId: second.id, now: new Date(sundayNight.getTime() + 60 * 60 * 1000) })).awayMessageSent, false);
  assert.equal((await outboundBodies()).filter((body) => body === "Estamos fora do horário.").length, 1);
});
