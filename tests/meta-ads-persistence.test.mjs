import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMetaAdsCredentialRepository } from "../dist/infrastructure/storage/postgres/postgres-meta-ads-credential-repository.js";
import { PostgresMetaAdAccountRepository } from "../dist/infrastructure/storage/postgres/postgres-meta-ad-account-repository.js";
import { InMemoryMetaAdsCredentialRepository } from "../dist/infrastructure/storage/in-memory-meta-ads-credential-repository.js";
import { InMemoryMetaAdAccountRepository } from "../dist/infrastructure/storage/in-memory-meta-ad-account-repository.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55650 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

test("Migration 0069 aplica sem erro; meta_ad_accounts e as colunas novas de publication_credential_references existem", async () => {
  const status = await db.pool.query("select id from schema_migrations where id = '0069_meta_ads_credentials_accounts'");
  assert.equal(status.rows.length, 1);
  const columns = await db.pool.query("select column_name from information_schema.columns where table_name = 'meta_ad_accounts' order by column_name");
  const names = columns.rows.map((row) => row.column_name);
  for (const expected of ["account_id", "credential_reference_id", "tenant_id", "workspace_id", "is_active", "account_status"]) {
    assert.ok(names.includes(expected), `esperava a coluna ${expected}`);
  }
});

test("PostgresMetaAdsCredentialRepository: upsert por credentialReferenceId nunca duplica linha ao reconectar", async () => {
  const workspace = await makeWorkspace("tenant-mac-1");
  const repo = new PostgresMetaAdsCredentialRepository(db.pool);
  const input = { credentialReferenceId: nextId("cred"), tenantId: "tenant-mac-1", workspaceId: workspace.id, providerId: "meta_ads", status: "active", environment: "production", providerSubjectId: "meta-user-1", scopes: ["ads_management", "ads_read"] };

  const first = await repo.upsertCredentialReference(input);
  const second = await repo.upsertCredentialReference({ ...input, scopes: ["ads_management", "ads_read", "business_management"] });

  assert.equal(first.credentialReferenceId, second.credentialReferenceId);
  const all = await repo.listCredentialReferencesByWorkspace({ tenantId: "tenant-mac-1", workspaceId: workspace.id });
  assert.equal(all.length, 1, "reconectar nunca deveria criar uma segunda linha");
  assert.deepEqual(all[0].scopes, ["ads_management", "ads_read", "business_management"]);
});

test("PostgresMetaAdsCredentialRepository: listCredentialReferencesByWorkspace nunca vaza credencial de outro workspace", async () => {
  const workspaceA = await makeWorkspace("tenant-mac-2");
  const workspaceB = await makeWorkspace("tenant-mac-2");
  const repo = new PostgresMetaAdsCredentialRepository(db.pool);
  await repo.upsertCredentialReference({ credentialReferenceId: nextId("cred"), tenantId: "tenant-mac-2", workspaceId: workspaceA.id, providerId: "meta_ads", status: "active" });
  await repo.upsertCredentialReference({ credentialReferenceId: nextId("cred"), tenantId: "tenant-mac-2", workspaceId: workspaceB.id, providerId: "meta_ads", status: "active" });

  const onlyA = await repo.listCredentialReferencesByWorkspace({ tenantId: "tenant-mac-2", workspaceId: workspaceA.id });
  assert.equal(onlyA.length, 1);
  assert.equal(onlyA[0].workspaceId, workspaceA.id);
});

test("PostgresMetaAdsCredentialRepository: updateStatus('revoked') marca revokedAt automaticamente", async () => {
  const workspace = await makeWorkspace("tenant-mac-3");
  const repo = new PostgresMetaAdsCredentialRepository(db.pool);
  const credentialReferenceId = nextId("cred");
  await repo.upsertCredentialReference({ credentialReferenceId, tenantId: "tenant-mac-3", workspaceId: workspace.id, providerId: "meta_ads", status: "active" });

  await repo.updateStatus(credentialReferenceId, "revoked");
  const reference = await repo.getCredentialReference(credentialReferenceId);
  assert.equal(reference.status, "revoked");
  assert.ok(reference.revokedAt);
});

test("meta_ad_accounts: FK pra publication_credential_references — inserir com credential_reference_id inexistente falha (nunca aceita órfão)", async () => {
  const workspace = await makeWorkspace("tenant-maa-1");
  const repo = new PostgresMetaAdAccountRepository(db.pool);
  await assert.rejects(() =>
    repo.upsertAccount({ tenantId: "tenant-maa-1", workspaceId: workspace.id, credentialReferenceId: "nao-existe", accountId: "act_1", name: "Conta", currency: "BRL", isActive: true }),
  );
});

test("PostgresMetaAdAccountRepository: upsert por (workspaceId, credentialReferenceId, accountId) nunca duplica ao resincronizar", async () => {
  const workspace = await makeWorkspace("tenant-maa-2");
  const credentialRepo = new PostgresMetaAdsCredentialRepository(db.pool);
  const credentialReferenceId = nextId("cred");
  await credentialRepo.upsertCredentialReference({ credentialReferenceId, tenantId: "tenant-maa-2", workspaceId: workspace.id, providerId: "meta_ads", status: "active" });

  const repo = new PostgresMetaAdAccountRepository(db.pool);
  const base = { tenantId: "tenant-maa-2", workspaceId: workspace.id, credentialReferenceId, accountId: "act_555", currency: "BRL", isActive: true };
  await repo.upsertAccount({ ...base, name: "Conta Original" });
  await repo.upsertAccount({ ...base, name: "Conta Renomeada" });

  const accounts = await repo.listByWorkspace({ tenantId: "tenant-maa-2", workspaceId: workspace.id });
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].name, "Conta Renomeada");
});

test("PostgresMetaAdAccountRepository: deactivateMissing desativa contas fora de keepAccountIds, mas nunca deleta a linha", async () => {
  const workspace = await makeWorkspace("tenant-maa-3");
  const credentialRepo = new PostgresMetaAdsCredentialRepository(db.pool);
  const credentialReferenceId = nextId("cred");
  await credentialRepo.upsertCredentialReference({ credentialReferenceId, tenantId: "tenant-maa-3", workspaceId: workspace.id, providerId: "meta_ads", status: "active" });

  const repo = new PostgresMetaAdAccountRepository(db.pool);
  await repo.upsertAccount({ tenantId: "tenant-maa-3", workspaceId: workspace.id, credentialReferenceId, accountId: "act_1", name: "A", currency: "BRL", isActive: true });
  await repo.upsertAccount({ tenantId: "tenant-maa-3", workspaceId: workspace.id, credentialReferenceId, accountId: "act_2", name: "B", currency: "BRL", isActive: true });

  await repo.deactivateMissing({ credentialReferenceId, keepAccountIds: ["act_1"] });

  const accounts = await repo.listByWorkspace({ tenantId: "tenant-maa-3", workspaceId: workspace.id });
  assert.equal(accounts.length, 2, "deactivateMissing nunca deleta, só desativa");
  assert.equal(accounts.find((account) => account.accountId === "act_1").isActive, true);
  assert.equal(accounts.find((account) => account.accountId === "act_2").isActive, false);
});

test("Paridade InMemory/Postgres: mesmo fluxo de upsert+list produz o mesmo resultado observável nos dois repositórios", async () => {
  const workspace = await makeWorkspace("tenant-parity-1");
  const pgCredentialRepo = new PostgresMetaAdsCredentialRepository(db.pool);
  const memCredentialRepo = new InMemoryMetaAdsCredentialRepository();
  const credentialReferenceId = nextId("cred");
  const input = { credentialReferenceId, tenantId: "tenant-parity-1", workspaceId: workspace.id, providerId: "meta_ads", status: "active", providerSubjectId: "meta-user-x", scopes: ["ads_read"] };

  await pgCredentialRepo.upsertCredentialReference(input);
  await memCredentialRepo.upsertCredentialReference(input);

  const [pgReference] = await pgCredentialRepo.listCredentialReferencesByWorkspace({ tenantId: "tenant-parity-1", workspaceId: workspace.id });
  const [memReference] = await memCredentialRepo.listCredentialReferencesByWorkspace({ tenantId: "tenant-parity-1", workspaceId: workspace.id });
  assert.equal(pgReference.status, memReference.status);
  assert.equal(pgReference.providerSubjectId, memReference.providerSubjectId);
  assert.deepEqual(pgReference.scopes, memReference.scopes);

  const pgAccountRepo = new PostgresMetaAdAccountRepository(db.pool);
  const memAccountRepo = new InMemoryMetaAdAccountRepository();
  const accountInput = { tenantId: "tenant-parity-1", workspaceId: workspace.id, credentialReferenceId, accountId: "act_9", name: "Conta", currency: "BRL", isActive: true };
  await pgAccountRepo.upsertAccount(accountInput);
  await memAccountRepo.upsertAccount(accountInput);

  const [pgAccount] = await pgAccountRepo.listByWorkspace({ tenantId: "tenant-parity-1", workspaceId: workspace.id });
  const [memAccount] = await memAccountRepo.listByWorkspace({ tenantId: "tenant-parity-1", workspaceId: workspace.id });
  assert.equal(pgAccount.accountId, memAccount.accountId);
  assert.equal(pgAccount.name, memAccount.name);
  assert.equal(pgAccount.isActive, memAccount.isActive);
});
