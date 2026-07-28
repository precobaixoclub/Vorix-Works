import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresAssetLibraryRepository } from "../dist/infrastructure/storage/postgres/postgres-asset-library-repository.js";
import { PostgresChatRepository } from "../dist/infrastructure/storage/postgres/postgres-chat-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55410 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

// ---------------------------------------------------------------------------------------------
// PostgresWorkspaceRepository
// ---------------------------------------------------------------------------------------------

test("Postgres Workspace: create() + getById() round trip com status active e listas vazias", async () => {
  const repo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const created = await repo.create({ tenantId: "tenant-pg-1", name: "Rumo ao Altar" });
  assert.equal(created.status, "active");
  assert.deepEqual(created.members, []);
  assert.deepEqual(created.integrations, []);
  assert.deepEqual(created.campaignIds, []);
  assert.ok(created.createdAt);

  const fetched = await repo.getById(created.id);
  assert.deepEqual(fetched, created);
});

test("Postgres Workspace: listByTenant() isola workspaces entre tenants diferentes", async () => {
  const repo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  await repo.create({ tenantId: "tenant-pg-iso-a", name: "Cliente A" });
  await repo.create({ tenantId: "tenant-pg-iso-a", name: "Cliente B" });
  await repo.create({ tenantId: "tenant-pg-iso-b", name: "Cliente C" });

  const tenantA = await repo.listByTenant("tenant-pg-iso-a");
  const tenantB = await repo.listByTenant("tenant-pg-iso-b");
  assert.equal(tenantA.length, 2);
  assert.equal(tenantB.length, 1);
  assert.ok(tenantA.every((w) => w.tenantId === "tenant-pg-iso-a"));
});

test("Postgres Workspace: listByTenant() com filtro de status", async () => {
  const repo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const w1 = await repo.create({ tenantId: "tenant-pg-status", name: "Ativo" });
  const w2 = await repo.create({ tenantId: "tenant-pg-status", name: "Vai inativar" });
  await repo.deactivate(w2.id);

  const onlyActive = await repo.listByTenant("tenant-pg-status", { status: "active" });
  const onlyInactive = await repo.listByTenant("tenant-pg-status", { status: "inactive" });
  assert.deepEqual(onlyActive.map((w) => w.id), [w1.id]);
  assert.deepEqual(onlyInactive.map((w) => w.id), [w2.id]);
});

test("Postgres Workspace: update() altera só os campos informados e bate updatedAt", async () => {
  const repo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const created = await repo.create({ tenantId: "tenant-pg-2", name: "Nome Original" });
  const updated = await repo.update(created.id, { name: "Nome Novo", settings: { timezone: "America/Sao_Paulo" } });
  assert.equal(updated.name, "Nome Novo");
  assert.equal(updated.settings.timezone, "America/Sao_Paulo");
  assert.notEqual(updated.updatedAt, created.updatedAt);
});

test("Postgres Workspace: activate()/deactivate()/archive() mutam status incondicionalmente", async () => {
  const repo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const created = await repo.create({ tenantId: "tenant-pg-3", name: "Transições" });

  const deactivated = await repo.deactivate(created.id);
  assert.equal(deactivated.status, "inactive");

  const activated = await repo.activate(created.id);
  assert.equal(activated.status, "active");

  const archived = await repo.archive(created.id);
  assert.equal(archived.status, "archived");
  assert.ok(archived.archivedAt);
});

test("Postgres Workspace: update()/activate()/archive() em id inexistente lança WORKSPACE_NOT_FOUND", async () => {
  const repo = new PostgresWorkspaceRepository(db.pool);
  await assert.rejects(() => repo.update("nao-existe-pg", { name: "x" }), /WORKSPACE_NOT_FOUND/);
  await assert.rejects(() => repo.activate("nao-existe-pg"), /WORKSPACE_NOT_FOUND/);
  await assert.rejects(() => repo.archive("nao-existe-pg"), /WORKSPACE_NOT_FOUND/);
});

test("Postgres Workspace: reconstrói members e integrations no agregado (dados inseridos direto no banco)", async () => {
  const repo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const created = await repo.create({ tenantId: "tenant-pg-4", name: "Com filhos" });

  await db.pool.query(
    "insert into workspace_members (workspace_id, user_id, role, added_at) values ($1, 'user-1', 'owner', now())",
    [created.id],
  );
  await db.pool.query(
    `insert into workspace_integrations (id, workspace_id, channel, status, created_at, updated_at)
     values ('integration-1', $1, 'instagram', 'pending', now(), now())`,
    [created.id],
  );

  const fetched = await repo.getById(created.id);
  assert.equal(fetched.members.length, 1);
  assert.equal(fetched.members[0].userId, "user-1");
  assert.equal(fetched.integrations.length, 1);
  assert.equal(fetched.integrations[0].channel, "instagram");
});

test("Postgres Workspace: apagar o workspace faz cascata em members/integrations/asset_libraries/chat_sessions", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const assetRepo = new PostgresAssetLibraryRepository(db.pool, { idGenerator: (p) => nextId(p) });
  const chatRepo = new PostgresChatRepository(db.pool, { idGenerator: (p) => nextId(p) });

  const workspace = await workspaceRepo.create({ tenantId: "tenant-pg-cascade", name: "Vai sumir" });
  await db.pool.query("insert into workspace_members (workspace_id, user_id, role, added_at) values ($1, 'user-x', 'owner', now())", [
    workspace.id,
  ]);
  await assetRepo.createLibrary({ workspaceId: workspace.id });
  await chatRepo.createSession({ workspaceId: workspace.id });

  await db.pool.query("delete from workspaces where id = $1", [workspace.id]);

  const membersLeft = await db.pool.query("select 1 from workspace_members where workspace_id = $1", [workspace.id]);
  const librariesLeft = await db.pool.query("select 1 from asset_libraries where workspace_id = $1", [workspace.id]);
  const sessionsLeft = await db.pool.query("select 1 from chat_sessions where workspace_id = $1", [workspace.id]);
  assert.equal(membersLeft.rows.length, 0);
  assert.equal(librariesLeft.rows.length, 0);
  assert.equal(sessionsLeft.rows.length, 0);
});

// ---------------------------------------------------------------------------------------------
// PostgresAssetLibraryRepository
// ---------------------------------------------------------------------------------------------

test("Postgres Asset Library: createLibrary() + segunda tentativa no mesmo workspace falha", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const assetRepo = new PostgresAssetLibraryRepository(db.pool, { idGenerator: (p) => nextId(p) });
  const workspace = await workspaceRepo.create({ tenantId: "tenant-pg-asset", name: "Com library" });

  const library = await assetRepo.createLibrary({ workspaceId: workspace.id });
  assert.equal(library.workspaceId, workspace.id);
  await assert.rejects(() => assetRepo.createLibrary({ workspaceId: workspace.id }), /ASSET_LIBRARY_ALREADY_EXISTS/);
});

test("Postgres Asset Library: registerAsset() exige library existente", async () => {
  const assetRepo = new PostgresAssetLibraryRepository(db.pool, { idGenerator: (p) => nextId(p) });
  await assert.rejects(
    () => assetRepo.registerAsset({ libraryId: "nao-existe-pg", kind: "logo", name: "logo.png" }),
    /ASSET_LIBRARY_NOT_FOUND/,
  );
});

test("Postgres Asset Library: registerAsset()/listAssets() com filtro por kind e archiveAsset()", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const assetRepo = new PostgresAssetLibraryRepository(db.pool, { idGenerator: (p) => nextId(p) });
  const workspace = await workspaceRepo.create({ tenantId: "tenant-pg-asset-2", name: "Ativos" });
  const library = await assetRepo.createLibrary({ workspaceId: workspace.id });

  await assetRepo.registerAsset({ libraryId: library.id, kind: "logo", name: "logo.png", tags: ["marca"] });
  const font = await assetRepo.registerAsset({ libraryId: library.id, kind: "font", name: "fonte.ttf" });

  const all = await assetRepo.listAssets(library.id);
  assert.equal(all.length, 2);
  const onlyLogos = await assetRepo.listAssets(library.id, { kind: "logo" });
  assert.equal(onlyLogos.length, 1);
  assert.deepEqual(onlyLogos[0].tags, ["marca"]);

  const archived = await assetRepo.archiveAsset(font.id);
  assert.equal(archived.status, "archived");
  assert.ok(archived.archivedAt);
});

test("Postgres Asset Library: apagar a library faz cascata nos assets", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const assetRepo = new PostgresAssetLibraryRepository(db.pool, { idGenerator: (p) => nextId(p) });
  const workspace = await workspaceRepo.create({ tenantId: "tenant-pg-asset-3", name: "Cascata" });
  const library = await assetRepo.createLibrary({ workspaceId: workspace.id });
  const asset = await assetRepo.registerAsset({ libraryId: library.id, kind: "mockup", name: "mockup.png" });

  await db.pool.query("delete from asset_libraries where id = $1", [library.id]);

  const assetLeft = await db.pool.query("select 1 from assets where id = $1", [asset.id]);
  assert.equal(assetLeft.rows.length, 0);
});

// ---------------------------------------------------------------------------------------------
// PostgresChatRepository
// ---------------------------------------------------------------------------------------------

test("Postgres Chat: createSession() + appendMessage() com anexos e smartQuestion, reconstrução completa", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const chatRepo = new PostgresChatRepository(db.pool, { idGenerator: (p) => nextId(p) });
  const workspace = await workspaceRepo.create({ tenantId: "tenant-pg-chat", name: "Com chat" });

  const session = await chatRepo.createSession({ workspaceId: workspace.id, title: "Nova campanha" });
  assert.equal(session.status, "active");

  await chatRepo.appendMessage({ sessionId: session.id, role: "user", content: "Quero criar uma campanha" });
  const assistantMessage = await chatRepo.appendMessage({
    sessionId: session.id,
    role: "assistant",
    content: "Preciso de mais contexto.",
    smartQuestion: { question: "Qual o público-alvo?", reason: "Sem público definido.", sourceStepId: "step-0002" },
    attachments: [{ id: nextId("chat-attachment"), kind: "image", name: "referencia.png" }],
  });

  assert.equal(assistantMessage.smartQuestion.question, "Qual o público-alvo?");
  assert.equal(assistantMessage.attachments.length, 1);
  assert.equal(assistantMessage.attachments[0].kind, "image");

  const messages = await chatRepo.listMessages(session.id);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(messages[1].attachments.length, 1);

  const updatedSession = await chatRepo.getSession(session.id);
  assert.notEqual(updatedSession.updatedAt, session.updatedAt);
});

test("Postgres Chat: appendMessage() exige sessão existente", async () => {
  const chatRepo = new PostgresChatRepository(db.pool, { idGenerator: (p) => nextId(p) });
  await assert.rejects(() => chatRepo.appendMessage({ sessionId: "nao-existe-pg", role: "user", content: "oi" }), /CHAT_SESSION_NOT_FOUND/);
});

test("Postgres Chat: listSessionsByWorkspace() só retorna sessões do workspace pedido", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const chatRepo = new PostgresChatRepository(db.pool, { idGenerator: (p) => nextId(p) });
  const workspaceA = await workspaceRepo.create({ tenantId: "tenant-pg-chat-2", name: "A" });
  const workspaceB = await workspaceRepo.create({ tenantId: "tenant-pg-chat-2", name: "B" });
  await chatRepo.createSession({ workspaceId: workspaceA.id });
  await chatRepo.createSession({ workspaceId: workspaceB.id });

  const sessionsA = await chatRepo.listSessionsByWorkspace(workspaceA.id);
  assert.equal(sessionsA.length, 1);
  assert.equal(sessionsA[0].workspaceId, workspaceA.id);
});

test("Postgres Chat: apagar a sessão faz cascata nas mensagens e anexos", async () => {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  const chatRepo = new PostgresChatRepository(db.pool, { idGenerator: (p) => nextId(p) });
  const workspace = await workspaceRepo.create({ tenantId: "tenant-pg-chat-3", name: "Cascata chat" });
  const session = await chatRepo.createSession({ workspaceId: workspace.id });
  const message = await chatRepo.appendMessage({
    sessionId: session.id,
    role: "user",
    content: "oi",
    attachments: [{ id: nextId("chat-attachment"), kind: "document", name: "brief.pdf" }],
  });

  await db.pool.query("delete from chat_sessions where id = $1", [session.id]);

  const messageLeft = await db.pool.query("select 1 from chat_messages where id = $1", [message.id]);
  const attachmentLeft = await db.pool.query("select 1 from chat_message_attachments where message_id = $1", [message.id]);
  assert.equal(messageLeft.rows.length, 0);
  assert.equal(attachmentLeft.rows.length, 0);
});
