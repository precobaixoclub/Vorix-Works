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
import { PostgresInboxAttendanceRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-attendance-repository.js";
import { PostgresInboxClosureCatalogRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-closure-catalog-repository.js";
import { PostgresTeamRepository, PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { PostgresTeamKanbanPhaseRepository } from "../dist/infrastructure/storage/postgres/postgres-team-kanban-phase-repository.js";
import { PostgresConversationTimeEntryRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-time-entry-repository.js";
import {
  applyInboundServiceRules,
  assignConversation,
  closeConversation,
  listConversationAttendances,
  listConversationEvents,
  listKanbanPhases,
  moveConversationPhase,
  registerInboundMessage,
  reopenConversation,
  sendInboxMessage,
  setConversationTeam,
  transferConversation,
  updateConnectionSettings,
} from "../dist/application/inbox/inbox-use-cases.js";
import {
  createClosureSubtype,
  createClosureType,
  deleteClosureSubtype,
  deleteClosureType,
  listClosureTypes,
  reorderClosureTypes,
  updateClosureSubtype,
  updateClosureType,
} from "../dist/application/inbox/attendance-tracking.js";
import { createTeam } from "../dist/application/identity/team-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Ciclo de atendimento (migration 0172): a conversa é o histórico permanente; atendimentos abrem
 * e fecham dentro dela; cada responsável tem o próprio ciclo e o próprio relógio de primeira
 * resposta; finalizar exige tipo + subtipo; a pesquisa segue o canal e a permissão; tudo
 * estruturado no banco (o texto do marco é só apresentação).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-attn-${++counter}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => { await db.stop(); });

async function setup(tenantId, { csatOnClose = false, newAttendanceAssignment } = {}) {
  const deps = {
    workspaceRepository: new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") }),
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    conversationEventRepository: new PostgresInboxConversationEventRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    serviceSettingsRepository: new PostgresInboxServiceSettingsRepository(db.pool),
    attendanceRepository: new PostgresInboxAttendanceRepository(db.pool),
    closureCatalogRepository: new PostgresInboxClosureCatalogRepository(db.pool),
    teamRepository: new PostgresTeamRepository(db.pool),
    teamMembershipRepository: new PostgresTeamMembershipRepository(db.pool),
    teamKanbanPhaseRepository: new PostgresTeamKanbanPhaseRepository(db.pool),
    conversationTimeEntryRepository: new PostgresConversationTimeEntryRepository(db.pool),
    outboundQueue: { published: [], async publish(input) { this.published.push(input); } },
    providers: { wuzapi: { async sendText() { return { externalMessageId: "x" }; } } },
  };
  const workspace = await deps.workspaceRepository.create({ tenantId, name: "W" });
  const ctx = { tenantId, workspaceId: workspace.id };
  const connection = await deps.connectionRepository.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Conexão" });
  await deps.connectionRepository.updateStatus(connection.id, { status: "connected", externalSessionId: `sess-${connection.id}` });
  await updateConnectionSettings(deps, { ...ctx, connectionId: connection.id, csatOnClose, ...(newAttendanceAssignment ? { newAttendanceAssignment } : {}) });
  const phone = `+55119${String(++counter).padStart(8, "0")}`;
  // Mensagem do cliente pelo mesmo caminho do worker: registra e aplica as regras de atendimento.
  const inbound = async (body) => {
    const { message, conversation } = await registerInboundMessage(deps, { ...ctx, connectionId: connection.id, chatId: `${phone.slice(1)}@s.whatsapp.net`, chatPhoneE164: phone, isGroup: false, fromMe: false, senderId: phone, externalMessageId: nextId("in"), type: "text", body, occurredAt: new Date().toISOString() });
    const rules = await applyInboundServiceRules(deps, { ...ctx, conversationId: conversation.id, messageId: message.id });
    return { conversation: await deps.conversationRepository.getById(conversation.id), rules };
  };
  const catalog = await listClosureTypes(deps, ctx);
  const resolved = catalog.find((type) => type.name === "Resolvido");
  return { deps, ctx, connection, inbound, catalog, resolved, subtype: resolved.subtypes[0] };
}

const eventsOf = async (deps, ctx, conversationId) => listConversationEvents(deps, { ...ctx, conversationId });

test("migration 0172: tabelas e colunas estruturadas existem", async () => {
  const applied = await db.pool.query("select id from schema_migrations where id = $1", ["0172_inbox_attendance_cycles"]);
  assert.equal(applied.rows.length, 1);
  const columns = await db.pool.query("select column_name from information_schema.columns where table_name = 'inbox_conversation_events' and column_name in ('attendance_id', 'contact_id', 'from_phase_id', 'to_phase_id', 'closure_type_id', 'closure_subtype_id', 'reason')");
  assert.equal(columns.rows.length, 7);
});

test("catálogo: sugestão inicial criada uma única vez e totalmente editável", async () => {
  const { deps, ctx, catalog } = await setup("tenant-attn-catalog");
  assert.deepEqual(catalog.map((type) => type.name), ["Resolvido", "Não resolvido", "Encaminhado", "Sem retorno"]);
  assert.ok(catalog.every((type) => type.subtypes.length > 0));

  const created = await createClosureType(deps, { ...ctx, name: "  Venda   perdida " });
  assert.equal(created.name, "Venda perdida");
  await assert.rejects(createClosureType(deps, { ...ctx, name: "venda perdida" }), /INBOX_CLOSURE_NAME_TAKEN/);
  const withSubtype = await createClosureSubtype(deps, { ...ctx, closureTypeId: created.id, name: "Preço" });
  assert.equal(withSubtype.subtypes.length, 1);
  const renamed = await updateClosureSubtype(deps, { ...ctx, closureTypeId: created.id, closureSubtypeId: withSubtype.subtypes[0].id, name: "Preço alto" });
  assert.equal(renamed.subtypes[0].name, "Preço alto");
  const inactive = await updateClosureType(deps, { ...ctx, closureTypeId: created.id, isActive: false });
  assert.equal(inactive.isActive, false);

  const reversed = [...(await listClosureTypes(deps, ctx))].reverse().map((type) => type.id);
  const reordered = await reorderClosureTypes(deps, { ...ctx, closureTypeIds: reversed });
  assert.deepEqual(reordered.map((type) => type.id), reversed);
  await assert.rejects(reorderClosureTypes(deps, { ...ctx, closureTypeIds: reversed.slice(1) }), /INBOX_CLOSURE_REORDER_MISMATCH/);

  // Excluir tudo nunca faz a sugestão voltar.
  for (const type of await listClosureTypes(deps, ctx)) await deleteClosureType(deps, { ...ctx, closureTypeId: type.id });
  assert.deepEqual(await listClosureTypes(deps, ctx), []);

  // Isolamento: tipo de outro workspace responde "não existe".
  const other = await setup("tenant-attn-catalog-2");
  await assert.rejects(updateClosureType(deps, { ...ctx, closureTypeId: other.resolved.id, name: "x" }), /INBOX_CLOSURE_TYPE_NOT_FOUND/);
});

test("fluxo completo: abrir, atribuir, 1ª resposta, mover fase, transferir, finalizar e novo atendimento na mesma conversa", async () => {
  const { deps, ctx, inbound, resolved, subtype, catalog } = await setup("tenant-attn-flow");

  // 1. Cliente escreve: atendimento #1 aberto na fila, com o marco estruturado.
  const { conversation } = await inbound("Oi, quero saber o preço");
  let [attendance] = await listConversationAttendances(deps, { ...ctx, conversationId: conversation.id });
  assert.equal(attendance.status, "open");
  assert.equal(attendance.number, 1);
  assert.equal(attendance.openReason, "inbound_message");
  assert.equal(attendance.distributionRule, "queue");
  assert.equal(attendance.assignments.length, 0);

  // 2. Atribuído ao João: ciclo dele começa agora.
  await assignConversation(deps, { ...ctx, conversationId: conversation.id, assignedUserId: "user-joao", performedBy: "user-gestor" });
  // Um supervisor respondendo no lugar não é a primeira resposta do João.
  await sendInboxMessage(deps, { ...ctx, conversationId: conversation.id, body: "Já vamos te atender", sentByUserId: "user-gestor" });
  // 3. João responde.
  await wait(20);
  await sendInboxMessage(deps, { ...ctx, conversationId: conversation.id, body: "Olá! Sou o João.", sentByUserId: "user-joao" });

  // 4. Fase do kanban (com equipe).
  const team = await createTeam({ teamRepository: deps.teamRepository, teamMembershipRepository: deps.teamMembershipRepository, workspaceRepository: deps.workspaceRepository }, { ...ctx, name: "Vendas" });
  await setConversationTeam(deps, { ...ctx, conversationId: conversation.id, teamId: team.id, performedBy: "user-joao" });
  const phases = await listKanbanPhases(deps, { ...ctx, teamId: team.id });
  await moveConversationPhase(deps, { ...ctx, teamId: team.id, conversationId: conversation.id, phaseId: phases[0].id, performedBy: "user-joao" });
  await moveConversationPhase(deps, { ...ctx, teamId: team.id, conversationId: conversation.id, phaseId: phases[1].id, performedBy: "user-joao" });

  await deps.teamMembershipRepository.add({ teamId: team.id, userId: "user-maria", role: "editor" });

  // 5. Transferência João → Maria: novo relógio para a Maria.
  await wait(20);
  await transferConversation(deps, { ...ctx, conversationId: conversation.id, toUserId: "user-maria", performedBy: "user-joao" });
  await wait(20);
  await sendInboxMessage(deps, { ...ctx, conversationId: conversation.id, body: "Oi, aqui é a Maria.", sentByUserId: "user-maria" });

  [attendance] = await listConversationAttendances(deps, { ...ctx, conversationId: conversation.id });
  const [joao, maria] = attendance.assignments;
  assert.equal(attendance.assignments.length, 2);
  assert.equal(joao.userId, "user-joao");
  assert.equal(joao.source, "manual");
  assert.ok(joao.firstResponseAt, "primeira resposta do João registrada");
  assert.ok(joao.firstResponseAt >= joao.startedAt);
  assert.equal(joao.endReason, "transferred");
  assert.equal(joao.transferredToUserId, "user-maria");
  assert.ok(typeof joao.holdingSeconds === "number");
  assert.equal(maria.userId, "user-maria");
  assert.equal(maria.source, "transfer");
  assert.equal(maria.startedAt, joao.endedAt, "o relógio da Maria começa na transferência, nunca na abertura");
  assert.ok(maria.firstResponseAt > maria.startedAt);
  assert.ok(Date.parse(maria.firstResponseAt) - Date.parse(maria.startedAt) < Date.parse(maria.firstResponseAt) - Date.parse(attendance.openedAt));
  assert.equal(attendance.firstResponseBy, "user-gestor", "1ª resposta do ATENDIMENTO é de qualquer pessoa");

  // 6. Finalizar exige tipo E subtipo válidos e ativos.
  await assert.rejects(closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "user-maria" }), /INBOX_CLOSURE_REQUIRED/);
  const otherType = catalog.find((type) => type.name === "Sem retorno");
  await assert.rejects(closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "user-maria", closureTypeId: resolved.id, closureSubtypeId: otherType.subtypes[0].id }), /INBOX_CLOSURE_INVALID/);
  await updateClosureType(deps, { ...ctx, closureTypeId: otherType.id, isActive: false });
  await assert.rejects(closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "user-maria", closureTypeId: otherType.id, closureSubtypeId: otherType.subtypes[0].id }), /INBOX_CLOSURE_INVALID/);

  const closed = await closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "user-maria", closureTypeId: resolved.id, closureSubtypeId: subtype.id, closureNote: "Cliente satisfeito" });
  assert.equal(closed.status, "resolved");
  assert.equal(closed.closingReason, `Resolvido > ${subtype.name}`, "relatórios atuais de motivo continuam funcionando");
  [attendance] = await listConversationAttendances(deps, { ...ctx, conversationId: conversation.id });
  assert.equal(attendance.status, "closed");
  assert.equal(attendance.closureTypeId, resolved.id);
  assert.equal(attendance.closureSubtypeName, subtype.name);
  assert.equal(attendance.closureNote, "Cliente satisfeito");
  assert.ok(attendance.closedAt >= attendance.openedAt);
  assert.equal(typeof attendance.resolutionSeconds, "number");
  assert.equal(attendance.csatStatus, "disabled_by_channel");
  assert.equal(attendance.assignments[1].endReason, "attendance_closed");
  // Idempotente: segunda finalização não duplica nada.
  await closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "user-maria", closureTypeId: resolved.id, closureSubtypeId: subtype.id });

  // 7. Marcos estruturados (nunca só texto) e ligados ao atendimento.
  const events = await eventsOf(deps, ctx, conversation.id);
  const byType = (type) => events.filter((event) => event.type === type);
  assert.equal(byType("attendance_opened").length, 1);
  assert.equal(byType("attendance_closed").length, 1);
  const closedEvent = byType("attendance_closed")[0];
  assert.equal(closedEvent.attendanceId, attendance.id);
  assert.equal(closedEvent.closureTypeId, resolved.id);
  assert.equal(closedEvent.closureSubtypeId, subtype.id);
  assert.equal(closedEvent.fromUserId, "user-maria");
  const transferred = byType("transferred")[0];
  assert.equal(transferred.fromUserId, "user-joao");
  assert.equal(transferred.toUserId, "user-maria");
  assert.equal(transferred.attendanceId, attendance.id, "evento comum ligado automaticamente ao atendimento aberto");
  const moved = byType("kanban_phase_changed").at(-1);
  assert.equal(moved.fromPhaseId, phases[0].id);
  assert.equal(moved.toPhaseId, phases[1].id);
  assert.equal(moved.metadata.fromPhaseName, phases[0].name);
  assert.ok(events.every((event) => event.contactId === conversation.contactId));
  // Nenhum marco vira mensagem para o cliente: só as 3 respostas humanas saíram.
  assert.equal(deps.outboundQueue.published.length, 3);

  // 8. Cliente volta a falar: atendimento NOVO (#2) na MESMA conversa, com o último responsável.
  const { conversation: again } = await inbound("Oi de novo, outra dúvida");
  assert.equal(again.id, conversation.id);
  assert.equal(again.status, "open");
  assert.equal(again.assignedUserId, "user-maria");
  const attendances = await listConversationAttendances(deps, { ...ctx, conversationId: conversation.id });
  assert.equal(attendances.length, 2);
  assert.equal(attendances[0].number, 2);
  assert.equal(attendances[0].status, "open");
  assert.equal(attendances[0].distributionRule, "last_assignee");
  assert.equal(attendances[0].assignments[0].userId, "user-maria");
  assert.equal(attendances[0].assignments[0].source, "last_assignee");
  assert.equal(attendances[1].status, "closed", "o atendimento anterior não é reaberto");
});

test("pesquisa por canal: atendente não dispensa; gerente dispensa e fica registrado; nota do cliente nunca abre atendimento", async () => {
  const { deps, ctx, inbound, resolved, subtype } = await setup("tenant-attn-csat", { csatOnClose: true });
  const { conversation } = await inbound("Olá");
  const close = (extra) => closeConversation(deps, { ...ctx, conversationId: conversation.id, closureTypeId: resolved.id, closureSubtypeId: subtype.id, ...extra });

  await assert.rejects(close({ performedBy: "user-atendente", sendCsat: false, canWaiveCsat: false }), /INBOX_CSAT_WAIVE_FORBIDDEN/);
  const sent = await close({ performedBy: "user-atendente" });
  assert.equal(sent.csatStatus, "awaiting");
  let [attendance] = await listConversationAttendances(deps, { ...ctx, conversationId: conversation.id });
  assert.equal(attendance.csatStatus, "sent");
  assert.ok(attendance.csatSentAt);
  assert.equal((await eventsOf(deps, ctx, conversation.id)).filter((event) => event.type === "csat_sent").length, 1);

  // Nota "5": registrada no atendimento finalizado, sem abrir outro.
  const { rules } = await inbound("5");
  assert.equal(rules.csatAnswered, true);
  const afterScore = await listConversationAttendances(deps, { ...ctx, conversationId: conversation.id });
  assert.equal(afterScore.length, 1);
  assert.equal(afterScore[0].csatScore, 5);
  assert.equal((await eventsOf(deps, ctx, conversation.id)).find((event) => event.type === "csat_answered").attendanceId, attendance.id);

  // Novo atendimento, finalizado pelo gerente dispensando a pesquisa.
  await inbound("Preciso de outra coisa");
  await close({ performedBy: "user-gerente", sendCsat: false, canWaiveCsat: true });
  [attendance] = await listConversationAttendances(deps, { ...ctx, conversationId: conversation.id });
  assert.equal(attendance.number, 2);
  assert.equal(attendance.csatStatus, "waived");
  assert.equal(attendance.csatWaivedBy, "user-gerente");
  const waived = (await eventsOf(deps, ctx, conversation.id)).find((event) => event.type === "csat_not_sent");
  assert.equal(waived.reason, "waived");
  assert.equal(waived.performedBy, "user-gerente");
});

test("reabrir manualmente reabre o MESMO atendimento; canal com redistribuição tira o último responsável", async () => {
  const { deps, ctx, inbound, resolved, subtype } = await setup("tenant-attn-reopen", { newAttendanceAssignment: "redistribute" });
  const { conversation } = await inbound("Olá");
  await assignConversation(deps, { ...ctx, conversationId: conversation.id, assignedUserId: "user-ana", performedBy: "user-ana" });
  await closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "user-ana", closureTypeId: resolved.id, closureSubtypeId: subtype.id });

  const reopened = await reopenConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "user-ana" });
  assert.equal(reopened.status, "open");
  let attendances = await listConversationAttendances(deps, { ...ctx, conversationId: conversation.id });
  assert.equal(attendances.length, 1, "reabrir não cria atendimento novo");
  assert.equal(attendances[0].status, "open");
  assert.equal(attendances[0].reopenedCount, 1);
  assert.equal(attendances[0].closureTypeId, undefined);
  assert.equal(attendances[0].assignments.length, 2, "ciclo novo para a responsável depois de reabrir");
  assert.equal((await eventsOf(deps, ctx, conversation.id)).filter((event) => event.type === "attendance_reopened").length, 1);
  // A finalização anterior continua no marco estruturado.
  assert.equal((await eventsOf(deps, ctx, conversation.id)).filter((event) => event.type === "attendance_closed").length, 1);

  await closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "user-ana", closureTypeId: resolved.id, closureSubtypeId: subtype.id });
  const { conversation: again } = await inbound("Voltei");
  assert.equal(again.assignedUserId, undefined, "redistribui: sem roteamento configurado, vai para a fila");
  attendances = await listConversationAttendances(deps, { ...ctx, conversationId: conversation.id });
  assert.equal(attendances.length, 2);
  assert.equal(attendances[0].distributionRule, "queue");
});

test("concorrência: duas mensagens simultâneas nunca abrem dois atendimentos", async () => {
  const { deps, ctx, connection } = await setup("tenant-attn-race");
  const conversation = await deps.conversationRepository.findOrCreate({ ...ctx, connectionId: connection.id, chatType: "direct", externalChatId: "+5511900000999" });
  const results = await Promise.all(Array.from({ length: 6 }, () => deps.attendanceRepository.openIfNone({ ...ctx, conversationId: conversation.id, connectionId: connection.id, openedAt: new Date().toISOString(), openedBy: "system", openReason: "inbound_message" })));
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.attendance.id)).size, 1);
});

test("subtipo excluído some do catálogo e não pode mais ser usado para finalizar", async () => {
  const { deps, ctx, inbound, resolved, subtype } = await setup("tenant-attn-subdelete");
  await deleteClosureSubtype(deps, { ...ctx, closureTypeId: resolved.id, closureSubtypeId: subtype.id });
  const fresh = (await listClosureTypes(deps, ctx)).find((type) => type.id === resolved.id);
  assert.ok(!fresh.subtypes.some((item) => item.id === subtype.id));
  const { conversation } = await inbound("Olá");
  await assert.rejects(closeConversation(deps, { ...ctx, conversationId: conversation.id, performedBy: "u", closureTypeId: resolved.id, closureSubtypeId: subtype.id }), /INBOX_CLOSURE_INVALID/);
});

test("backfill da 0172: conversa já em atendimento ganha um atendimento aberto e o ciclo do responsável atual", async () => {
  const { readFile } = await import("node:fs/promises");
  const { deps, ctx, connection } = await setup("tenant-attn-backfill");
  const conversation = await deps.conversationRepository.findOrCreate({ ...ctx, connectionId: connection.id, chatType: "direct", externalChatId: "+5511900000777" });
  await deps.conversationRepository.assign(conversation.id, "user-legado");
  const resolvedConversation = await deps.conversationRepository.findOrCreate({ ...ctx, connectionId: connection.id, chatType: "direct", externalChatId: "+5511900000778" });
  await deps.conversationRepository.setStatus(resolvedConversation.id, "resolved");

  // Reexecuta só os dois inserts de backfill da migration (idempotentes por construção).
  const sql = await readFile(join(MIGRATIONS_DIR, "0172_inbox_attendance_cycles.sql"), "utf8");
  const backfill = sql.slice(sql.indexOf("insert into inbox_attendances")).split(";").map((statement) => statement.trim()).filter(Boolean);
  for (const statement of backfill) await db.pool.query(statement);
  for (const statement of backfill) await db.pool.query(statement);

  const [attendance, ...rest] = await listConversationAttendances(deps, { ...ctx, conversationId: conversation.id });
  assert.equal(rest.length, 0);
  assert.equal(attendance.status, "open");
  assert.equal(attendance.openReason, "migration");
  assert.equal(attendance.assignments.length, 1);
  assert.equal(attendance.assignments[0].userId, "user-legado");
  assert.deepEqual(await listConversationAttendances(deps, { ...ctx, conversationId: resolvedConversation.id }), [], "finalizada não ganha atendimento aberto");
});
