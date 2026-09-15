import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresTeamRepository, PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { PostgresChannelRoutingRepository } from "../dist/infrastructure/storage/postgres/postgres-channel-routing-repository.js";
import { addTeamMember, createTeam, removeTeamMember, resolveNextTeamMember, updateTeam, updateTeamMember } from "../dist/application/identity/team-use-cases.js";
import { registerInboundMessage } from "../dist/application/inbox/inbox-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Bloco "roteamento por equipe" (réplica adaptada do CMDesk `getNextAgentByRoleta`/
 * `ChannelRoutingConfig`, pedido explícito do usuário: "Implemente o seguinte relatório... tela de
 * conversas, equipe, canais") — cobre round-robin de agentes por nível, gestão automática de
 * "principal do nível", round-robin de equipes por canal, e o fio inteiro conectado em
 * `registerInboundMessage` (conversa nova ganha equipe+agente automaticamente).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
before(async () => {
  db = await startTestPostgres({ port: 55714 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

test("ROUND_ROBIN_AGENTE: gira circularmente entre membros elegíveis do nível, ignora quem não participa, e cada nível tem ponteiro independente", async () => {
  const tenantId = "tenant-team-routing-1";
  const workspace = await makeWorkspace(tenantId);
  const teamRepository = new PostgresTeamRepository(db.pool);
  const teamMembershipRepository = new PostgresTeamMembershipRepository(db.pool);
  const deps = { teamRepository, teamMembershipRepository };

  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-a", role: "editor", attendanceLevel: "N1" });
  await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-b", role: "editor", attendanceLevel: "N1" });
  await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-c", role: "editor", attendanceLevel: "N1", participatesInRoundRobin: false });
  // Nível diferente — nunca interfere no rodízio do N1.
  await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-n2", role: "editor", attendanceLevel: "N2" });

  const picks = [];
  for (let i = 0; i < 5; i += 1) {
    const result = await resolveNextTeamMember(deps, { teamId: team.id, level: "N1" });
    picks.push(result.userId);
    assert.equal(result.usedRoundRobin, true);
  }
  // user-c nunca participa — só a e b giram, em ordem, repetindo o ciclo.
  assert.deepEqual(picks, ["user-a", "user-b", "user-a", "user-b", "user-a"]);

  const n2Result = await resolveNextTeamMember(deps, { teamId: team.id, level: "N2" });
  assert.equal(n2Result.userId, "user-n2", "nível N2 nunca é afetado pelo ponteiro do N1");
});

test("ROUND_ROBIN_AGENTE: roundRobinEnabled=false sempre devolve o principal, nunca avança o ponteiro", async () => {
  const tenantId = "tenant-team-routing-2";
  const workspace = await makeWorkspace(tenantId);
  const teamRepository = new PostgresTeamRepository(db.pool);
  const teamMembershipRepository = new PostgresTeamMembershipRepository(db.pool);
  const deps = { teamRepository, teamMembershipRepository };

  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Comercial" });
  await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-a", role: "editor" });
  await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-b", role: "editor" });
  await updateTeam(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, roundRobinEnabled: false });

  const first = await resolveNextTeamMember(deps, { teamId: team.id, level: "N1" });
  const second = await resolveNextTeamMember(deps, { teamId: team.id, level: "N1" });
  assert.equal(first.userId, "user-a", "primeiro membro do nível é sempre o principal automático");
  assert.equal(second.userId, "user-a", "nunca gira — sempre o mesmo principal");
  assert.equal(first.usedRoundRobin, false);
});

test("ROUND_ROBIN_AGENTE: ninguém participando do rodízio cai pro principal, sem avançar ponteiro", async () => {
  const tenantId = "tenant-team-routing-3";
  const workspace = await makeWorkspace(tenantId);
  const teamRepository = new PostgresTeamRepository(db.pool);
  const teamMembershipRepository = new PostgresTeamMembershipRepository(db.pool);
  const deps = { teamRepository, teamMembershipRepository };

  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Financeiro" });
  await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-a", role: "editor", participatesInRoundRobin: false });
  await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-b", role: "editor", participatesInRoundRobin: false });

  const result = await resolveNextTeamMember(deps, { teamId: team.id, level: "N1" });
  assert.equal(result.userId, "user-a", "principal automático (primeiro membro) — ninguém participa do rodízio");
  assert.equal(result.usedRoundRobin, false);
});

test("PRINCIPAL_DO_NIVEL: primeiro membro do nível vira principal automaticamente; setPrincipal desmarca o anterior; remover o principal promove substituto", async () => {
  const tenantId = "tenant-team-routing-4";
  const workspace = await makeWorkspace(tenantId);
  const teamRepository = new PostgresTeamRepository(db.pool);
  const teamMembershipRepository = new PostgresTeamMembershipRepository(db.pool);
  const deps = { teamRepository, teamMembershipRepository };

  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  const first = await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-a", role: "editor" });
  assert.equal(first.isPrincipalForLevel, true, "primeiro membro do nível é sempre principal");

  const second = await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-b", role: "editor" });
  assert.equal(second.isPrincipalForLevel, false, "segundo membro NUNCA vira principal automaticamente");

  const promoted = await updateTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-b", setPrincipal: true });
  assert.equal(promoted.isPrincipalForLevel, true);
  const members = await teamMembershipRepository.listByTeam(team.id);
  const oldPrincipal = members.find((member) => member.userId === "user-a");
  assert.equal(oldPrincipal.isPrincipalForLevel, false, "marcar um novo principal desmarca o anterior do MESMO nível");

  await removeTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-b" });
  const afterRemoval = await teamMembershipRepository.listByTeam(team.id);
  assert.equal(afterRemoval.length, 1);
  assert.equal(afterRemoval[0].isPrincipalForLevel, true, "remover o principal promove o membro restante — nível nunca fica sem principal enquanto tiver gente");
});

test("PRINCIPAL_DO_NIVEL: mudar de nível some do nível antigo (promove substituto lá) e vira principal automático do nível novo se for o primeiro", async () => {
  const tenantId = "tenant-team-routing-5";
  const workspace = await makeWorkspace(tenantId);
  const teamRepository = new PostgresTeamRepository(db.pool);
  const teamMembershipRepository = new PostgresTeamMembershipRepository(db.pool);
  const deps = { teamRepository, teamMembershipRepository };

  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-a", role: "editor", attendanceLevel: "N1" });
  await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-b", role: "editor", attendanceLevel: "N1" });

  const moved = await updateTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-b", attendanceLevel: "N2" });
  assert.equal(moved.attendanceLevel, "N2");
  assert.equal(moved.isPrincipalForLevel, true, "primeiro membro do N2 (recém-criado pela mudança) vira principal");

  const members = await teamMembershipRepository.listByTeam(team.id);
  const remainingN1 = members.find((member) => member.userId === "user-a");
  assert.equal(remainingN1.isPrincipalForLevel, true, "N1 nunca fica sem principal — user-a já era o único, segue principal");
});

test("CHANNEL_ROUTING: distribuição DEFAULT sempre devolve a mesma equipe; ROUND_ROBIN gira entre as equipes vinculadas", async () => {
  const tenantId = "tenant-team-routing-6";
  const workspace = await makeWorkspace(tenantId);
  const teamRepository = new PostgresTeamRepository(db.pool);
  const teamMembershipRepository = new PostgresTeamMembershipRepository(db.pool);
  const channelRoutingRepository = new PostgresChannelRoutingRepository(db.pool);
  const deps = { teamRepository, teamMembershipRepository };
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);

  const teamA = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Equipe A" });
  const teamB = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Equipe B" });
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Canal" });

  await channelRoutingRepository.replaceLinkedTeams(connection.id, [teamA.id, teamB.id]);
  await channelRoutingRepository.upsertRoutingConfig({ connectionId: connection.id, defaultTeamId: teamA.id, distributionMode: "default" });

  const defaultPicks = await Promise.all([1, 2, 3].map(() => channelRoutingRepository.resolveTeamForNewConversation(connection.id)));
  assert.deepEqual(defaultPicks, [teamA.id, teamA.id, teamA.id], "DEFAULT sempre a mesma equipe, nunca gira");

  await channelRoutingRepository.upsertRoutingConfig({ connectionId: connection.id, defaultTeamId: teamA.id, distributionMode: "round_robin" });
  const rrPicks = [];
  for (let i = 0; i < 4; i += 1) rrPicks.push(await channelRoutingRepository.resolveTeamForNewConversation(connection.id));
  assert.deepEqual(rrPicks, [teamA.id, teamB.id, teamA.id, teamB.id], "ROUND_ROBIN gira entre as equipes vinculadas, em ordem de vínculo");
});

test("CHANNEL_ROUTING: replaceLinkedTeams é substituição TOTAL — remove quem não está na nova lista", async () => {
  const tenantId = "tenant-team-routing-7";
  const workspace = await makeWorkspace(tenantId);
  const teamRepository = new PostgresTeamRepository(db.pool);
  const teamMembershipRepository = new PostgresTeamMembershipRepository(db.pool);
  const channelRoutingRepository = new PostgresChannelRoutingRepository(db.pool);
  const deps = { teamRepository, teamMembershipRepository };
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);

  const teamA = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Equipe A" });
  const teamB = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Equipe B" });
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Canal" });

  await channelRoutingRepository.replaceLinkedTeams(connection.id, [teamA.id, teamB.id]);
  assert.deepEqual((await channelRoutingRepository.listTeamIdsByConnection(connection.id)).sort(), [teamA.id, teamB.id].sort());

  await channelRoutingRepository.replaceLinkedTeams(connection.id, [teamB.id]);
  assert.deepEqual(await channelRoutingRepository.listTeamIdsByConnection(connection.id), [teamB.id]);
});

test("INTEGRACAO: conversa NOVA num canal roteado ganha currentTeamId + assignedUserId automaticamente (round-robin de equipe + round-robin de agente encadeados)", async () => {
  const tenantId = "tenant-team-routing-8";
  const workspace = await makeWorkspace(tenantId);
  const teamRepository = new PostgresTeamRepository(db.pool);
  const teamMembershipRepository = new PostgresTeamMembershipRepository(db.pool);
  const channelRoutingRepository = new PostgresChannelRoutingRepository(db.pool);
  const teamDeps = { teamRepository, teamMembershipRepository };
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);

  const team = await createTeam(teamDeps, { tenantId, workspaceId: workspace.id, name: "Suporte" });
  await addTeamMember(teamDeps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-agent-1", role: "editor" });
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Canal" });
  await channelRoutingRepository.replaceLinkedTeams(connection.id, [team.id]);
  await channelRoutingRepository.upsertRoutingConfig({ connectionId: connection.id, defaultTeamId: team.id, distributionMode: "default" });

  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo, teamRepository, teamMembershipRepository, channelRoutingRepository };

  const registered = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511977778888", isGroup: false, fromMe: false,
    senderId: "+5511977778888", senderName: "Cliente",
    externalMessageId: "wamid.routing-1", type: "text", body: "Oi, preciso de ajuda", occurredAt: new Date().toISOString(),
  });

  assert.equal(registered.conversation.currentTeamId, team.id);
  assert.equal(registered.conversation.assignedUserId, "user-agent-1");

  // 2ª mensagem na MESMA conversa nunca reavalia o roteamento — mesmo se a equipe ganhasse um
  // segundo agente depois, a conversa já roteada fica com quem pegou.
  await addTeamMember(teamDeps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-agent-2", role: "editor" });
  const second = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511977778888", isGroup: false, fromMe: false,
    senderId: "+5511977778888", senderName: "Cliente",
    externalMessageId: "wamid.routing-2", type: "text", body: "Alguém aí?", occurredAt: new Date().toISOString(),
  });
  assert.equal(second.conversation.assignedUserId, "user-agent-1", "conversa já roteada nunca é reatribuída por uma mensagem seguinte");
});

test("INTEGRACAO: canal sem roteamento configurado (sem channelRoutingRepository nos deps) nunca lança — conversa fica sem equipe, comportamento anterior preservado", async () => {
  const tenantId = "tenant-team-routing-9";
  const workspace = await makeWorkspace(tenantId);
  const connectionRepo = new PostgresMessagingConnectionRepository(db.pool);
  const contactRepo = new PostgresInboxContactRepository(db.pool);
  const conversationRepo = new PostgresInboxConversationRepository(db.pool);
  const messageRepo = new PostgresInboxMessageRepository(db.pool);
  const connection = await connectionRepo.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "Canal" });
  const deps = { contactRepository: contactRepo, conversationRepository: conversationRepo, messageRepository: messageRepo };

  const registered = await registerInboundMessage(deps, {
    tenantId, workspaceId: workspace.id, connectionId: connection.id,
    chatId: "+5511966665555", isGroup: false, fromMe: false,
    senderId: "+5511966665555", senderName: "Cliente",
    externalMessageId: "wamid.routing-3", type: "text", body: "Oi", occurredAt: new Date().toISOString(),
  });

  assert.equal(registered.conversation.currentTeamId, undefined);
  assert.equal(registered.conversation.assignedUserId, undefined);
});
