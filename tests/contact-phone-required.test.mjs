import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";
import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresContactRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-repository.js";
import { PostgresContactIdentityRepository } from "../dist/infrastructure/storage/postgres/postgres-contact-identity-repository.js";
import { PostgresInboxContactRepository } from "../dist/infrastructure/storage/postgres/postgres-inbox-contact-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresTimelineEventRepository } from "../dist/infrastructure/storage/postgres/postgres-timeline-event-repository.js";
import { createContact, updateContact } from "../dist/application/crm/contact-use-cases.js";
import { normalizeContactPhone, classifyContactPhone } from "../dist/domain/crm/contact-phone.js";
import { registerContactsRoutes } from "../dist/interfaces/api/routes/v1/contacts.route.js";
import { registerErrorHandler } from "../dist/interfaces/api/http/error-handler.js";
import { ROLE_PERMISSIONS } from "../dist/domain/identity/identity.model.js";
import { cleanupInvalidContacts } from "../scripts/cleanup-invalid-contacts.mjs";

let db, reportDir;
let seq = 0;
before(async () => {
  db = await startTestPostgres();
  await applyMigrations(db.pool, join(process.cwd(), "db/migrations"));
  reportDir = await mkdtemp(join(tmpdir(), "vorix-contact-phone-"));
});
after(async () => { await db?.stop(); });
const reportPath = () => join(reportDir, `report-${++seq}.json`);
async function context() {
  const tenantId = `phone-required-${++seq}`;
  const workspace = await new PostgresWorkspaceRepository(db.pool).create({ tenantId, name: "Telefone obrigatório" });
  return { tenantId, workspaceId: workspace.id };
}
function deps() {
  return { contactRepository: new PostgresContactRepository(db.pool), contactIdentityRepository: new PostgresContactIdentityRepository(db.pool), timelineEventRepository: new PostgresTimelineEventRepository(db.pool), inboxContactRepository: new PostgresInboxContactRepository(db.pool) };
}
async function legacy(scope, name) {
  const id = `legacy-${++seq}`;
  await db.pool.query("insert into contacts (id,tenant_id,workspace_id,name) values ($1,$2,$3,$4)", [id, scope.tenantId, scope.workspaceId, name]);
  return id;
}

test("telefones: valida DDD/plano de numeração, formatos nacionais e internacionais, fixos e celular legado", () => {
  for (const [input, expected] of [["(46) 99918-0430", "+5546999180430"], ["554699180430@s.whatsapp.net", "+5546999180430"], ["+55 (51) 3358-4770", "+555133584770"], ["+1 415 555 0100", "+14155550100"], ["+44 20 7946 0018", "+442079460018"]]) assert.equal(normalizeContactPhone(input), expected, input);
  for (const input of [undefined, null, 123, {}, "", "+210656032780390", "+5500999999999", "+551112345678", "abc5511987654321", "5511987654321@lid", "5511987654321@g.us", "LID_5511987654321", "uuid-5511987654321"]) assert.equal(normalizeContactPhone(input), undefined, String(input));
  assert.deepEqual(classifyContactPhone([{ phoneNormalized: "+5511987654321", whatsappPn: "+5511987654321", whatsappLid: "+5511987654321" }]), { kind: "lid_only" }, "LID conhecido nunca é promovido a telefone mesmo com formato numérico válido");
});

test("cadastro: sem telefone/LID/inválido falha antes de gravar; edição não remove telefone", async () => {
  const scope = await context(), d = deps();
  for (const phone of [undefined, "", "+210656032780390", "+551112345678"]) {
    await assert.rejects(createContact(d, { ...scope, name: "Inválido", customFields: { phone } }), /CONTACT_PHONE_REQUIRED/);
    await assert.rejects(d.contactRepository.create({ ...scope, name: "Inválido direto", customFields: { phone } }), /CONTACT_PHONE_REQUIRED/);
  }
  assert.equal(await d.contactRepository.countByWorkspace(scope), 0);
  const contact = await createContact(d, { ...scope, name: "Cliente", customFields: { phone: "(11) 98765-4321", source: "manual" } });
  assert.equal(contact.customFields.phone, "+5511987654321");
  for (const phone of ["", null, "+210656032780390"]) await assert.rejects(updateContact(d, { ...scope, contactId: contact.id, patch: { customFields: { phone } } }), /CONTACT_PHONE_REQUIRED/);
  await assert.rejects(d.contactRepository.update(contact.id, { customFields: { phone: "" } }), /CONTACT_PHONE_REQUIRED/);
  const updated = await updateContact(d, { ...scope, contactId: contact.id, patch: { customFields: { other: "campo" } } });
  assert.equal(updated.customFields.phone, "+5511987654321");
});

test("HTTP: rejeita ausência de celular com 400, resolve número no backend e impede LID e fonte de outro workspace", async () => {
  const scope = await context(), d = deps(), app = Fastify();
  registerErrorHandler(app);
  app.addHook("onRequest", async request => { request.zunoContext = { principal: { tenantId: scope.tenantId, userId: "owner", role: "owner", permissions: ROLE_PERMISSIONS.owner } }; });
  await registerContactsRoutes(app, d);
  try {
    const post = payload => app.inject({ method: "POST", url: "/contacts", payload: { workspaceId: scope.workspaceId, name: "Cliente", ...payload } });
    assert.equal((await post({})).statusCode, 400);
    assert.equal((await post({ customFields: { phone: "+210656032780390" } })).statusCode, 400);
    const lid = await d.inboxContactRepository.upsertByPhone({ ...scope, phoneNormalized: "+210656032780390", whatsappLid: "+210656032780390" });
    assert.equal((await post({ inboxContactId: lid.id, customFields: { phone: "+5511987654321" } })).statusCode, 400, "telefone do navegador não substitui a origem LID");
    const other = await context();
    const foreign = await d.inboxContactRepository.upsertByPhone({ ...other, phoneNormalized: "+5511987654321" });
    assert.equal((await post({ inboxContactId: foreign.id })).statusCode, 404);
    const inbox = await d.inboxContactRepository.upsertByPhone({ ...scope, phoneNormalized: "+5546999180430" });
    const response = await post({ inboxContactId: inbox.id });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.json().data.customFields.phone, "+5546999180430");
  } finally { await app.close(); }
});

test("limpeza: prévia não altera dados; exclui todos sem telefone, recupera fontes válidas e preserva outros workspaces e Inbox", async () => {
  const scope = await context(), other = await context(), d = deps();
  const lidId = await legacy(scope, "+210656032780390"), emptyId = await legacy(scope, "Sem telefone");
  const numericId = await legacy(scope, "+5511920187546"), linkedId = await legacy(scope, "Telefone na conversa");
  const foreignId = await legacy(other, "Não tocar");
  const manual = await d.contactRepository.create({ ...scope, name: "Manual", customFields: { phone: "+5511987654321" } });
  const lidInbox = await d.inboxContactRepository.upsertByPhone({ ...scope, phoneNormalized: "+210656032780390", whatsappLid: "+210656032780390" });
  await d.inboxContactRepository.linkCrmContact(lidInbox.id, lidId);
  const phoneInbox = await d.inboxContactRepository.upsertByPhone({ ...scope, phoneNormalized: "+5546999180430" });
  await d.inboxContactRepository.linkCrmContact(phoneInbox.id, linkedId);
  const pendingTaskId = `task-phone-${++seq}`;
  await db.pool.query("insert into tasks (id,tenant_id,workspace_id,contact_id,type,title) values ($1,$2,$3,$4,'follow_up','Retorno')", [pendingTaskId,scope.tenantId,scope.workspaceId,emptyId]);
  const previewPath = reportPath();
  const preview = await cleanupInvalidContacts(db.pool, { ...scope, reportPath: previewPath });
  assert.deepEqual(preview, { mode: "preview", total: 5, retained: 3, recovered: 2, removed: 2 });
  assert.ok(await d.contactRepository.getById(lidId));
  const report = JSON.parse(await readFile(previewPath, "utf8"));
  assert.deepEqual(report.invalid.map(item => item.contact.id).sort(), [lidId, emptyId].sort());
  await assert.rejects(cleanupInvalidContacts(db.pool, { ...scope, apply: true, expectedRemovals: 1, reportPath: reportPath() }), /Quantidade mudou/);
  const result = await cleanupInvalidContacts(db.pool, { ...scope, apply: true, expectedRemovals: 2, reportPath: reportPath() });
  assert.equal(result.removed, 2);
  assert.equal(await d.contactRepository.getById(lidId), undefined);
  assert.equal(await d.contactRepository.getById(emptyId), undefined);
  assert.ok(await d.contactRepository.getById(foreignId));
  for (const id of [manual.id, numericId, linkedId]) assert.ok(normalizeContactPhone((await d.contactRepository.getById(id)).customFields.phone));
  assert.ok(await d.inboxContactRepository.getById(lidInbox.id));
  assert.equal((await d.inboxContactRepository.getById(lidInbox.id)).crmContactId, undefined);
  assert.equal((await db.pool.query("select contact_id from tasks where id=$1", [pendingTaskId])).rows[0].contact_id, null);
  assert.equal((await cleanupInvalidContacts(db.pool, { ...scope, apply: true, expectedRemovals: 0, reportPath: reportPath() })).removed, 0);
});
