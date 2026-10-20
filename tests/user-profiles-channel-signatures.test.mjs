import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import Fastify from "fastify";
import sharp from "sharp";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresTenantMemberInviteRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-member-invite-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMessagingConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-messaging-connection-repository.js";
import { InMemoryMessagingConnectionRepository } from "../dist/infrastructure/storage/in-memory-messaging-connection-repository.js";
import { PostgresInboxMessageRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-message-repository.js";
import { PostgresInboxConversationRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-conversation-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { BcryptPasswordHasher } from "../dist/infrastructure/auth/bcrypt-password-hasher.js";
import { registerTenantMembersRoutes } from "../dist/interfaces/api/routes/v1/tenant-members.route.js";
import { registerInboxRoutes } from "../dist/interfaces/api/routes/v1/inbox.route.js";
import { registerErrorHandler } from "../dist/interfaces/api/http/error-handler.js";
import { registerInboundMessage, sendInboxMessage, sendInboxMediaMessage, listConversationMessages, processOutboundMessage, updateConnectionSettings } from "../dist/application/inbox/inbox-use-cases.js";

let db, identity, photo;
const tenantId = "tenant-profiles";
let sequence = 0;
const password = "Senha-inicial-123";
before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, join(process.cwd(), "db", "migrations"));
  identity = {
    userRepository: new PostgresUserRepository(db.pool),
    membershipRepository: new PostgresTenantMembershipRepository(db.pool),
    tenantMemberInviteRepository: new PostgresTenantMemberInviteRepository(db.pool),
    passwordHasher: new BcryptPasswordHasher(),
  };
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#aabbcc" } }).png().toBuffer();
  photo = `data:image/png;base64,${bytes.toString("base64")}`;
});
after(async () => { await db?.stop(); });

async function appFor(t, options = {}, inboxDeps) {
  const app = Fastify();
  registerErrorHandler(app);
  app.decorateRequest("zunoContext", null);
  app.addHook("onRequest", async (request) => {
    request.zunoContext = { principal: { userId: options.userId ?? "manager", tenantId: options.tenantId ?? tenantId, role: options.role ?? "owner", sessionId: "session", isPlatformAdmin: false } };
  });
  await registerTenantMembersRoutes(app, { ...identity, assertCanAddMember: options.assertCanAddMember });
  if (inboxDeps) await registerInboxRoutes(app, { ...identity, ...inboxDeps, maxUploadBytes: 2 * 1024 * 1024 });
  t.after(() => app.close());
  return app;
}

async function createMember(app, overrides = {}) {
  const payload = { name: "Maria Silva", email: `maria-${++sequence}@empresa.com`, password, role: "editor", avatarUrl: photo, ...overrides };
  const response = await app.inject({ method: "POST", url: "/tenant-members", payload });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().data;
}

test("cadastro HTTP salva nome, e-mail, foto reprocessada e senha utilizável; respostas não expõem credenciais", async (t) => {
  const app = await appFor(t);
  const member = await createMember(app, { name: "  Maria Silva  " });
  assert.equal(member.name, "Maria Silva");
  assert.equal(member.role, "editor");
  assert.match(member.avatarUrl, /^data:image\/webp;base64,/);
  assert.equal(member.passwordHash, undefined);
  assert.equal(member.password, undefined);
  const user = await identity.userRepository.getById(member.userId);
  assert.notEqual(user.passwordHash, password);
  assert.equal(await identity.passwordHasher.verify(password, user.passwordHash), true);
  assert.ok(await identity.membershipRepository.getByUserAndTenant(member.userId, tenantId));
  const listing = await app.inject({ method: "GET", url: "/tenant-members" });
  const listed = listing.json().data.find((item) => item.userId === user.id);
  assert.equal(listed.name, member.name);
  assert.equal(listed.email, member.email);
  assert.equal(listed.avatarUrl, member.avatarUrl);
  assert.equal(listed.passwordHash, undefined);
});

test("editar perfil preserva senha e papel; foto pode ser mantida ou removida", async (t) => {
  const app = await appFor(t);
  const member = await createMember(app);
  const original = await identity.userRepository.getById(member.userId);
  const url = `/tenant-members/${member.userId}/profile`;
  const response = await app.inject({ method: "PATCH", url, payload: { name: "Maria Oliveira", email: `novo-${++sequence}@empresa.com` } });
  assert.equal(response.statusCode, 200, response.body);
  const changed = await identity.userRepository.getById(member.userId);
  assert.equal(changed.name, "Maria Oliveira");
  assert.equal(changed.avatarUrl, original.avatarUrl);
  assert.equal(changed.passwordHash, original.passwordHash);
  assert.equal(response.json().data.role, member.role);
  const removed = await app.inject({ method: "PATCH", url, payload: { name: changed.name, email: changed.email, avatarUrl: null } });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal((await identity.userRepository.getById(member.userId)).avatarUrl, undefined);
});

test("cadastro rejeita duplicidade, perfil inválido e arquivo sem imagem, sem criar contas incompletas", async (t) => {
  const app = await appFor(t);
  const member = await createMember(app);
  const duplicate = await app.inject({ method: "POST", url: "/tenant-members", payload: { name: "Outra pessoa", email: member.email, password, role: "editor" } });
  assert.equal(duplicate.statusCode, 400);
  for (const override of [{ name: " " }, { email: "invalido" }, { password: "curta" }, { avatarUrl: "https://externo/foto.png" }, { avatarUrl: "data:image/png;base64,YWJj" }]) {
    const email = `invalido-${++sequence}@empresa.com`;
    const result = await app.inject({ method: "POST", url: "/tenant-members", payload: { name: "Teste", email, password, role: "editor", ...override } });
    assert.equal(result.statusCode, 400, result.body);
    assert.equal(await identity.userRepository.getByEmail(email), undefined);
  }
});

test("cadastro de usuário respeita a capacidade contratada antes de criar credenciais", async (t) => {
  const app = await appFor(t, { assertCanAddMember: async () => { throw new Error("USAGE_LIMIT_REACHED: users"); } });
  const email = `sem-capacidade-${++sequence}@empresa.com`;
  const result = await app.inject({ method: "POST", url: "/tenant-members", payload: { name: "Novo usuário", email, password, role: "editor" } });
  assert.equal(result.statusCode, 409, result.body);
  assert.match(result.json().error.message, /Plano e cobrança/);
  assert.equal(await identity.userRepository.getByEmail(email), undefined);
});

test("perfis respeitam papel administrativo e isolamento de tenant, inclusive usuários compartilhados", async (t) => {
  const app = await appFor(t);
  const member = await createMember(app);
  const editorApp = await appFor(t, { role: "editor" });
  assert.equal((await editorApp.inject({ method: "POST", url: "/tenant-members", payload: { name: "X", email: "x@empresa.com", password, role: "editor" } })).statusCode, 403);
  const otherApp = await appFor(t, { tenantId: "other-tenant" });
  const payload = { name: "Nome indevido", email: member.email };
  assert.equal((await otherApp.inject({ method: "PATCH", url: `/tenant-members/${member.userId}/profile`, payload })).statusCode, 404);
  await identity.membershipRepository.create({ userId: member.userId, tenantId: "shared-tenant", role: "editor" });
  assert.equal((await app.inject({ method: "PATCH", url: `/tenant-members/${member.userId}/profile`, payload })).statusCode, 400);
  const ownApp = await appFor(t, { userId: member.userId });
  assert.equal((await ownApp.inject({ method: "PATCH", url: `/tenant-members/${member.userId}/profile`, payload: { ...payload, name: "Meu nome" } })).statusCode, 200);
});

async function inboxSetup() {
  const workspaceRepository = new PostgresWorkspaceRepository(db.pool);
  const workspace = await workspaceRepository.create({ tenantId, name: "Atendimento" });
  const sent = [];
  const provider = {
    providerId: "wuzapi", capabilities: {},
    async sendText(input) { sent.push({ kind: "text", ...input }); return { externalMessageId: `out-${sent.length}` }; },
    async sendImage(input) { sent.push({ kind: "image", ...input }); return { externalMessageId: `out-${sent.length}` }; },
    async sendVideo(input) { sent.push({ kind: "video", ...input }); return { externalMessageId: `out-${sent.length}` }; },
  };
  const media = new Map();
  const deps = {
    ...identity, workspaceRepository,
    connectionRepository: new PostgresMessagingConnectionRepository(db.pool),
    contactRepository: new PostgresInboxContactRepository(db.pool),
    conversationRepository: new PostgresInboxConversationRepository(db.pool),
    messageRepository: new PostgresInboxMessageRepository(db.pool),
    outboundQueue: { async publish() {} }, providers: { wuzapi: provider },
    inboxMediaStorage: { async put(input) { media.set(input.key, { body: input.body, contentType: input.contentType }); }, async get(key) { return media.get(key); } },
  };
  const connection = await deps.connectionRepository.create({ tenantId, workspaceId: workspace.id, provider: "wuzapi", displayName: "WhatsApp" });
  await deps.connectionRepository.updateStatus(connection.id, { status: "connected", externalSessionId: "session" });
  const { conversation } = await registerInboundMessage(deps, { tenantId, workspaceId: workspace.id, connectionId: connection.id, chatId: "+5511999998888", isGroup: false, fromMe: false, senderId: "+5511999998888", externalMessageId: "inbound", type: "text", body: "Olá", occurredAt: new Date().toISOString() });
  const user = await identity.userRepository.create({ name: "Maria Silva", email: `agent-${++sequence}@empresa.com`, passwordHash: "unused", avatarUrl: photo });
  const input = { tenantId, workspaceId: workspace.id, conversationId: conversation.id, sentByUserId: user.id, body: "Olá, cliente!" };
  return { deps, input, connection, conversation, sent, user };
}

test("nome interno é o autor real; assinatura só sai com a opção do canal ligada e não modifica histórico", async () => {
  const { deps, input, connection, conversation, sent, user } = await inboxSetup();
  assert.equal(connection.sendAgentName, false);
  const first = await sendInboxMessage(deps, input);
  assert.equal(first.senderDisplayName, "Maria Silva");
  await processOutboundMessage(deps, { messageId: first.id });
  assert.equal(sent[0].body, input.body);
  const second = await sendInboxMessage(deps, input);
  await updateConnectionSettings(deps, { ...input, connectionId: connection.id, sendAgentName: true });
  await deps.conversationRepository.assign(conversation.id, "outro-atendente");
  await processOutboundMessage(deps, { messageId: second.id });
  assert.equal(sent[1].body, "*Maria Silva*\nOlá, cliente!");
  assert.equal((await deps.messageRepository.getById(second.id)).body, input.body);
  const again = await processOutboundMessage(deps, { messageId: second.id });
  assert.equal(again.id, second.id);
  assert.equal(sent.length, 2, "reentrega não repete assinatura nem mensagem");
  const old = await deps.messageRepository.create({ tenantId, workspaceId: input.workspaceId, conversationId: conversation.id, connectionId: connection.id, direction: "outbound", type: "text", body: "Antiga", sentByUserId: user.id });
  const history = await listConversationMessages(deps, input);
  assert.equal(history.find((message) => message.id === old.message.id).senderDisplayName, user.name);
  assert.equal(history.find((message) => message.id === first.id).metadata.senderAvatarUrl, user.avatarUrl);
});

test("IA e automações não recebem nome humano; legendas de imagens e vídeos seguem a opção do canal", async () => {
  const { deps, input, connection, sent } = await inboxSetup();
  await updateConnectionSettings(deps, { ...input, connectionId: connection.id, sendAgentName: true });
  for (const flag of ["sentByAi", "sentByAutomation"]) {
    const message = await sendInboxMessage(deps, { ...input, [flag]: true });
    await processOutboundMessage(deps, { messageId: message.id });
    assert.equal(sent.at(-1).body, input.body);
  }
  for (const type of ["image", "video"]) {
    const message = await sendInboxMediaMessage(deps, { ...input, type, body: Buffer.from("media-fixture"), mimeType: `${type}/${type === "image" ? "jpeg" : "mp4"}`, caption: "Segue o material" });
    await processOutboundMessage(deps, { messageId: message.id });
    assert.equal(sent.at(-1).caption, "*Maria Silva*\nSegue o material");
    assert.equal((await deps.messageRepository.getById(message.id)).body, "Segue o material");
  }
});

test("configuração de assinatura é persistida por canal e exige permissão e escopo corretos", async (t) => {
  const { deps, input, connection } = await inboxSetup();
  const app = await appFor(t, {}, deps);
  const url = `/inbox/connections/${connection.id}/settings`;
  const payload = { workspaceId: input.workspaceId, sendAgentName: true };
  const response = await app.inject({ method: "PATCH", url, payload });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal((await deps.connectionRepository.getById(connection.id)).sendAgentName, true);
  for (const options of [{ role: "editor" }, { tenantId: "other-tenant" }]) {
    const denied = await appFor(t, options, deps);
    assert.equal((await denied.inject({ method: "PATCH", url, payload })).statusCode, options.role ? 403 : 404);
  }
  assert.equal((await app.inject({ method: "PATCH", url, payload: { ...payload, workspaceId: "other-workspace" } })).statusCode, 404);
  const memory = new InMemoryMessagingConnectionRepository();
  const newConnection = await memory.create({ tenantId, workspaceId: input.workspaceId, provider: "wuzapi", displayName: "Memória" });
  assert.equal(newConnection.sendAgentName, false);
  await memory.updateSettings(newConnection.id, { sendAgentName: true });
  assert.equal((await memory.getById(newConnection.id)).sendAgentName, true);
});
