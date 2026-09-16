import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresInboxConversationEventRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-event-repository.js";
import { PostgresTeamRepository, PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { PostgresTeamKanbanPhaseRepository } from "../dist/infrastructure/storage/postgres/postgres-team-kanban-phase-repository.js";
import { PostgresConversationTimeEntryRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-time-entry-repository.js";
import { createTeam } from "../dist/application/identity/team-use-cases.js";
import {
  registerInboundMessage,
  listKanbanPhases,
  createKanbanPhase,
  updateKanbanPhase,
  deleteKanbanPhase,
  reorderKanbanPhases,
  moveConversationPhase,
  ensureConversationPhaseStates,
  getConversationsServiceTime,
  setConversationPinned,
  closeConversation,
  reopenConversation,
  setConversationTeam,
} from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Bloco "kanban de atendimento" (réplica adaptada do CMDesk, pedido explícito do usuário: "criar
 * uma kanban de atendimento dentro do VORIX onde eu consigo controlar as conversas por fases
 * igual no CMDESK"). Cobre: criação preguiçosa das 3 fases padrão, CRUD de fase (com o fallback de
 * exclusão e o reorder em duas passadas), o algoritmo central de mover card (com lock — nunca
 * duas entradas de tempo abertas mesmo sob concorrência real), tempo de atendimento RUNNING vs
 * PAUSED, e pin.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
before(async () => {
  db = await startTestPostgres({ port: 55715 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeSetup(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => `workspace-${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` });
  const workspace = await workspaceRepo.create({ tenantId, name: "W" });
  const teamRepository = new PostgresTeamRepository(db.pool);
  const teamMembershipRepository = new PostgresTeamMembershipRepository(db.pool);
  const teamKanbanPhaseRepository = new PostgresTeamKanbanPhaseRepository(db.pool);
  const conversationTimeEntryRepository = new PostgresConversationTimeEntryRepository(db.pool);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const conversationEventRepo = new PostgresInboxConversationEventRepository(db.pool);

  const deps = {
    contactRepository: contactRepo,
    conversationRepository: conversationRepo,
    messageRepository: messageRepo,
    conversationEventRepository: conversationEventRepo,
    teamRepository,
    teamMembershipRepository,
    teamKanbanPhaseRepository,
    conversationTimeEntryRepository,
  };
  return { workspace, connectionRepo, deps, teamRepository, teamMembershipRepository, teamKanbanPhaseRepository, conversationTimeEntryRepository, conversationRepo };
}

async function makeConversation(tenantId, workspace, connectionRepo, deps, externalMessageId) {
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Canal" });
  const registered = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: `+551199${Math.floor(Math.random() * 10_000_000)}`, isGroup: false, fromMe: false,
    senderId: "+5511900000000", senderName: "Cliente",
    externalMessageId, type: "text", body: "Oi", occurredAt: new Date().toISOString(),
  });
  return registered.conversation;
}

test("FASES_PADRAO: listKanbanPhases cria as 3 fases padrão na primeira vez, idempotente depois", async () => {
  const tenantId = "tenant-kanban-1";
  const { workspace, deps, teamRepository } = await makeSetup(tenantId);
  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });

  const first = await listKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  assert.equal(first.length, 3);
  assert.deepEqual(first.map((phase) => phase.name), ["Novos", "Em atendimento", "Aguardando retorno"]);
  assert.equal(first[0].isDefaultFirst, true);
  assert.equal(first[1].isDefaultFirst, false);
  assert.equal(first[0].phaseType, "RUNNING");
  assert.equal(first[2].phaseType, "PAUSED");

  const second = await listKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  assert.equal(second.length, 3, "chamar de novo nunca duplica as fases padrão");
});

test("FASE_CRUD: criar, editar (isDefaultFirst desmarca a anterior), e o erro claro pra fase de outra equipe", async () => {
  const tenantId = "tenant-kanban-2";
  const { workspace, deps } = await makeSetup(tenantId);
  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  const otherTeam = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Outra" });

  const created = await createKanbanPhase(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, name: "Escalado", phaseType: "PAUSED" });
  assert.equal(created.orderIndex, 3, "nova fase entra no fim (depois das 3 padrão, criadas lazy pelo create)");

  const promoted = await updateKanbanPhase(deps, { teamId: team.id, phaseId: created.id, tenantId, workspaceId: workspace.id, isDefaultFirst: true });
  assert.equal(promoted.isDefaultFirst, true);
  const phases = await listKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  const oldDefault = phases.find((phase) => phase.name === "Novos");
  assert.equal(oldDefault.isDefaultFirst, false, "marcar uma nova fase padrão desmarca a anterior");
  assert.equal(phases.filter((phase) => phase.isDefaultFirst).length, 1, "no máximo uma fase padrão por equipe");

  await listKanbanPhases(deps, { teamId: otherTeam.id, tenantId, workspaceId: workspace.id });
  const otherPhases = await deps.teamKanbanPhaseRepository.listByTeam(otherTeam.id);
  await assert.rejects(
    updateKanbanPhase(deps, { teamId: team.id, phaseId: otherPhases[0].id, tenantId, workspaceId: workspace.id, name: "Hack" }),
    /KANBAN_PHASE_NOT_FOUND/,
  );
});

test("FASE_DELETE: bloqueia excluir a última fase; migra cards pro fallback; herda isDefaultFirst; reindexa", async () => {
  const tenantId = "tenant-kanban-3";
  const { workspace, connectionRepo, deps, teamKanbanPhaseRepository, conversationRepo } = await makeSetup(tenantId);
  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  const phases = await listKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  const [novos, emAtendimento, aguardando] = phases;

  // Roteia manualmente a conversa pra equipe (fora de escopo deste teste testar o roteamento em
  // si, já coberto em team-routing.test.mjs) e move pra "Em atendimento".
  const conversation = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.kanban-delete-1");
  await conversationRepo.setTeam(conversation.id, team.id);
  await moveConversationPhase(deps, { teamId: team.id, conversationId: conversation.id, tenantId, workspaceId: workspace.id, phaseId: emAtendimento.id, performedBy: "user-1" });

  await deleteKanbanPhase(deps, { teamId: team.id, phaseId: emAtendimento.id, tenantId, workspaceId: workspace.id });
  const afterDelete = await conversationRepo.getById(conversation.id);
  assert.equal(afterDelete.currentPhaseId, novos.id, "card migra pro fallback (fase padrão) — nunca fica órfão");

  // Achado de revisão: excluir a fase não pode deixar a entrada de tempo ABERTA presa na fase já
  // excluída — sem fechar/reabrir, o badge "rodando" ficaria com o snapshot de phaseType antigo.
  const entriesAfterDelete = await db.pool.query(
    "select phase_id, phase_type, ended_at from conversation_time_entries where conversation_id = $1 order by created_at",
    [conversation.id],
  );
  assert.equal(entriesAfterDelete.rows.length, 2, "fecha a entrada da fase excluída e abre uma nova no fallback");
  assert.notEqual(entriesAfterDelete.rows[0].ended_at, null, "entrada da fase excluída foi fechada, nunca fica órfã aberta");
  assert.equal(entriesAfterDelete.rows[1].ended_at, null, "nova entrada no fallback fica aberta");
  assert.equal(entriesAfterDelete.rows[1].phase_id, novos.id);
  const serviceTimeAfterDelete = await getConversationsServiceTime(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, conversationIds: [conversation.id] });
  assert.equal(serviceTimeAfterDelete[0].isRunning, true, "fallback (Novos) é RUNNING — cronômetro continua 'rodando', nunca preso na fase excluída");

  const remaining = await teamKanbanPhaseRepository.listByTeam(team.id);
  assert.equal(remaining.length, 2);
  assert.deepEqual(remaining.map((phase) => phase.orderIndex), [0, 1], "reindexado, sem buracos");

  // Excluir a fase padrão promove o fallback a novo padrão.
  await deleteKanbanPhase(deps, { teamId: team.id, phaseId: novos.id, tenantId, workspaceId: workspace.id });
  const finalPhases = await teamKanbanPhaseRepository.listByTeam(team.id);
  assert.equal(finalPhases.length, 1);
  assert.equal(finalPhases[0].id, aguardando.id);
  assert.equal(finalPhases[0].isDefaultFirst, true, "a fase restante herda isDefaultFirst da excluída");

  await assert.rejects(
    deleteKanbanPhase(deps, { teamId: team.id, phaseId: aguardando.id, tenantId, workspaceId: workspace.id }),
    /KANBAN_LAST_PHASE/,
  );
});

test("FASE_DELETE_CRONOMETRO: fallback PAUSED faz o cronômetro parar — nunca preso no phaseType RUNNING da fase excluída", async () => {
  const tenantId = "tenant-kanban-3b";
  const { workspace, connectionRepo, deps } = await makeSetup(tenantId);
  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  const phases = await listKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  const emAtendimento = phases.find((phase) => phase.name === "Em atendimento");

  const pausada = await createKanbanPhase(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, name: "Pausada", phaseType: "PAUSED" });
  await updateKanbanPhase(deps, { teamId: team.id, phaseId: pausada.id, tenantId, workspaceId: workspace.id, isDefaultFirst: true });

  const conversation = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.kanban-delete-2");
  await deps.conversationRepository.setTeam(conversation.id, team.id);
  await moveConversationPhase(deps, { teamId: team.id, conversationId: conversation.id, tenantId, workspaceId: workspace.id, phaseId: emAtendimento.id, performedBy: "user-1" });

  let serviceTime = await getConversationsServiceTime(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, conversationIds: [conversation.id] });
  assert.equal(serviceTime[0].isRunning, true, "em 'Em atendimento' (RUNNING) o cronômetro está rodando antes da exclusão");

  // "Pausada" é isDefaultFirst agora — vira o fallback ao excluir "Em atendimento" (RUNNING).
  await deleteKanbanPhase(deps, { teamId: team.id, phaseId: emAtendimento.id, tenantId, workspaceId: workspace.id });

  serviceTime = await getConversationsServiceTime(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, conversationIds: [conversation.id] });
  assert.equal(serviceTime[0].isRunning, false, "fallback é PAUSED — o cronômetro para; sem o fix ficaria preso em 'rodando' (snapshot da fase já excluída)");
});

test("FECHAR/REABRIR: resolver a conversa fecha o cronômetro do kanban; reabrir reabre na MESMA fase", async () => {
  const tenantId = "tenant-kanban-close-reopen";
  const { workspace, connectionRepo, deps } = await makeSetup(tenantId);
  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  const phases = await listKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  const emAtendimento = phases.find((phase) => phase.name === "Em atendimento");

  const conversation = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.kanban-close-1");
  await deps.conversationRepository.setTeam(conversation.id, team.id);
  await moveConversationPhase(deps, { teamId: team.id, conversationId: conversation.id, tenantId, workspaceId: workspace.id, phaseId: emAtendimento.id, performedBy: "user-1" });

  await closeConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, performedBy: "user-1" });
  const afterClose = await db.pool.query(
    "select ended_at from conversation_time_entries where conversation_id = $1 order by created_at desc limit 1",
    [conversation.id],
  );
  assert.notEqual(afterClose.rows[0].ended_at, null, "resolver a conversa fecha a entrada de tempo aberta — nunca conta tempo 'parada' como atendimento");

  await reopenConversation(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, performedBy: "user-1" });
  const afterReopen = await db.pool.query(
    "select phase_id, ended_at from conversation_time_entries where conversation_id = $1 order by created_at desc limit 1",
    [conversation.id],
  );
  assert.equal(afterReopen.rows[0].ended_at, null, "reabrir a conversa abre uma nova entrada de tempo");
  assert.equal(afterReopen.rows[0].phase_id, emAtendimento.id, "reabre na MESMA fase de antes, nunca reseta pra fase padrão");

  const serviceTime = await getConversationsServiceTime(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, conversationIds: [conversation.id] });
  assert.equal(serviceTime[0].isRunning, true);
});

test("FASE_REORDER: substituição total, duas passadas nunca violam a constraint única de order_index", async () => {
  const tenantId = "tenant-kanban-4";
  const { workspace, deps, teamKanbanPhaseRepository } = await makeSetup(tenantId);
  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  const phases = await listKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  const [novos, emAtendimento, aguardando] = phases;

  // Inverte a ordem — o caso clássico que quebraria numa passada só (a fase que pega o índice 0
  // já estava ocupado por outra que ainda não foi movida).
  const reordered = await reorderKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, phaseIds: [aguardando.id, emAtendimento.id, novos.id] });
  assert.deepEqual(reordered.map((phase) => phase.id), [aguardando.id, emAtendimento.id, novos.id]);
  assert.deepEqual(reordered.map((phase) => phase.orderIndex), [0, 1, 2]);

  await assert.rejects(
    reorderKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, phaseIds: [novos.id, emAtendimento.id] }),
    /KANBAN_REORDER_MISMATCH/,
  );
});

test("MOVER_CARD: fecha a entrada aberta e abre uma nova; snapshot de phaseType; conversa fora da equipe é rejeitada", async () => {
  const tenantId = "tenant-kanban-5";
  const { workspace, connectionRepo, deps, conversationRepo } = await makeSetup(tenantId);
  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  const phases = await listKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  const [novos, emAtendimento, aguardando] = phases;

  const conversation = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.kanban-move-1");
  await assert.rejects(
    moveConversationPhase(deps, { teamId: team.id, conversationId: conversation.id, tenantId, workspaceId: workspace.id, phaseId: novos.id, performedBy: "user-1" }),
    /KANBAN_CONVERSATION_NOT_IN_TEAM/,
    "conversa sem currentTeamId igual à equipe do quadro nunca pode ser movida",
  );

  await conversationRepo.setTeam(conversation.id, team.id);
  const moved = await moveConversationPhase(deps, { teamId: team.id, conversationId: conversation.id, tenantId, workspaceId: workspace.id, phaseId: emAtendimento.id, performedBy: "user-1" });
  assert.equal(moved.currentPhaseId, emAtendimento.id);

  const openEntries1 = await db.pool.query("select * from conversation_time_entries where conversation_id = $1 and ended_at is null", [conversation.id]);
  assert.equal(openEntries1.rows.length, 1);
  assert.equal(openEntries1.rows[0].phase_id, emAtendimento.id);
  assert.equal(openEntries1.rows[0].phase_type, "RUNNING");

  await moveConversationPhase(deps, { teamId: team.id, conversationId: conversation.id, tenantId, workspaceId: workspace.id, phaseId: aguardando.id, performedBy: "user-1" });
  const allEntries = await db.pool.query("select * from conversation_time_entries where conversation_id = $1 order by started_at asc", [conversation.id]);
  assert.equal(allEntries.rows.length, 2, "a entrada de Em atendimento foi FECHADA, uma nova de Aguardando retorno foi aberta");
  assert.ok(allEntries.rows[0].ended_at, "a primeira entrada tem ended_at preenchido");
  assert.ok(allEntries.rows[0].duration_seconds !== null);
  assert.equal(allEntries.rows[1].ended_at, null, "só a mais recente continua aberta");
  assert.equal(allEntries.rows[1].phase_type, "PAUSED", "snapshot do phaseType da fase Aguardando retorno");

  const openEntries2 = await db.pool.query("select count(*)::int as count from conversation_time_entries where conversation_id = $1 and ended_at is null", [conversation.id]);
  assert.equal(openEntries2.rows[0].count, 1, "invariante: no máximo UMA entrada aberta por conversa+equipe, sempre");
});

test("MOVER_CARD_CONCORRENCIA: duas chamadas simultâneas pro MESMO card nunca deixam duas entradas abertas (lock real)", async () => {
  const tenantId = "tenant-kanban-6";
  const { workspace, connectionRepo, deps, conversationRepo } = await makeSetup(tenantId);
  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  const phases = await listKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  const [novos, emAtendimento, aguardando] = phases;

  const conversation = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.kanban-race-1");
  await conversationRepo.setTeam(conversation.id, team.id);
  await moveConversationPhase(deps, { teamId: team.id, conversationId: conversation.id, tenantId, workspaceId: workspace.id, phaseId: novos.id, performedBy: "user-1" });

  await Promise.all([
    moveConversationPhase(deps, { teamId: team.id, conversationId: conversation.id, tenantId, workspaceId: workspace.id, phaseId: emAtendimento.id, performedBy: "user-a" }),
    moveConversationPhase(deps, { teamId: team.id, conversationId: conversation.id, tenantId, workspaceId: workspace.id, phaseId: aguardando.id, performedBy: "user-b" }),
  ]);

  const openEntries = await db.pool.query("select count(*)::int as count from conversation_time_entries where conversation_id = $1 and ended_at is null", [conversation.id]);
  assert.equal(openEntries.rows[0].count, 1, "mesmo sob concorrência real, nunca mais de uma entrada aberta");

  const allEntries = await db.pool.query("select count(*)::int as count from conversation_time_entries where conversation_id = $1", [conversation.id]);
  assert.equal(allEntries.rows[0].count, 3, "3 entradas no total: Novos (fechada) + as duas tentativas concorrentes, uma fechada e uma aberta — nenhuma perdida, nenhuma duplicada");
});

test("ENSURE_PHASE_STATES: conversa recém-roteada (sem currentPhaseId) ganha a fase padrão e uma entrada de tempo aberta; idempotente", async () => {
  const tenantId = "tenant-kanban-7";
  const { workspace, connectionRepo, deps, conversationRepo } = await makeSetup(tenantId);
  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  const phases = await listKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  const novos = phases.find((phase) => phase.isDefaultFirst);

  const conversation = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.kanban-ensure-1");
  await conversationRepo.setTeam(conversation.id, team.id);
  assert.equal((await conversationRepo.getById(conversation.id)).currentPhaseId, undefined, "pré-condição: roteada pra equipe, mas sem fase ainda");

  await ensureConversationPhaseStates(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, conversationIds: [conversation.id] });
  const afterEnsure = await conversationRepo.getById(conversation.id);
  assert.equal(afterEnsure.currentPhaseId, novos.id);

  const openEntries = await db.pool.query("select count(*)::int as count from conversation_time_entries where conversation_id = $1 and ended_at is null", [conversation.id]);
  assert.equal(openEntries.rows[0].count, 1);

  // Rodar de novo é idempotente — nunca duplica a entrada nem muda a fase de quem já tem uma.
  await ensureConversationPhaseStates(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, conversationIds: [conversation.id] });
  const totalEntries = await db.pool.query("select count(*)::int as count from conversation_time_entries where conversation_id = $1", [conversation.id]);
  assert.equal(totalEntries.rows[0].count, 1);
});

test("SERVICE_TIME: RUNNING soma tempo fechado + isRunning true; PAUSED nunca soma, isRunning false", async () => {
  const tenantId = "tenant-kanban-8";
  const { workspace, connectionRepo, deps, conversationRepo } = await makeSetup(tenantId);
  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  const phases = await listKanbanPhases(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  const [novos, emAtendimento, aguardando] = phases;

  const running = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.kanban-service-1");
  await conversationRepo.setTeam(running.id, team.id);
  await moveConversationPhase(deps, { teamId: team.id, conversationId: running.id, tenantId, workspaceId: workspace.id, phaseId: novos.id, performedBy: "user-1" });
  await moveConversationPhase(deps, { teamId: team.id, conversationId: running.id, tenantId, workspaceId: workspace.id, phaseId: emAtendimento.id, performedBy: "user-1" });

  const paused = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.kanban-service-2");
  await conversationRepo.setTeam(paused.id, team.id);
  await moveConversationPhase(deps, { teamId: team.id, conversationId: paused.id, tenantId, workspaceId: workspace.id, phaseId: novos.id, performedBy: "user-1" });
  await moveConversationPhase(deps, { teamId: team.id, conversationId: paused.id, tenantId, workspaceId: workspace.id, phaseId: aguardando.id, performedBy: "user-1" });

  const serviceTime = await getConversationsServiceTime(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, conversationIds: [running.id, paused.id] });
  const runningTime = serviceTime.find((entry) => entry.conversationId === running.id);
  const pausedTime = serviceTime.find((entry) => entry.conversationId === paused.id);

  assert.equal(runningTime.isRunning, true, "fase atual é RUNNING (Em atendimento)");
  assert.ok(runningTime.currentPhaseStartedAt);
  assert.equal(pausedTime.isRunning, false, "fase atual é PAUSED (Aguardando retorno) — nunca 'rodando', mesmo com entrada aberta");
  assert.ok(pausedTime.totalSeconds >= 0, "totalSeconds nunca inclui a entrada ABERTA — só fechadas RUNNING, somadas à parte pelo frontend");
});

test("PIN: fixar/desafixar grava pinnedAt coerente, sem exigir equipe/fase nenhuma", async () => {
  const tenantId = "tenant-kanban-9";
  const { workspace, connectionRepo, deps } = await makeSetup(tenantId);
  const conversation = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.kanban-pin-1");
  assert.equal(conversation.isPinned, false);

  const pinned = await setConversationPinned(deps, { conversationId: conversation.id, tenantId, workspaceId: workspace.id, pinned: true });
  assert.equal(pinned.isPinned, true);
  assert.ok(pinned.pinnedAt);

  const unpinned = await setConversationPinned(deps, { conversationId: conversation.id, tenantId, workspaceId: workspace.id, pinned: false });
  assert.equal(unpinned.isPinned, false);
  assert.equal(unpinned.pinnedAt, undefined, "desafixar sempre limpa pinnedAt, nunca deixa uma data presa");
});

test("KANBAN_NAO_CONFIGURADO: deps sem teamKanbanPhaseRepository/conversationTimeEntryRepository nunca lançam erro genérico — erro de domínio claro", async () => {
  const tenantId = "tenant-kanban-10";
  const { workspace, connectionRepo, teamRepository, teamMembershipRepository } = await makeSetup(tenantId);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const depsWithoutKanban = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, teamRepository, teamMembershipRepository };
  const team = await createTeam(depsWithoutKanban, { tenantId, workspaceId: workspace.id, name: "Suporte" });

  await assert.rejects(
    listKanbanPhases(depsWithoutKanban, { teamId: team.id, tenantId, workspaceId: workspace.id }),
    /INBOX_KANBAN_NOT_CONFIGURED/,
  );
});

test("ATRIBUICAO_MANUAL_DE_EQUIPE: setConversationTeam coloca uma conversa existente numa equipe (achado de suporte: sem isto o Kanban ficava vazio pra sempre sem roteamento por canal configurado)", async () => {
  const tenantId = "tenant-kanban-11";
  const { workspace, connectionRepo, deps, conversationRepo } = await makeSetup(tenantId);
  const teamA = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  const teamB = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Vendas" });

  const conversation = await makeConversation(tenantId, workspace, connectionRepo, deps, "wamid.kanban-manual-team-1");
  assert.equal(conversation.currentTeamId, undefined, "conversa nasce sem equipe (sem roteamento por canal configurado)");

  const assigned = await setConversationTeam(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, teamId: teamA.id, performedBy: "supervisor-1" });
  assert.equal(assigned.currentTeamId, teamA.id, "agora a conversa aparece no board da equipe A");

  // Board da equipe A: ensureConversationPhaseStates + moveConversationPhase precisam funcionar
  // normalmente numa conversa que só ganhou a equipe manualmente (nunca via roteamento).
  await ensureConversationPhaseStates(deps, { teamId: teamA.id, tenantId, workspaceId: workspace.id, conversationIds: [conversation.id] });
  const afterEnsure = await conversationRepo.getById(conversation.id);
  assert.ok(afterEnsure.currentPhaseId, "ganhou a fase padrão da equipe A");
  const phasesA = await listKanbanPhases(deps, { teamId: teamA.id, tenantId, workspaceId: workspace.id });
  await moveConversationPhase(deps, { teamId: teamA.id, conversationId: conversation.id, tenantId, workspaceId: workspace.id, phaseId: phasesA[1].id, performedBy: "agente-1" });

  // Reatribuir pra equipe B: a fase antiga (da equipe A) não pode sobreviver — senão o board da
  // equipe B quebraria (moveConversationPhase valida que a fase pertence à equipe atual).
  const reassigned = await setConversationTeam(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, teamId: teamB.id, performedBy: "supervisor-1" });
  assert.equal(reassigned.currentTeamId, teamB.id);
  assert.equal(reassigned.currentPhaseId, undefined, "trocar de equipe limpa a fase da equipe anterior");

  const entriesAfterReassign = await db.pool.query(
    "select ended_at from conversation_time_entries where conversation_id = $1 and team_id = $2 order by created_at desc limit 1",
    [conversation.id, teamA.id],
  );
  assert.notEqual(entriesAfterReassign.rows[0].ended_at, null, "cronômetro da equipe antiga foi fechado, nunca fica aberto pra sempre");

  // Tirar de qualquer equipe (teamId: undefined) — some do Kanban de novo.
  const removed = await setConversationTeam(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, teamId: undefined, performedBy: "supervisor-1" });
  assert.equal(removed.currentTeamId, undefined);

  // Mesma equipe de novo é no-op (nunca duplica trabalho/fecha cronômetro à toa).
  const noop = await setConversationTeam(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, teamId: undefined, performedBy: "supervisor-1" });
  assert.equal(noop.currentTeamId, undefined);

  // Equipe de OUTRO tenant/workspace nunca é aceita.
  await assert.rejects(
    setConversationTeam(deps, { tenantId, workspaceId: workspace.id, conversationId: conversation.id, teamId: "team-inexistente", performedBy: "supervisor-1" }),
    /TEAM_NOT_FOUND/,
  );
});
