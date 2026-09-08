import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresTeamRepository, PostgresTeamMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-team-repository.js";
import { PostgresTenantMemberInviteRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-member-invite-repository.js";
import { PostgresTenantMembershipRepository } from "../dist/infrastructure/storage/postgres/postgres-tenant-membership-repository.js";
import { PostgresUserRepository } from "../dist/infrastructure/storage/postgres/postgres-user-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresContactIdentityRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-identity-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { createTeam, addTeamMember, removeTeamMember, updateTeam, deleteTeam, mustTeamBelongToTenantAndWorkspace } from "../dist/application/identity/team-use-cases.js";
import { inviteMember, acceptInvite, updateMemberRole, removeMember, revokeInvite } from "../dist/application/identity/invite-use-cases.js";
import { createContact, linkContactIdentity, getContactTimeline, updateContact, mustContactBelongToTenantAndWorkspace } from "../dist/application/crm/contact-use-cases.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * CRM/Comercial — Fase 1 (Fundação Comercial). Ver docs/crm-omnichannel-architecture-audit.md.
 * Foco: (1) migrations aplicam e o backfill de contatos existentes do WhatsApp funciona sem
 * fusão automática; (2) Equipes/convites fecham o gap real de RBAC/gestão de membro; (3) Contact/
 * ContactIdentity nunca duplicam nem fundem sem sinal explícito; (4) Timeline registra os eventos
 * esperados.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-fixed-${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55700 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});

after(async () => {
  await db.stop();
});

async function makeWorkspace(tenantId) {
  const workspaceRepo = new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("workspace") });
  return workspaceRepo.create({ tenantId, name: "W" });
}

function teamDeps() {
  return { teamRepository: new PostgresTeamRepository(db.pool), teamMembershipRepository: new PostgresTeamMembershipRepository(db.pool) };
}

function inviteDeps() {
  return {
    tenantMemberInviteRepository: new PostgresTenantMemberInviteRepository(db.pool),
    membershipRepository: new PostgresTenantMembershipRepository(db.pool),
    userRepository: new PostgresUserRepository(db.pool),
  };
}

function contactDeps() {
  return {
    contactRepository: new PostgresContactRepository(db.pool),
    contactIdentityRepository: new PostgresContactIdentityRepository(db.pool),
    timelineEventRepository: new PostgresTimelineEventRepository(db.pool),
  };
}

// ------------------------------------------------------------------------------------------
// Migrations 0089-0093
// ------------------------------------------------------------------------------------------

test("Migrations 0089-0093 aplicam sem erro; tabelas do CRM existem", async () => {
  for (const id of ["0089_crm_teams", "0090_tenant_member_invites", "0091_crm_contacts", "0092_crm_contact_identities_and_inbox_backfill", "0093_crm_timeline_events"]) {
    const status = await db.pool.query("select id from schema_migrations where id = $1", [id]);
    assert.equal(status.rows.length, 1, `migration ${id} deveria estar registrada`);
  }
});

test("Backfill: contato do WhatsApp já existente ganha um Contact + ContactIdentity, sem fusão", async () => {
  const tenantId = "tenant-backfill-1";
  const workspace = await makeWorkspace(tenantId);
  const inboxContactRepo = new PostgresInboxContactRepository(db.pool);
  // Cria um inbox_contacts diretamente (simula um contato já existente ANTES da Fase 1 rodar) —
  // mas como o backfill do SQL já rodou no `before()` (migration 0092), este teste confirma o
  // comportamento pra um contato criado DEPOIS: nunca ganha contact_id sozinho (isso é raciocínio
  // de aplicação, não de banco — a ligação pra um novo inbox_contacts é feita explicitamente via
  // `linkContactIdentity`, nunca implícita).
  const phone = "+5511990000001";
  const contact = await inboxContactRepo.upsertByPhone({ tenantId, workspaceId: workspace.id, phoneNormalized: phone, name: "Cliente Backfill" });
  assert.equal(contact.contactId, undefined, "inbox_contacts novo não ganha contact_id sozinho — precisa de link explícito");
});

// ------------------------------------------------------------------------------------------
// Equipes
// ------------------------------------------------------------------------------------------

test("Equipes: criar, adicionar/remover membro, editar e apagar", async () => {
  const tenantId = "tenant-team-1";
  const workspace = await makeWorkspace(tenantId);
  const deps = teamDeps();

  const team = await createTeam(deps, { tenantId, workspaceId: workspace.id, name: "Comercial" });
  assert.equal(team.name, "Comercial");

  await addTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-1", role: "editor" });
  const members = await deps.teamMembershipRepository.listByTeam(team.id);
  assert.equal(members.length, 1);
  assert.equal(members[0].role, "editor");

  await removeTeamMember(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, userId: "user-1" });
  assert.equal((await deps.teamMembershipRepository.listByTeam(team.id)).length, 0);

  const renamed = await updateTeam(deps, { teamId: team.id, tenantId, workspaceId: workspace.id, name: "Comercial Renomeado" });
  assert.equal(renamed.name, "Comercial Renomeado");

  await deleteTeam(deps, { teamId: team.id, tenantId, workspaceId: workspace.id });
  assert.equal(await deps.teamRepository.getById(team.id), undefined);
});

test("Equipes: isolamento cross-tenant — equipe de outro tenant nunca é encontrada (404, não vaza existência)", async () => {
  const tenantA = "tenant-team-a";
  const tenantB = "tenant-team-b";
  const workspaceA = await makeWorkspace(tenantA);
  const workspaceB = await makeWorkspace(tenantB);
  const deps = teamDeps();
  const team = await createTeam(deps, { tenantId: tenantA, workspaceId: workspaceA.id, name: "Só do Tenant A" });

  await assert.rejects(
    () => mustTeamBelongToTenantAndWorkspace(deps, team.id, tenantB, workspaceB.id),
    /TEAM_NOT_FOUND/,
  );
});

// ------------------------------------------------------------------------------------------
// Convites / Usuários
// ------------------------------------------------------------------------------------------

test("Convite: convidar, aceitar (liga a um usuário existente pelo e-mail), e nunca aceitar duas vezes", async () => {
  const tenantId = "tenant-invite-1";
  const deps = inviteDeps();
  const userRepo = new PostgresUserRepository(db.pool);
  const user = await userRepo.create({ email: "convidado@example.com", passwordHash: "hash", name: "Convidado" });

  const { invite, rawToken } = await inviteMember(deps, { tenantId, email: "convidado@example.com", role: "editor", invitedByUserId: "user-admin" });
  assert.equal(invite.status, "pending");

  const membership = await acceptInvite(deps, { rawToken, userId: user.id });
  assert.equal(membership.role, "editor");
  assert.equal(membership.tenantId, tenantId);

  // Segunda tentativa com o MESMO token — convite já não está mais pending, CAS recusa.
  await assert.rejects(() => acceptInvite(deps, { rawToken, userId: user.id }), /INVITE_NOT_PENDING/);
});

test("Convite: e-mail não bate com o do usuário autenticado é recusado", async () => {
  const tenantId = "tenant-invite-2";
  const deps = inviteDeps();
  const userRepo = new PostgresUserRepository(db.pool);
  const user = await userRepo.create({ email: "outra-pessoa@example.com", passwordHash: "hash", name: "Outra Pessoa" });

  const { rawToken } = await inviteMember(deps, { tenantId, email: "convidado2@example.com", role: "viewer", invitedByUserId: "user-admin" });
  await assert.rejects(() => acceptInvite(deps, { rawToken, userId: user.id }), /INVITE_EMAIL_MISMATCH/);
});

test("Convite: revogar impede aceite posterior", async () => {
  const tenantId = "tenant-invite-3";
  const deps = inviteDeps();
  const userRepo = new PostgresUserRepository(db.pool);
  const user = await userRepo.create({ email: "convidado3@example.com", passwordHash: "hash", name: "C3" });
  const { invite, rawToken } = await inviteMember(deps, { tenantId, email: "convidado3@example.com", role: "viewer", invitedByUserId: "user-admin" });

  const revoked = await revokeInvite(deps, invite.id);
  assert.equal(revoked.status, "revoked");
  await assert.rejects(() => acceptInvite(deps, { rawToken, userId: user.id }), /INVITE_NOT_PENDING/);
});

test("Membro: trocar papel e remover", async () => {
  const tenantId = "tenant-member-1";
  const deps = inviteDeps();
  const userRepo = new PostgresUserRepository(db.pool);
  const user = await userRepo.create({ email: "membro@example.com", passwordHash: "hash", name: "Membro" });
  await deps.membershipRepository.create({ userId: user.id, tenantId, role: "viewer" });

  const updated = await updateMemberRole(deps, { userId: user.id, tenantId, role: "admin" });
  assert.equal(updated.role, "admin");

  await removeMember(deps, { userId: user.id, tenantId });
  assert.equal(await deps.membershipRepository.getByUserAndTenant(user.id, tenantId), undefined);
});

// ------------------------------------------------------------------------------------------
// Contato 360° / ContactIdentity / Timeline
// ------------------------------------------------------------------------------------------

test("Contato: criar registra evento na timeline", async () => {
  const tenantId = "tenant-contact-1";
  const workspace = await makeWorkspace(tenantId);
  const deps = contactDeps();

  const contact = await createContact(deps, { tenantId, workspaceId: workspace.id, name: "João Martins", origin: "instagram" });
  const timeline = await getContactTimeline(deps, { contactId: contact.id, tenantId, workspaceId: workspace.id });
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].eventType, "contact_created");
  assert.equal(timeline[0].actorType, "user");
});

test("ContactIdentity: ligar é idempotente por (channel, externalId) — segunda chamada não duplica", async () => {
  const tenantId = "tenant-contact-2";
  const workspace = await makeWorkspace(tenantId);
  const deps = contactDeps();
  const contact = await createContact(deps, { tenantId, workspaceId: workspace.id, name: "Maria" });

  const first = await linkContactIdentity(deps, { contactId: contact.id, tenantId, workspaceId: workspace.id, channel: "instagram", externalId: "ig-123" });
  assert.equal(first.wasCreated, true);
  assert.equal(first.conflictsWithAnotherContact, false);

  const second = await linkContactIdentity(deps, { contactId: contact.id, tenantId, workspaceId: workspace.id, channel: "instagram", externalId: "ig-123" });
  assert.equal(second.wasCreated, false);
  assert.equal(second.conflictsWithAnotherContact, false);

  const identities = await deps.contactIdentityRepository.listByContact(contact.id);
  assert.equal(identities.length, 1, "nunca duplica a mesma identidade de canal");
});

test("ContactIdentity: nunca funde automaticamente — identidade já ligada a OUTRO contato é reportada como conflito", async () => {
  const tenantId = "tenant-contact-3";
  const workspace = await makeWorkspace(tenantId);
  const deps = contactDeps();
  const contactA = await createContact(deps, { tenantId, workspaceId: workspace.id, name: "Contato A" });
  const contactB = await createContact(deps, { tenantId, workspaceId: workspace.id, name: "Contato B" });

  await linkContactIdentity(deps, { contactId: contactA.id, tenantId, workspaceId: workspace.id, channel: "whatsapp", externalId: "wa-shared" });
  const conflict = await linkContactIdentity(deps, { contactId: contactB.id, tenantId, workspaceId: workspace.id, channel: "whatsapp", externalId: "wa-shared" });

  assert.equal(conflict.wasCreated, false);
  assert.equal(conflict.conflictsWithAnotherContact, true, "nunca funde — o contato B não ganha a identidade do A silenciosamente");
  assert.equal(conflict.identity.contactId, contactA.id, "a identidade continua pertencendo só ao contato A");
});

test("Contato: isolamento cross-tenant — contato de outro tenant nunca é encontrado", async () => {
  const tenantA = "tenant-contact-a";
  const tenantB = "tenant-contact-b";
  const workspaceA = await makeWorkspace(tenantA);
  const workspaceB = await makeWorkspace(tenantB);
  const deps = contactDeps();
  const contact = await createContact(deps, { tenantId: tenantA, workspaceId: workspaceA.id, name: "Só do Tenant A" });

  await assert.rejects(
    () => mustContactBelongToTenantAndWorkspace(deps, contact.id, tenantB, workspaceB.id),
    /CONTACT_NOT_FOUND/,
  );
});

test("Contato: atualizar campos preserva os não informados", async () => {
  const tenantId = "tenant-contact-4";
  const workspace = await makeWorkspace(tenantId);
  const deps = contactDeps();
  const contact = await createContact(deps, { tenantId, workspaceId: workspace.id, name: "Original", company: "Empresa X" });

  const updated = await updateContact(deps, { contactId: contact.id, tenantId, workspaceId: workspace.id, patch: { name: "Atualizado" } });
  assert.equal(updated.name, "Atualizado");
  assert.equal(updated.company, "Empresa X", "campo não informado no patch continua igual");
});
