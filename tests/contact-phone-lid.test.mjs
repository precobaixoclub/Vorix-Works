import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresContactIdentityRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-identity-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresContactPhoneRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-phone-repository.js";
import { PostgresPipelineRepository, PostgresPipelineStageRepository } from "../dist/infrastructure/storage/postgres/postgres-pipeline-repository.js";
import { PostgresDealRepository } from "../dist/infrastructure/storage/postgres/postgres-deal-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { ensureDefaultPipeline } from "../dist/application/crm/pipeline-use-cases.js";
import { getContactPhones, previewLidCleanup, runLidCleanup } from "../dist/application/crm/contact-phone-use-cases.js";
import { ensureCrmContactForInboxContact } from "../dist/application/commercial-bridge/inbox-crm-bridge-use-cases.js";
import { classifyContactPhone, looksLikeLid } from "../dist/domain/crm/contact-phone.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/** Celular é o pivô do CRM: LID do WhatsApp nunca é telefone; contatos só com LID saem em lote
 * (com prévia), quem tem venda/proposta fica, e a conversa nunca é apagada. */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-lid-${++counter}`;
const LID = "+102938475610293"; // 15 dígitos — formato de LID, não de celular

before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => { await db.stop(); });

test("REGRA: celular brasileiro e internacional são telefone; LID (sufixo, prefixo ou 15 dígitos) não é", () => {
  assert.equal(looksLikeLid("5511987654321"), false);
  assert.equal(looksLikeLid("123456789012345@lid"), true);
  assert.equal(looksLikeLid(LID), true);
  assert.deepEqual(classifyContactPhone([{ phoneNormalized: "+5511987654321" }]), { kind: "phone", phone: "+5511987654321" });
  assert.deepEqual(classifyContactPhone([{ phoneNormalized: LID, whatsappLid: LID }]), { kind: "lid_only" });
  assert.deepEqual(classifyContactPhone([{ phoneNormalized: LID, whatsappLid: LID, whatsappPn: "+5521998877665" }]), { kind: "phone", phone: "+5521998877665" }, "alias de telefone informado pelo WhatsApp vence");
  assert.deepEqual(classifyContactPhone([{ manualExternalId: "+1 415 555 0100" }]), { kind: "phone", phone: "+14155550100" });
  assert.deepEqual(classifyContactPhone([]), { kind: "none" });
});

test("LIMPEZA: remove só contatos LID sem venda/proposta; celular e quem tem oportunidade ficam; conversa continua", async () => {
  const tenantId = nextId("tenant");
  const workspace = await new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("ws") }).create({ tenantId, name: "W" });
  const workspaceId = workspace.id;
  const contacts = new PostgresContactRepository(db.pool);
  const identities = new PostgresContactIdentityRepository(db.pool);
  const inbox = new PostgresInboxContactRepository(db.pool);

  const withPhone = await contacts.create({ tenantId, workspaceId, name: "Ana" });
  const phoneInbox = await inbox.upsertByPhone({ tenantId, workspaceId, phoneNormalized: "+5511987654321", name: "Ana" });
  await inbox.linkCrmContact(phoneInbox.id, withPhone.id);

  const lidOnly = await contacts.create({ tenantId, workspaceId, name: "102938475610293" });
  const lidInbox = await inbox.upsertByPhone({ tenantId, workspaceId, phoneNormalized: LID, whatsappLid: LID });
  await identities.create({ contactId: lidOnly.id, tenantId, workspaceId, channel: "whatsapp", externalId: lidInbox.id });
  await inbox.linkCrmContact(lidInbox.id, lidOnly.id);

  const lidWithDeal = await contacts.create({ tenantId, workspaceId, name: "Cliente LID com venda" });
  await identities.create({ contactId: lidWithDeal.id, tenantId, workspaceId, channel: "whatsapp", externalId: "987654321098765@lid" });
  const d = { pipelineRepository: new PostgresPipelineRepository(db.pool), pipelineStageRepository: new PostgresPipelineStageRepository(db.pool) };
  const { pipeline, stages } = await ensureDefaultPipeline(d, tenantId, workspaceId);
  await new PostgresDealRepository(db.pool).create({ tenantId, workspaceId, pipelineId: pipeline.id, stageId: stages[0].id, contactId: lidWithDeal.id, title: "Venda", valueCents: 1000, currency: "BRL" });

  const manualNoPhone = await contacts.create({ tenantId, workspaceId, name: "Lead sem telefone" });

  const deps = { contactPhoneRepository: new PostgresContactPhoneRepository(db.pool) };
  const phones = await getContactPhones(deps, { tenantId, workspaceId, contactIds: [withPhone.id, lidOnly.id, manualNoPhone.id] });
  assert.deepEqual(phones[withPhone.id], { kind: "phone", phone: "+5511987654321" });
  assert.deepEqual(phones[lidOnly.id], { kind: "lid_only" });
  assert.deepEqual(phones[manualNoPhone.id], { kind: "none" });

  const preview = await previewLidCleanup(deps, { tenantId, workspaceId });
  assert.deepEqual(preview.removable.map((item) => item.contactId), [lidOnly.id]);
  assert.deepEqual(preview.protected.map((item) => [item.contactId, item.reason]), [[lidWithDeal.id, "tem oportunidade"]]);
  assert.equal(preview.withPhone, 1);
  assert.equal(preview.withoutAnyNumber, 1);

  await assert.rejects(runLidCleanup(deps, { tenantId, workspaceId, role: "editor" }), /CONTACT_CLEANUP_FORBIDDEN/);
  const result = await runLidCleanup(deps, { tenantId, workspaceId, role: "admin" });
  assert.deepEqual(result, { removed: 1, protected: 1 });
  assert.equal(await contacts.getById(lidOnly.id), undefined);
  assert.ok(await contacts.getById(withPhone.id));
  assert.ok(await contacts.getById(lidWithDeal.id));
  const conversationContact = await inbox.getById(lidInbox.id);
  assert.ok(conversationContact, "contato da conversa nunca é apagado");
  assert.equal(conversationContact.crmContactId, undefined, "só perde o vínculo com o CRM");

  // Ponte automática: enquanto só houver LID, não recria contato no CRM.
  const bridge = { inboxContactRepository: inbox, contact: { contactRepository: contacts, contactIdentityRepository: identities, timelineEventRepository: new PostgresTimelineEventRepository(db.pool) } };
  assert.equal(await ensureCrmContactForInboxContact(bridge, { tenantId, workspaceId, inboxContactId: lidInbox.id }), undefined);
  // Chegou o número real (alias PN): agora cria.
  await inbox.upsertByPhone({ tenantId, workspaceId, phoneNormalized: LID, whatsappPn: "+5531988776655" });
  const created = await ensureCrmContactForInboxContact(bridge, { tenantId, workspaceId, inboxContactId: lidInbox.id });
  assert.equal(created?.created, true);
});
