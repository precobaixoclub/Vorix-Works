import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryWorkspaceRepository } from "../dist/infrastructure/storage/in-memory-workspace-repository.js";
import { InMemoryAssetLibraryRepository } from "../dist/infrastructure/storage/in-memory-asset-library-repository.js";
import { InMemoryChatRepository } from "../dist/infrastructure/storage/in-memory-chat-repository.js";
import { WORKSPACE_STATUSES, WORKSPACE_MEMBER_ROLES } from "../dist/domain/workspace/workspace.model.js";
import { ASSET_KINDS, ASSET_STATUSES } from "../dist/domain/asset-library/asset-library.model.js";
import { CHAT_MESSAGE_ROLES, CHAT_ATTACHMENT_KINDS, CHAT_SESSION_STATUSES } from "../dist/domain/chat/chat.model.js";

// ---------------------------------------------------------------------------------------------
// Vocabulário de domínio (Fases 3/4/5) — confirma que os enums pedidos no briefing existem
// ---------------------------------------------------------------------------------------------

test("Workspace: vocabulário de status e papéis de membro existe conforme pedido", () => {
  assert.deepEqual(WORKSPACE_STATUSES, ["active", "archived"]);
  assert.deepEqual(WORKSPACE_MEMBER_ROLES, ["owner", "admin", "editor", "viewer"]);
});

test("Asset Library: os 10 tipos de ativo pedidos no briefing existem", () => {
  assert.deepEqual(ASSET_KINDS, ["logo", "photo", "video", "product", "mockup", "visual_identity", "font", "brand_book", "reference", "document"]);
  assert.deepEqual(ASSET_STATUSES, ["active", "archived"]);
});

test("Chat: papéis de mensagem e tipos de anexo pedidos no briefing existem", () => {
  assert.deepEqual(CHAT_MESSAGE_ROLES, ["user", "assistant", "system"]);
  assert.deepEqual(CHAT_ATTACHMENT_KINDS, ["image", "video", "document", "audio"]);
  assert.deepEqual(CHAT_SESSION_STATUSES, ["active", "archived"]);
});

// ---------------------------------------------------------------------------------------------
// InMemoryWorkspaceRepository
// ---------------------------------------------------------------------------------------------

function makeWorkspaceRepo() {
  let n = 0;
  return new InMemoryWorkspaceRepository({ idGenerator: () => `workspace-fixed-${++n}`, now: () => new Date("2026-01-01T00:00:00.000Z") });
}

test("Workspace: create() cria com status active e listas vazias", async () => {
  const repo = makeWorkspaceRepo();
  const workspace = await repo.create({ tenantId: "tenant-1", name: "Rumo ao Altar" });
  assert.equal(workspace.tenantId, "tenant-1");
  assert.equal(workspace.name, "Rumo ao Altar");
  assert.equal(workspace.status, "active");
  assert.deepEqual(workspace.campaignIds, []);
  assert.deepEqual(workspace.integrations, []);
  assert.deepEqual(workspace.members, []);
  assert.equal(workspace.createdAt, "2026-01-01T00:00:00.000Z");
});

test("Workspace: um tenant pode ter múltiplos workspaces (agência com vários clientes)", async () => {
  const repo = makeWorkspaceRepo();
  await repo.create({ tenantId: "tenant-agencia", name: "Cliente A" });
  await repo.create({ tenantId: "tenant-agencia", name: "Cliente B" });
  await repo.create({ tenantId: "outro-tenant", name: "Cliente C" });

  const workspaces = await repo.listByTenant("tenant-agencia");
  assert.equal(workspaces.length, 2);
  assert.deepEqual(workspaces.map((w) => w.name).sort(), ["Cliente A", "Cliente B"]);
});

test("Workspace: update() muda apenas os campos informados e atualiza updatedAt", async () => {
  const repo = makeWorkspaceRepo();
  const created = await repo.create({ tenantId: "tenant-1", name: "Nome Original" });
  const updated = await repo.update(created.id, { name: "Nome Novo" });
  assert.equal(updated.name, "Nome Novo");
  assert.equal(updated.tenantId, "tenant-1");
});

test("Workspace: archive() marca status archived e preenche archivedAt", async () => {
  const repo = makeWorkspaceRepo();
  const created = await repo.create({ tenantId: "tenant-1", name: "X" });
  const archived = await repo.archive(created.id);
  assert.equal(archived.status, "archived");
  assert.ok(archived.archivedAt);
});

test("Workspace: update()/archive() em id inexistente lança erro claro", async () => {
  const repo = makeWorkspaceRepo();
  await assert.rejects(() => repo.update("nao-existe", { name: "x" }), /WORKSPACE_NOT_FOUND/);
  await assert.rejects(() => repo.archive("nao-existe"), /WORKSPACE_NOT_FOUND/);
});

test("Workspace: registros retornados são cópias independentes (mutar o retorno não afeta o repositório)", async () => {
  const repo = makeWorkspaceRepo();
  const created = await repo.create({ tenantId: "tenant-1", name: "X" });
  created.name = "Mutado por fora";
  const fetched = await repo.getById(created.id);
  assert.equal(fetched.name, "X");
});

// ---------------------------------------------------------------------------------------------
// InMemoryAssetLibraryRepository
// ---------------------------------------------------------------------------------------------

function makeAssetLibraryRepo() {
  let n = 0;
  return new InMemoryAssetLibraryRepository({ idGenerator: (prefix) => `${prefix}-fixed-${++n}`, now: () => new Date("2026-01-01T00:00:00.000Z") });
}

test("Asset Library: createLibrary() cria uma biblioteca por workspace, uma segunda tentativa falha", async () => {
  const repo = makeAssetLibraryRepo();
  const library = await repo.createLibrary({ workspaceId: "workspace-1" });
  assert.equal(library.workspaceId, "workspace-1");
  await assert.rejects(() => repo.createLibrary({ workspaceId: "workspace-1" }), /ASSET_LIBRARY_ALREADY_EXISTS/);
});

test("Asset Library: registerAsset() exige uma library existente", async () => {
  const repo = makeAssetLibraryRepo();
  await assert.rejects(() => repo.registerAsset({ libraryId: "nao-existe", kind: "logo", name: "logo.png" }), /ASSET_LIBRARY_NOT_FOUND/);
});

test("Asset Library: registerAsset() + listAssets() cobrem os 10 tipos de ativo, com filtro por kind", async () => {
  const repo = makeAssetLibraryRepo();
  const library = await repo.createLibrary({ workspaceId: "workspace-1" });

  for (const kind of ASSET_KINDS) {
    await repo.registerAsset({ libraryId: library.id, kind, name: `${kind}-exemplo` });
  }

  const all = await repo.listAssets(library.id);
  assert.equal(all.length, ASSET_KINDS.length);

  const onlyLogos = await repo.listAssets(library.id, { kind: "logo" });
  assert.equal(onlyLogos.length, 1);
  assert.equal(onlyLogos[0].kind, "logo");
});

test("Asset Library: registerAsset() nunca preenche storageRef (upload é explicitamente fora de escopo)", async () => {
  const repo = makeAssetLibraryRepo();
  const library = await repo.createLibrary({ workspaceId: "workspace-1" });
  const asset = await repo.registerAsset({ libraryId: library.id, kind: "mockup", name: "mockup.png" });
  assert.equal(asset.storageRef, undefined);
});

test("Asset Library: archiveAsset() marca status archived", async () => {
  const repo = makeAssetLibraryRepo();
  const library = await repo.createLibrary({ workspaceId: "workspace-1" });
  const asset = await repo.registerAsset({ libraryId: library.id, kind: "font", name: "fonte.ttf" });
  const archived = await repo.archiveAsset(asset.id);
  assert.equal(archived.status, "archived");
  assert.ok(archived.archivedAt);
});

// ---------------------------------------------------------------------------------------------
// InMemoryChatRepository
// ---------------------------------------------------------------------------------------------

function makeChatRepo() {
  let n = 0;
  return new InMemoryChatRepository({ idGenerator: (prefix) => `${prefix}-fixed-${++n}`, now: () => new Date("2026-01-01T00:00:00.000Z") });
}

test("Chat: createSession() cria sessão ativa vinculada a um workspace", async () => {
  const repo = makeChatRepo();
  const session = await repo.createSession({ workspaceId: "workspace-1", title: "Nova campanha" });
  assert.equal(session.workspaceId, "workspace-1");
  assert.equal(session.status, "active");
  assert.equal(session.title, "Nova campanha");
});

test("Chat: appendMessage() exige uma sessão existente", async () => {
  const repo = makeChatRepo();
  await assert.rejects(() => repo.appendMessage({ sessionId: "nao-existe", role: "user", content: "oi" }), /CHAT_SESSION_NOT_FOUND/);
});

test("Chat: appendMessage()/listMessages() preservam ordem e papéis", async () => {
  const repo = makeChatRepo();
  const session = await repo.createSession({ workspaceId: "workspace-1" });
  await repo.appendMessage({ sessionId: session.id, role: "user", content: "Quero criar uma campanha" });
  await repo.appendMessage({ sessionId: session.id, role: "assistant", content: "Para qual rede social?" });

  const messages = await repo.listMessages(session.id);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant"]);
  assert.deepEqual(messages.map((m) => m.content), ["Quero criar uma campanha", "Para qual rede social?"]);
});

test("Chat: appendMessage() com smartQuestion preserva o formato de pergunta inteligente", async () => {
  const repo = makeChatRepo();
  const session = await repo.createSession({ workspaceId: "workspace-1" });
  const message = await repo.appendMessage({
    sessionId: session.id,
    role: "assistant",
    content: "Preciso de mais contexto.",
    smartQuestion: { question: "Qual o público-alvo?", reason: "Sem público definido, a estratégia fica genérica.", sourceStepId: "step-0002" },
  });
  assert.equal(message.smartQuestion.question, "Qual o público-alvo?");
  assert.equal(message.smartQuestion.sourceStepId, "step-0002");
});

test("Chat: appendMessage() atualiza updatedAt da sessão", async () => {
  const repo = new InMemoryChatRepository({
    idGenerator: (() => {
      let n = 0;
      return (prefix) => `${prefix}-${++n}`;
    })(),
    now: (() => {
      let calls = 0;
      const timestamps = ["2026-01-01T00:00:00.000Z", "2026-01-01T00:05:00.000Z"];
      return () => new Date(timestamps[Math.min(calls++, timestamps.length - 1)]);
    })(),
  });
  const session = await repo.createSession({ workspaceId: "workspace-1" });
  assert.equal(session.updatedAt, "2026-01-01T00:00:00.000Z");
  await repo.appendMessage({ sessionId: session.id, role: "user", content: "oi" });
  const updated = await repo.getSession(session.id);
  assert.equal(updated.updatedAt, "2026-01-01T00:05:00.000Z");
});

test("Chat: listSessionsByWorkspace() só retorna sessões do workspace pedido", async () => {
  const repo = makeChatRepo();
  await repo.createSession({ workspaceId: "workspace-1" });
  await repo.createSession({ workspaceId: "workspace-2" });
  const sessions = await repo.listSessionsByWorkspace("workspace-1");
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].workspaceId, "workspace-1");
});
