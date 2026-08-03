import test from "node:test";
import assert from "node:assert/strict";

import { InMemoryWorkspaceRepository } from "../dist/infrastructure/storage/in-memory-workspace-repository.js";
import {
  activateWorkspace,
  archiveWorkspace,
  createWorkspace,
  deactivateWorkspace,
  getWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "../dist/application/workspace/index.js";

function makeDeps() {
  return { workspaceRepository: new InMemoryWorkspaceRepository() };
}

// ---------------------------------------------------------------------------------------------
// Fluxos válidos
// ---------------------------------------------------------------------------------------------

test("createWorkspace: fluxo válido cria com status active", async () => {
  const deps = makeDeps();
  const workspace = await createWorkspace(deps, { tenantId: "tenant-1", name: "Rumo ao Altar" });
  assert.equal(workspace.tenantId, "tenant-1");
  assert.equal(workspace.status, "active");
});

test("listWorkspaces/getWorkspace: fluxo válido", async () => {
  const deps = makeDeps();
  const created = await createWorkspace(deps, { tenantId: "tenant-1", name: "X" });

  const listed = await listWorkspaces(deps, { tenantId: "tenant-1" });
  assert.equal(listed.length, 1);

  const fetched = await getWorkspace(deps, { tenantId: "tenant-1", id: created.id });
  assert.deepEqual(fetched, created);
});

test("updateWorkspace: fluxo válido altera nome e settings", async () => {
  const deps = makeDeps();
  const created = await createWorkspace(deps, { tenantId: "tenant-1", name: "Nome Original" });
  const updated = await updateWorkspace(deps, { tenantId: "tenant-1", id: created.id, name: "Nome Novo" });
  assert.equal(updated.name, "Nome Novo");
});

test("activateWorkspace/deactivateWorkspace/archiveWorkspace: fluxo válido completo", async () => {
  const deps = makeDeps();
  const created = await createWorkspace(deps, { tenantId: "tenant-1", name: "X" });

  const deactivated = await deactivateWorkspace(deps, { tenantId: "tenant-1", id: created.id });
  assert.equal(deactivated.status, "inactive");

  const activated = await activateWorkspace(deps, { tenantId: "tenant-1", id: created.id });
  assert.equal(activated.status, "active");

  const archived = await archiveWorkspace(deps, { tenantId: "tenant-1", id: created.id });
  assert.equal(archived.status, "archived");
});

// ---------------------------------------------------------------------------------------------
// Validação de entrada
// ---------------------------------------------------------------------------------------------

test("createWorkspace: name vazio é rejeitado", async () => {
  const deps = makeDeps();
  await assert.rejects(() => createWorkspace(deps, { tenantId: "tenant-1", name: "   " }), /WORKSPACE_VALIDATION_ERROR/);
});

test("updateWorkspace: name vazio é rejeitado", async () => {
  const deps = makeDeps();
  const created = await createWorkspace(deps, { tenantId: "tenant-1", name: "X" });
  await assert.rejects(() => updateWorkspace(deps, { tenantId: "tenant-1", id: created.id, name: "   " }), /WORKSPACE_VALIDATION_ERROR/);
});

// ---------------------------------------------------------------------------------------------
// Transições inválidas
// ---------------------------------------------------------------------------------------------

test("activateWorkspace: falha quando o workspace já está active", async () => {
  const deps = makeDeps();
  const created = await createWorkspace(deps, { tenantId: "tenant-1", name: "X" });
  await assert.rejects(() => activateWorkspace(deps, { tenantId: "tenant-1", id: created.id }), /WORKSPACE_INVALID_TRANSITION/);
});

test("deactivateWorkspace: falha quando o workspace já está inactive", async () => {
  const deps = makeDeps();
  const created = await createWorkspace(deps, { tenantId: "tenant-1", name: "X" });
  await deactivateWorkspace(deps, { tenantId: "tenant-1", id: created.id });
  await assert.rejects(() => deactivateWorkspace(deps, { tenantId: "tenant-1", id: created.id }), /WORKSPACE_INVALID_TRANSITION/);
});

test("activateWorkspace/deactivateWorkspace: falham quando o workspace está archived (terminal)", async () => {
  const deps = makeDeps();
  const created = await createWorkspace(deps, { tenantId: "tenant-1", name: "X" });
  await archiveWorkspace(deps, { tenantId: "tenant-1", id: created.id });
  await assert.rejects(() => activateWorkspace(deps, { tenantId: "tenant-1", id: created.id }), /WORKSPACE_INVALID_TRANSITION/);
  await assert.rejects(() => deactivateWorkspace(deps, { tenantId: "tenant-1", id: created.id }), /WORKSPACE_INVALID_TRANSITION/);
});

test("archiveWorkspace: falha quando o workspace já está archived", async () => {
  const deps = makeDeps();
  const created = await createWorkspace(deps, { tenantId: "tenant-1", name: "X" });
  await archiveWorkspace(deps, { tenantId: "tenant-1", id: created.id });
  await assert.rejects(() => archiveWorkspace(deps, { tenantId: "tenant-1", id: created.id }), /WORKSPACE_INVALID_TRANSITION/);
});

// ---------------------------------------------------------------------------------------------
// Workspace inexistente
// ---------------------------------------------------------------------------------------------

test("getWorkspace/updateWorkspace/activateWorkspace: workspace inexistente lança WORKSPACE_NOT_FOUND", async () => {
  const deps = makeDeps();
  await assert.rejects(() => getWorkspace(deps, { tenantId: "tenant-1", id: "nao-existe" }), /WORKSPACE_NOT_FOUND/);
  await assert.rejects(() => updateWorkspace(deps, { tenantId: "tenant-1", id: "nao-existe", name: "x" }), /WORKSPACE_NOT_FOUND/);
  await assert.rejects(() => activateWorkspace(deps, { tenantId: "tenant-1", id: "nao-existe" }), /WORKSPACE_NOT_FOUND/);
});

// ---------------------------------------------------------------------------------------------
// Tentativa de acesso cross-tenant
// ---------------------------------------------------------------------------------------------

test("getWorkspace: tenant B não consegue ler workspace do tenant A (WORKSPACE_NOT_FOUND, não 403)", async () => {
  const deps = makeDeps();
  const created = await createWorkspace(deps, { tenantId: "tenant-a", name: "Segredo do A" });
  await assert.rejects(() => getWorkspace(deps, { tenantId: "tenant-b", id: created.id }), /WORKSPACE_NOT_FOUND/);
});

test("updateWorkspace/activateWorkspace/archiveWorkspace: tenant B não consegue mutar workspace do tenant A", async () => {
  const deps = makeDeps();
  const created = await createWorkspace(deps, { tenantId: "tenant-a", name: "Segredo do A" });
  await assert.rejects(() => updateWorkspace(deps, { tenantId: "tenant-b", id: created.id, name: "hackeado" }), /WORKSPACE_NOT_FOUND/);
  await assert.rejects(() => archiveWorkspace(deps, { tenantId: "tenant-b", id: created.id }), /WORKSPACE_NOT_FOUND/);

  const stillIntact = await getWorkspace(deps, { tenantId: "tenant-a", id: created.id });
  assert.equal(stillIntact.name, "Segredo do A");
  assert.equal(stillIntact.status, "active");
});

test("listWorkspaces: nunca vaza workspaces de outro tenant", async () => {
  const deps = makeDeps();
  await createWorkspace(deps, { tenantId: "tenant-a", name: "A1" });
  await createWorkspace(deps, { tenantId: "tenant-b", name: "B1" });

  const listA = await listWorkspaces(deps, { tenantId: "tenant-a" });
  assert.equal(listA.length, 1);
  assert.equal(listA[0].name, "A1");
});

// ---------------------------------------------------------------------------------------------
// Limite de Workspaces por plano (Sprint 25+)
// ---------------------------------------------------------------------------------------------

function fakeBillingRepository(rows) {
  return { async getTenantBilling(tenantId) { return rows[tenantId]; } };
}

test("createWorkspace: sem platformBillingRepository, criação permanece ilimitada (compat)", async () => {
  const deps = makeDeps();
  await createWorkspace(deps, { tenantId: "tenant-1", name: "A" });
  await createWorkspace(deps, { tenantId: "tenant-1", name: "B" });
  const listed = await listWorkspaces(deps, { tenantId: "tenant-1" });
  assert.equal(listed.length, 2);
});

test("createWorkspace: plano FREE bloqueia o segundo workspace", async () => {
  const deps = { ...makeDeps(), platformBillingRepository: fakeBillingRepository({ "tenant-1": { planCode: "FREE" } }) };
  await createWorkspace(deps, { tenantId: "tenant-1", name: "Único" });
  await assert.rejects(() => createWorkspace(deps, { tenantId: "tenant-1", name: "Segundo" }), /WORKSPACE_LIMIT_EXCEEDED/);
});

test("createWorkspace: plano pago (maxWorkspaces null) permanece ilimitado", async () => {
  const deps = { ...makeDeps(), platformBillingRepository: fakeBillingRepository({ "tenant-1": { planCode: "PRO" } }) };
  await createWorkspace(deps, { tenantId: "tenant-1", name: "A" });
  await createWorkspace(deps, { tenantId: "tenant-1", name: "B" });
  await createWorkspace(deps, { tenantId: "tenant-1", name: "C" });
  const listed = await listWorkspaces(deps, { tenantId: "tenant-1" });
  assert.equal(listed.length, 3);
});

test("createWorkspace: workspace arquivado não conta contra o limite do FREE", async () => {
  const deps = { ...makeDeps(), platformBillingRepository: fakeBillingRepository({ "tenant-1": { planCode: "FREE" } }) };
  const first = await createWorkspace(deps, { tenantId: "tenant-1", name: "Único" });
  await archiveWorkspace(deps, { tenantId: "tenant-1", id: first.id });
  const second = await createWorkspace(deps, { tenantId: "tenant-1", name: "Substituto" });
  assert.equal(second.name, "Substituto");
});

test("createWorkspace: tenant sem linha de billing ainda (ex.: provisionado fora do signup público) não é limitado", async () => {
  const deps = { ...makeDeps(), platformBillingRepository: fakeBillingRepository({}) };
  await createWorkspace(deps, { tenantId: "tenant-sem-billing", name: "A" });
  await createWorkspace(deps, { tenantId: "tenant-sem-billing", name: "B" });
  const listed = await listWorkspaces(deps, { tenantId: "tenant-sem-billing" });
  assert.equal(listed.length, 2);
});
