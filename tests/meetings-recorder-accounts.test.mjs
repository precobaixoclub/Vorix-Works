import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { WebSocket } from "ws";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresSolutionEntitlementRepository } from "../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMeetingRepository } from "../dist/infrastructure/storage/postgres/postgres-meeting-repository.js";
import { LocalObjectStorage } from "../dist/infrastructure/storage/local-object-storage.js";
import { ObjectStorageMeetingMedia } from "../dist/infrastructure/meetings/object-storage-meeting-media.js";
import { SolutionAccessService } from "../dist/application/solutions/solution-access.service.js";
import { limitsFromEntitlement } from "../dist/application/meetings/meeting-use-cases.js";
import { evaluateAutoRecordings, inferHumanJoinIdentity } from "../dist/application/meetings/meeting-processing.js";
import { listAllRecorderAccountsForSupport } from "../dist/application/meetings/recorder-accounts.js";
import { parseViewerInput, runProvisioningSession } from "../dist/application/meetings/recorder-provisioning.js";
import { assertGrantSourceAllowed, isSolutionContractable, meetingsCommercialBlockers, resolveSolutionAccess, SOLUTIONS } from "../dist/domain/solutions/solution.model.js";
import { processNextRecorderJob } from "../dist/application/meetings/meeting-recorder.js";
import { RecorderProvisioningHost } from "../dist/infrastructure/meetings/recorder-provisioning-host.js";
import { hashViewerToken, signWorkerLinkToken, verifyWorkerLinkToken } from "../dist/infrastructure/meetings/provisioning-link-auth.js";
import { decryptSecret, encryptSecret } from "../dist/infrastructure/crypto/secret-cipher.js";
import { attachProvisioningStreamProxy, PROVISIONING_STREAM_PATH } from "../dist/interfaces/api/meetings-provisioning-stream.js";
import {
  buildExcludedRecorderEmails,
  computeRecordingCapacity,
  meetingEligibleRecorderCapacity,
  normalizeGoogleEmail,
} from "../dist/domain/meetings/meeting.model.js";
import { hasPermission } from "../dist/domain/identity/identity.model.js";
import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Contas de gravação DO CLIENTE (customer_managed), identidade humana × conta de gravação e
 * login self-service. Banco real (PGlite) + API Fastify real + relay WebSocket real (com um
 * navegador FALSO — nenhum Google real, nenhuma conta real).
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
const MASTER = "recorder-accounts-test-master";
const PASSWORD = "S3nh@-Que-Nunca-Pode-Ser-Guardada!";
const MFA = "482913";

let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-ra${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55766 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => {
  await db.stop();
});

const repo = () => new PostgresMeetingRepository(db.pool);
const solutions = () => new SolutionAccessService({ repository: new PostgresSolutionEntitlementRepository(db.pool), cacheTtlMs: 0 });
const workspaces = () => new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("ws") });
const limits = (max) => ({ maxConcurrentRecordings: max, monthlyRecordingMinutes: 600, meetingRetentionDays: 90, maxStorageBytes: 1_000_000 });

const authPort = {
  async verifyToken(token) {
    if (!token) return { authenticated: false, reason: "missing_token" };
    const [tenantId, role, userId] = token.split("|");
    return { authenticated: true, principal: { tenantId, role, userId, sessionId: "s1", isPlatformAdmin: false } };
  },
};
const auth = (tenantId, role = "owner", userId = `user-${tenantId}`) => ({ authorization: `Bearer ${tenantId}|${role}|${userId}` });

async function buildTestApp() {
  const config = loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true" });
  const service = solutions();
  const meetings = {
    repository: repo(),
    media: new ObjectStorageMeetingMedia(new LocalObjectStorage({ rootDir: join(tmpdir(), "vorix-recorder-accounts-test"), publicBaseUrl: "http://localhost/uploads" })),
    limitsFor: async (tenantId) => limitsFromEntitlement((await service.getEntitlement(tenantId, "meetings"))?.limits),
    features: { realRecordingEnabled: true },
    idGenerator: nextId,
    now: () => new Date(),
    maxUploadBytes: 1024,
  };
  return buildApp({ config, container: { authPort, solutionAccess: service, meetings, workspaceRepository: workspaces() } });
}

async function tenant(label, max = 3) {
  const tenantId = `tenant-ra-${label}`;
  await solutions().setEntitlement({ tenantId, solutionKey: "meetings", enabled: true, source: "internal", reason: "teste", limits: { maxConcurrentRecordings: max } });
  const workspace = await workspaces().create({ tenantId, name: `WS ${label}` });
  return { tenantId, workspaceId: workspace.id };
}

async function addAccount(scope, email, { status = "active", session = "enc-session", id = nextId("acc") } = {}) {
  await db.pool.query(
    `insert into recorder_bot_accounts (id, ownership_type, tenant_id, workspace_id, label, google_email, encrypted_session_state, status)
     values ($1, 'customer_managed', $2, $3, $4, $5, $6, $7)`,
    [id, scope.tenantId, scope.workspaceId, `Conta ${email}`, email, session, status],
  );
  return id;
}

async function meeting(scope, { human = "pessoa@empresa.test", autoRecord = false, startAt, extra = {} } = {}) {
  const excluded = human ? buildExcludedRecorderEmails({ humanJoinAccountEmail: human }) : [];
  return repo().create({
    id: nextId("meeting"), tenantId: scope.tenantId, workspaceId: scope.workspaceId, ownerUserId: "owner-1", createdByUserId: "owner-1",
    title: "Reunião", source: autoRecord ? "calendar" : "external_link", status: "scheduled", meetingUrl: "https://meet.google.com/abc-defg-hij",
    ...(startAt ? { scheduledStartAt: startAt } : {}), timezone: "America/Sao_Paulo", autoRecord, participants: [{ email: "convidado@cliente.test", role: "attendee" }],
    ...(human ? { humanJoinAccountEmail: human, humanJoinIdentitySource: "explicit", excludedRecorderEmails: excluded } : {}),
    ...extra,
  });
}

const admit = (scope, meetingId, max = 3) => repo().admitRecording({ ...scope, meetingId, maxConcurrentRecordings: max, now: new Date() });

// --- Domínio ----------------------------------------------------------------------------------

test("DOMÍNIO: normalização de e-mail, exclusão só de identidades humanas e capacidade efetiva", () => {
  assert.equal(normalizeGoogleEmail("  Pessoa@Empresa.COM "), "pessoa@empresa.com");
  assert.equal(normalizeGoogleEmail("não é e-mail"), undefined);
  assert.deepEqual(buildExcludedRecorderEmails({ humanJoinAccountEmail: " A@x.com", extra: ["a@X.com", "b@x.com", "", null] }), ["a@x.com", "b@x.com"]);

  const healthy = (n, status = "active") => Array.from({ length: n }, () => ({ status, hasEncryptedSessionState: true }));
  // Plano 3 com 5 contas: capacidade 3, 2 de reserva.
  const plenty = computeRecordingCapacity({ planLimit: 3, accounts: healthy(5), activeRecordings: 0 });
  assert.deepEqual([plenty.tenantEffectiveRecordingCapacity, plenty.reserveAccounts, plenty.missingAccountsForPlan, plenty.availableNow], [3, 2, 0, 3]);
  // Plano 3 com 1 conta: capacidade real 1 (falta conectar 2).
  const few = computeRecordingCapacity({ planLimit: 3, accounts: healthy(1), activeRecordings: 0 });
  assert.deepEqual([few.tenantEffectiveRecordingCapacity, few.missingAccountsForPlan], [1, 2]);
  // Ocupadas contam na capacidade efetiva, mas não em "disponível agora".
  const busy = computeRecordingCapacity({ planLimit: 3, accounts: [...healthy(2, "busy"), ...healthy(1)], activeRecordings: 2 });
  assert.deepEqual([busy.tenantEffectiveRecordingCapacity, busy.availableNow, busy.busyAccounts], [3, 1, 2]);
  // Sessão inválida não conta.
  const invalid = computeRecordingCapacity({ planLimit: 2, accounts: [{ status: "invalid_session", hasEncryptedSessionState: true }], activeRecordings: 0 });
  assert.deepEqual([invalid.tenantEffectiveRecordingCapacity, invalid.invalidAccounts], [0, 1]);
  // Elegibilidade por reunião exclui a identidade humana.
  const accounts = [{ status: "active", hasEncryptedSessionState: true, googleEmail: "Gravador@empresa.com" }, { status: "active", hasEncryptedSessionState: true, googleEmail: "pessoa@empresa.com" }];
  const cap = computeRecordingCapacity({ planLimit: 3, accounts, activeRecordings: 0 });
  assert.equal(meetingEligibleRecorderCapacity({ capacity: cap, accounts, excludedRecorderEmails: ["PESSOA@empresa.com "] }), 1);
});

test("RBAC: só admin/owner gerenciam contas de gravação", () => {
  assert.equal(hasPermission("owner", "meeting:manage_recorder_accounts"), true);
  assert.equal(hasPermission("admin", "meeting:manage_recorder_accounts"), true);
  assert.equal(hasPermission("editor", "meeting:manage_recorder_accounts"), false);
  assert.equal(hasPermission("viewer", "meeting:manage_recorder_accounts"), false);
});

test("INFERÊNCIA: organizador conhecido, dono da agenda, explícito vence — convidados nunca entram", () => {
  const organizer = inferHumanJoinIdentity({ organizerEmail: "Ana@Empresa.com", ownerConnectedEmails: ["ana@empresa.com"], eventFromGoogle: true });
  assert.deepEqual([organizer.email, organizer.source, organizer.excluded], ["ana@empresa.com", "inferred_organizer", []]);
  // Organizador é outra pessoa: a pessoa entra com a conta da própria agenda.
  const owner = inferHumanJoinIdentity({ organizerEmail: "cliente@fora.com", ownerConnectedEmails: ["ana@empresa.com"], eventFromGoogle: true });
  assert.deepEqual([owner.email, owner.source, owner.excluded], ["ana@empresa.com", "inferred_calendar_owner", []]);
  const confirmed = inferHumanJoinIdentity({ confirmedConnectedEmail: "ana@empresa.com", organizerEmail: "cliente@fora.com", ownerConnectedEmails: ["ana@empresa.com"], eventFromGoogle: true });
  assert.deepEqual([confirmed.source, confirmed.excluded], ["connected_account_confirmed", ["ana@empresa.com"]]);
  const explicit = inferHumanJoinIdentity({ explicit: " Outra@Empresa.com", organizerEmail: "ana@empresa.com", ownerConnectedEmails: ["ana@empresa.com"], eventFromGoogle: true });
  assert.deepEqual([explicit.email, explicit.source, explicit.excluded], ["outra@empresa.com", "explicit", ["outra@empresa.com"]]);
  // Sem confiança: desconhecida (a gravação automática não começa até a pessoa informar).
  const unknown = inferHumanJoinIdentity({ ownerConnectedEmails: ["a@x.com", "b@x.com"], eventFromGoogle: false });
  assert.deepEqual([unknown.email, unknown.source, unknown.excluded], [undefined, "unknown", []]);
  assert.ok(!organizer.excluded.includes("cliente@fora.com"));
});

// --- Seleção / reserva ------------------------------------------------------------------------

test("ISOLAMENTO: a conta de um tenant nunca grava reunião de outro tenant", async () => {
  const a = await tenant("iso-a");
  const b = await tenant("iso-b");
  await addAccount(a, "gravador@tenant-a.test");
  const mb = await meeting(b);
  const refused = await admit(b, mb.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "NO_RECORDER_ACCOUNT_AVAILABLE");
  assert.equal(refused.connectedAccounts, 0, "B não enxerga a conta de A");
  const ma = await meeting(a);
  const ok = await admit(a, ma.id);
  assert.equal(ok.ok, true);
  const row = (await db.pool.query(`select tenant_id, current_tenant_id from recorder_bot_accounts where id = $1`, [ok.botAccountId])).rows[0];
  assert.deepEqual([row.tenant_id, row.current_tenant_id], [a.tenantId, a.tenantId]);
  // Listagem do tenant também é escopada.
  assert.equal((await repo().listRecorderAccounts({ tenantId: b.tenantId })).length, 0);
  // Pool interno (vorix_managed, preparado) nunca entra na seleção do cliente.
  await repo().upsertRecorderBot({ id: nextId("vorix"), label: "Pool interno", googleEmail: "pool@vorix.test", displayName: "Vorix", encryptedSessionState: "enc", status: "active" });
  const mb2 = await meeting(b);
  assert.equal((await admit(b, mb2.id)).reason, "NO_RECORDER_ACCOUNT_AVAILABLE");
});

test("IDENTIDADE: a conta humana da reunião nunca é escolhida como gravador (normalização incluída)", async () => {
  const scope = await tenant("ident");
  const humanAccount = await addAccount(scope, "Pessoa@Empresa.test");
  const m1 = await meeting(scope, { human: "  pessoa@empresa.TEST " });
  const conflict = await admit(scope, m1.id);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, "RECORDER_ACCOUNT_IDENTITY_CONFLICT");
  assert.deepEqual(conflict.skipped, [{ accountId: humanAccount, reason: "IDENTITY_CONFLICT" }]);
  assert.equal((await db.pool.query(`select status from recorder_bot_accounts where id = $1`, [humanAccount])).rows[0].status, "active", "a conta continua livre");

  const recorder = await addAccount(scope, "gravador01@empresa.test");
  const ok = await admit(scope, m1.id);
  assert.equal(ok.ok, true);
  assert.equal(ok.botAccountId, recorder, "escolhe a outra conta");
  assert.deepEqual(ok.skipped.map((item) => item.accountId), [humanAccount]);

  // Convidado NÃO é excluído: a conta do convidado pode gravar.
  const scope2 = await tenant("ident-attendee");
  const attendeeAccount = await addAccount(scope2, "convidado@cliente.test");
  const m2 = await meeting(scope2);
  const attendee = await admit(scope2, m2.id);
  assert.equal(attendee.ok, true);
  assert.equal(attendee.botAccountId, attendeeAccount);
});

test("IDENTIDADE: conta que é a pessoa de OUTRA reunião ativa do tenant fica fora (transitório)", async () => {
  const scope = await tenant("cross");
  await addAccount(scope, "gravador@empresa.test");
  await addAccount(scope, "ana@empresa.test");
  // Ana entra na 1ª reunião como PESSOA (gravada pela conta "gravador").
  const first = await meeting(scope, { human: "ana@empresa.test" });
  const firstAdmission = await admit(scope, first.id);
  assert.equal(firstAdmission.ok, true);
  assert.notEqual(firstAdmission.botAccountId, undefined);
  // A 2ª reunião (de Carla) não pode usar a conta da Ana enquanto ela está na outra reunião.
  const second = await meeting(scope, { human: "carla@empresa.test" });
  const result = await admit(scope, second.id);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "NO_RECORDER_ACCOUNT_AVAILABLE", "conflito com outra reunião é transitório, não permanente");
});

test("MOTIVOS: identidade obrigatória, sessão inválida, contas ocupadas, limite do plano", async () => {
  const scope = await tenant("reasons", 2);
  const noIdentity = await meeting(scope, { human: null });
  assert.equal((await admit(scope, noIdentity.id)).reason, "HUMAN_IDENTITY_REQUIRED");

  await addAccount(scope, "gravador-a@empresa.test", { status: "invalid_session" });
  const m1 = await meeting(scope);
  const invalid = await admit(scope, m1.id);
  assert.equal(invalid.reason, "INVALID_RECORDER_SESSION");
  assert.equal(invalid.invalidAccounts, 1);

  await addAccount(scope, "gravador-b@empresa.test");
  assert.equal((await admit(scope, m1.id)).ok, true);
  const m2 = await meeting(scope);
  const busy = await admit(scope, m2.id);
  assert.equal(busy.reason, "NO_RECORDER_ACCOUNT_AVAILABLE");
  assert.equal(busy.busyAccounts, 1);

  // Mais contas do que o plano: o plano continua sendo o teto.
  await addAccount(scope, "gravador-c@empresa.test");
  await addAccount(scope, "gravador-d@empresa.test");
  assert.equal((await admit(scope, m2.id)).ok, true);
  const m3 = await meeting(scope);
  const limit = await admit(scope, m3.id, 2);
  assert.equal(limit.reason, "CONCURRENCY_LIMIT_REACHED");
  assert.equal(limit.limit, 2);
});

test("RUNTIME: identidade corrigida depois da reserva é barrada no recorder e a conta volta saudável", async () => {
  const scope = await tenant("runtime");
  const account = await addAccount(scope, "gravador@empresa.test", { session: encryptSecret(JSON.stringify({ cookies: [], origins: [] }), MASTER) });
  const m = await meeting(scope);
  assert.equal((await admit(scope, m.id)).ok, true);
  // Fila só com este job (os testes anteriores deixaram admissões na fila).
  await db.pool.query(`update meeting_jobs set status = 'cancelled' where kind = 'record' and status = 'queued' and meeting_id <> $1`, [m.id]);
  // Simula a correção tardia (a pessoa vai entrar com a conta que foi reservada).
  await db.pool.query(`update meetings set excluded_recorder_emails = '{gravador@empresa.test}' where id = $1`, [m.id]);
  let captured = false;
  const outcome = await processNextRecorderJob({
    repository: repo(), media: { putFile: async () => undefined }, runtime: { capture: async () => { captured = true; throw new Error("não deveria capturar"); } },
    validator: { validate: async () => ({}) }, decryptSession: (value) => decryptSecret(value, MASTER), workerId: "w-runtime", leaseMs: 60_000,
    maxRecordingDurationMinutes: 10, admissionTimeoutMs: 1_000, idGenerator: nextId, now: () => new Date(),
  });
  assert.equal(outcome.failureCode, "RECORDER_ACCOUNT_IDENTITY_CONFLICT");
  assert.equal(captured, false, "o navegador nem abre");
  const row = (await db.pool.query(`select status, current_meeting_id from recorder_bot_accounts where id = $1`, [account])).rows[0];
  assert.deepEqual([row.status, row.current_meeting_id], ["active", null]);
});

// --- Agendador ----------------------------------------------------------------------------------

test("AGENDADOR: sem identidade não inicia; conflito permanente não repete e avisa o responsável", async () => {
  const scope = await tenant("scheduler");
  await addAccount(scope, "pessoa@empresa.test");
  const startAt = new Date(Date.now() - 30_000).toISOString();
  const noIdentity = await meeting(scope, { human: null, autoRecord: true, startAt });
  const conflict = await meeting(scope, { autoRecord: true, startAt });
  const notices = [];
  const input = { defaults: { joinBeforeMinutes: 2, joinGraceMinutes: 10 }, realRecordingEnabled: true, limitsFor: async () => limits(3), limit: 10 };
  const deps = { repository: repo(), now: () => new Date(), notify: async (notice) => { notices.push(notice); } };
  const first = await evaluateAutoRecordings(deps, input);
  assert.equal(first.outcomes.HUMAN_IDENTITY_REQUIRED, 1);
  assert.equal(first.outcomes.RECORDER_ACCOUNT_IDENTITY_CONFLICT, 1);
  assert.equal(notices.length, 2);
  assert.ok(notices.every((notice) => notice.userId === "owner-1" && !JSON.stringify(notice).includes("enc-session")));
  const second = await evaluateAutoRecordings(deps, input);
  assert.equal(second.evaluated, 0, "não há retry infinito");
  for (const id of [noIdentity.id, conflict.id]) {
    assert.equal((await repo().getDetail({ ...scope, meetingId: id })).status, "scheduled", "continua agendada para correção manual");
  }
  const audit = await db.pool.query(`select details from meeting_audit_log where tenant_id = $1 and action = 'RECORDER_ACCOUNT_SKIPPED_IDENTITY_CONFLICT'`, [scope.tenantId]);
  assert.equal(audit.rows.length, 1);
  assert.deepEqual(Object.keys(audit.rows[0].details), ["recorderAccountId"], "auditoria só com ids");
});

// --- API ----------------------------------------------------------------------------------------

test("API GRAVAR AGORA: pergunta a conta Google da pessoa, depois grava com outra conta", async () => {
  const app = await buildTestApp();
  const scope = await tenant("api-record");
  await addAccount(scope, "gravador@empresa.test");
  const created = await app.inject({ method: "POST", url: "/v1/meetings", headers: auth(scope.tenantId), payload: { workspaceId: scope.workspaceId, source: "instant", meetingUrl: "https://meet.google.com/abc-defg-hij", recordNow: true } });
  assert.equal(created.statusCode, 201);
  const recording = created.json().data.recording;
  assert.equal(recording.reason, "HUMAN_IDENTITY_REQUIRED");
  assert.match(recording.message, /Qual conta Google você utilizará para participar desta reunião\?/);
  const meetingId = created.json().data.meeting.id;

  const sameAsRecorder = await app.inject({ method: "POST", url: `/v1/meetings/${meetingId}/recording`, headers: auth(scope.tenantId), payload: { workspaceId: scope.workspaceId, humanJoinAccountEmail: "GRAVADOR@empresa.test" } });
  assert.equal(sameAsRecorder.json().data.reason, "RECORDER_ACCOUNT_IDENTITY_CONFLICT");

  const eligibility = await app.inject({ method: "GET", url: `/v1/meetings/${meetingId}/recorder-eligibility?workspaceId=${scope.workspaceId}`, headers: auth(scope.tenantId) });
  assert.equal(eligibility.json().data.warning.code, "RECORDER_ACCOUNT_IDENTITY_CONFLICT");

  const ok = await app.inject({ method: "POST", url: `/v1/meetings/${meetingId}/recording`, headers: auth(scope.tenantId), payload: { workspaceId: scope.workspaceId, humanJoinAccountEmail: "eu@empresa.test" } });
  assert.equal(ok.json().data.ok, true);
  const detail = await app.inject({ method: "GET", url: `/v1/meetings/${meetingId}?workspaceId=${scope.workspaceId}`, headers: auth(scope.tenantId) });
  assert.deepEqual([detail.json().data.humanJoinAccountEmail, detail.json().data.humanJoinIdentitySource], ["eu@empresa.test", "explicit"]);
  await app.close();
});

test("API CONTAS: RBAC, conectar (só hash do token no banco), duplicado, isolamento, remover apaga a sessão", async () => {
  const app = await buildTestApp();
  const a = await tenant("api-acc-a", 3);
  const b = await tenant("api-acc-b");
  const editor = await app.inject({ method: "GET", url: `/v1/meetings/recorder-accounts?workspaceId=${a.workspaceId}`, headers: auth(a.tenantId, "editor") });
  assert.equal(editor.statusCode, 403, "usuário comum não gerencia contas de gravação");

  const connect = await app.inject({ method: "POST", url: "/v1/meetings/recorder-accounts", headers: auth(a.tenantId), payload: { workspaceId: a.workspaceId, label: "Gravador Comercial 01", googleEmail: " Gravador01@Empresa.test " } });
  assert.equal(connect.statusCode, 201);
  const started = connect.json().data;
  assert.equal(started.account.googleEmail, "gravador01@empresa.test");
  assert.equal(started.account.status, "disabled", "fora da seleção até o login + teste");
  assert.equal(started.session.status, "pending");
  assert.equal(started.streamPath, PROVISIONING_STREAM_PATH);
  const stored = (await db.pool.query(`select viewer_token_hash from recorder_provisioning_sessions where id = $1`, [started.session.id])).rows[0];
  assert.equal(stored.viewer_token_hash, hashViewerToken(started.viewerToken));
  assert.ok(!JSON.stringify((await db.pool.query(`select * from recorder_provisioning_sessions`)).rows).includes(started.viewerToken), "token de visualização nunca vai para o banco");

  const duplicate = await app.inject({ method: "POST", url: "/v1/meetings/recorder-accounts", headers: auth(a.tenantId), payload: { workspaceId: a.workspaceId, label: "De novo", googleEmail: "gravador01@empresa.test" } });
  assert.equal(duplicate.statusCode, 409);
  // A MESMA conta Google pode ser conectada por outro tenant (cada um com a sua sessão).
  const otherTenant = await app.inject({ method: "POST", url: "/v1/meetings/recorder-accounts", headers: auth(b.tenantId), payload: { workspaceId: b.workspaceId, label: "B", googleEmail: "gravador01@empresa.test" } });
  assert.equal(otherTenant.statusCode, 201);

  const personal = await app.inject({ method: "POST", url: "/v1/meetings/recorder-accounts", headers: auth(a.tenantId), payload: { workspaceId: a.workspaceId, label: "Pessoal", googleEmail: "joao.silva@gmail.com" } });
  assert.equal(personal.statusCode, 201, "conta com cara de pessoal: avisa, não bloqueia");
  assert.equal(personal.json().data.warnings.length, 1);

  // B não vê, não testa, não remove a conta de A.
  const accountId = started.account.id;
  for (const [method, url] of [["POST", `/v1/meetings/recorder-accounts/${accountId}/test`], ["POST", `/v1/meetings/recorder-accounts/${accountId}/disable`], ["DELETE", `/v1/meetings/recorder-accounts/${accountId}`], ["GET", `/v1/meetings/recorder-provisioning/${started.session.id}`]]) {
    const response = await app.inject({ method, url, headers: auth(b.tenantId) });
    assert.equal(response.statusCode, 404, `${method} ${url}`);
  }
  const listB = await app.inject({ method: "GET", url: `/v1/meetings/recorder-accounts?workspaceId=${b.workspaceId}`, headers: auth(b.tenantId) });
  assert.deepEqual(listB.json().data.accounts.map((item) => item.label), ["B"]);

  // Lista + capacidade: nenhuma sessão, cookie ou ref de segredo na resposta.
  await db.pool.query(`update recorder_bot_accounts set encrypted_session_state = 'ciphertext-secreto', status = 'active' where id = $1`, [accountId]);
  const listA = await app.inject({ method: "GET", url: `/v1/meetings/recorder-accounts?workspaceId=${a.workspaceId}`, headers: auth(a.tenantId) });
  assert.ok(!listA.body.includes("ciphertext-secreto"));
  assert.equal(listA.json().data.capacity.planLimit, 3);
  assert.equal(listA.json().data.capacity.tenantEffectiveRecordingCapacity, 1);
  const capacity = await app.inject({ method: "GET", url: `/v1/meetings/recording-capacity?workspaceId=${a.workspaceId}`, headers: auth(a.tenantId, "editor") });
  assert.equal(capacity.statusCode, 200, "capacidade (sem e-mails) é visível a quem grava");
  assert.equal(capacity.json().data.canManage, false);

  // Ocupada não é removida; livre é removida com a sessão APAGADA.
  await db.pool.query(`update recorder_bot_accounts set status = 'busy' where id = $1`, [accountId]);
  assert.equal((await app.inject({ method: "DELETE", url: `/v1/meetings/recorder-accounts/${accountId}`, headers: auth(a.tenantId) })).statusCode, 409);
  await db.pool.query(`update recorder_bot_accounts set status = 'active' where id = $1`, [accountId]);
  assert.equal((await app.inject({ method: "DELETE", url: `/v1/meetings/recorder-accounts/${accountId}`, headers: auth(a.tenantId) })).statusCode, 200);
  const removed = (await db.pool.query(`select removed_at, encrypted_session_state, status from recorder_bot_accounts where id = $1`, [accountId])).rows[0];
  assert.ok(removed.removed_at);
  assert.equal(removed.encrypted_session_state, null);
  // Removida pode ser conectada de novo (unicidade só entre contas ativas).
  const again = await app.inject({ method: "POST", url: "/v1/meetings/recorder-accounts", headers: auth(a.tenantId), payload: { workspaceId: a.workspaceId, label: "Volta", googleEmail: "gravador01@empresa.test" } });
  assert.equal(again.statusCode, 201);

  // Suporte da plataforma enxerga dono/tenant/workspace — sem sessão.
  const support = await listAllRecorderAccountsForSupport({ repository: repo() });
  const row = support.find((item) => item.id === again.json().data.account.id);
  assert.deepEqual([row.ownershipType, row.tenantId, row.workspaceId], ["customer_managed", a.tenantId, undefined]);
  assert.ok(!JSON.stringify(support).includes("ciphertext-secreto"));
  await app.close();
});

// --- Login self-service (relay real, navegador falso) ---------------------------------------------

function fakeBrowserFactory(state) {
  return {
    async open(input) {
      state.opened += 1;
      state.loginHint = input.loginHint;
      const listeners = [];
      const timer = setInterval(() => { for (const listener of listeners) listener({ jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), width: 1024, height: 720 }); }, 20);
      return {
        onFrame(listener) { listeners.push(listener); },
        async dispatch(event) {
          state.inputs.push(event);
          // O "Google" desta página falsa conclui o login quando a pessoa aperta Enter no MFA.
          if (event.t === "key" && event.key === "Enter" && state.inputs.some((item) => item.t === "text" && item.v === MFA)) state.loggedIn = true;
        },
        async detect() { return state.loggedIn ? { loggedIn: true, email: state.loggedEmail } : { loggedIn: false }; },
        async storageState() { return JSON.stringify({ cookies: [{ name: "SID", value: "cookie-de-sessao", domain: ".google.com", path: "/" }], origins: [] }); },
        async close() { clearInterval(timer); state.closed += 1; },
      };
    },
  };
}

async function provisioningRig({ loggedEmail }) {
  const app = await buildTestApp();
  const scope = await tenant(`prov-${counter}`);
  const logs = [];
  const state = { opened: 0, closed: 0, inputs: [], loggedIn: false, loggedEmail };
  const port = 57000 + (counter % 900);
  const host = new RecorderProvisioningHost({
    repository: repo(), browsers: fakeBrowserFactory(state), healthCheck: { check: async (json) => ({ ok: JSON.parse(json).cookies.length > 0, details: { finalHost: "meet.google.com" } }) },
    encryptSession: (plaintext) => encryptSecret(plaintext, MASTER), workerId: "worker-prov", now: () => new Date(), pollMs: 30, viewerGraceMs: 60_000,
    log: (message, details) => logs.push(`${message} ${JSON.stringify(details ?? {})}`),
  }, { port, host: "127.0.0.1", publicEndpoint: `ws://127.0.0.1:${port}`, masterSecret: MASTER, maxConcurrent: 2 });
  await host.start();
  const server = createServer();
  attachProvisioningStreamProxy(server, { repository: repo(), authPort, canUseMeetings: (tenantId) => solutions().hasAccess(tenantId, "meetings"), masterSecret: MASTER, now: () => new Date(), workerWaitMs: 5_000 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiPort = server.address().port;
  const connect = await app.inject({ method: "POST", url: "/v1/meetings/recorder-accounts", headers: auth(scope.tenantId), payload: { workspaceId: scope.workspaceId, label: "Gravador 01", googleEmail: "gravador01@empresa.test" } });
  const started = connect.json().data;
  // Fila só com esta sessão (testes anteriores deixaram conexões pendentes; o worker pega a mais antiga).
  await db.pool.query("update recorder_provisioning_sessions set status = 'cancelled' where status = 'pending' and id <> $1", [started.session.id]);
  await host.tick();
  const close = async () => { await host.stop(); await new Promise((resolve) => server.close(resolve)); await app.close(); };
  return { app, scope, state, logs, host, started, apiPort, close, accessToken: `${scope.tenantId}|owner|user-${scope.tenantId}` };
}

function openViewer(apiPort, token, accessToken) {
  const socket = new WebSocket(`ws://127.0.0.1:${apiPort}${PROVISIONING_STREAM_PATH}`);
  const statuses = [];
  let frames = 0;
  socket.on("message", (data, isBinary) => {
    if (isBinary) frames += 1;
    else statuses.push(JSON.parse(data.toString()));
  });
  const ready = new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return { socket, statuses, frames: () => frames, ready, send: (payload) => socket.send(JSON.stringify(payload)), auth: () => socket.send(JSON.stringify({ t: "auth", token, accessToken })) };
}

const waitFor = async (predicate, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
};

test("SELF-SERVICE: login pelo navegador remoto ativa a conta; senha/MFA nunca são persistidos nem logados", async () => {
  const rig = await provisioningRig({ loggedEmail: "Gravador01@empresa.test" });
  try {
    const viewer = openViewer(rig.apiPort, rig.started.viewerToken, rig.accessToken);
    await viewer.ready;
    viewer.auth();
    assert.ok(await waitFor(() => viewer.frames() > 0), "a tela do navegador chega ao cliente");
    // O cliente digita no Google (pelo relay): e-mail, senha, MFA.
    viewer.send({ t: "mouse", a: "down", x: 100, y: 200 });
    viewer.send({ t: "mouse", a: "up", x: 100, y: 200 });
    viewer.send({ t: "text", v: PASSWORD });
    viewer.send({ t: "key", a: "down", key: "Enter" });
    viewer.send({ t: "text", v: MFA });
    viewer.send({ t: "key", a: "down", key: "Enter" });
    assert.ok(await waitFor(() => viewer.statuses.some((item) => item.s === "completed")), "sessão concluída");
    assert.ok(rig.state.inputs.some((item) => item.t === "text" && item.v === PASSWORD), "a senha chegou ao navegador (relay funciona)");
    assert.equal(rig.state.loginHint, "gravador01@empresa.test");
    assert.ok(await waitFor(() => rig.state.closed === 1), "navegador temporário destruído");

    const account = (await db.pool.query(`select * from recorder_bot_accounts where id = $1`, [rig.started.account.id])).rows[0];
    assert.equal(account.status, "active");
    assert.equal(account.health.method, "self_service_login");
    const decrypted = decryptSecret(account.encrypted_session_state, MASTER);
    assert.ok(decrypted.includes("cookie-de-sessao"), "só o estado de sessão é guardado (cifrado)");
    assert.ok(!account.encrypted_session_state.includes("cookie-de-sessao"), "nunca em claro");

    // Varredura: senha e MFA não existem em NENHUMA tabela relevante, em claro nem cifradas, nem nos logs.
    const dump = [];
    for (const table of ["recorder_bot_accounts", "recorder_provisioning_sessions", "meeting_audit_log", "meetings", "notifications"]) {
      dump.push(JSON.stringify((await db.pool.query(`select * from ${table}`)).rows));
    }
    const everything = `${dump.join("\n")}\n${decrypted}\n${rig.logs.join("\n")}`;
    assert.ok(!everything.includes(PASSWORD), "senha nunca persistida/logada");
    assert.ok(!everything.includes(MFA), "MFA nunca persistido/logado");
    const audit = await db.pool.query(`select action, details from meeting_audit_log where tenant_id = $1 order by created_at`, [rig.scope.tenantId]);
    assert.ok(audit.rows.some((row) => row.action === "RECORDER_CONNECTED"));
    const session = (await db.pool.query(`select status from recorder_provisioning_sessions where id = $1`, [rig.started.session.id])).rows[0];
    assert.equal(session.status, "completed");
    viewer.socket.close();
  } finally {
    await rig.close();
  }
});

test("SELF-SERVICE: entrar com OUTRA conta Google falha sem guardar sessão; token inválido é recusado", async () => {
  const rig = await provisioningRig({ loggedEmail: "pessoa.pessoal@gmail.com" });
  try {
    const intruder = openViewer(rig.apiPort, "token-falso", rig.accessToken);
    await intruder.ready;
    intruder.auth();
    const closedCode = await new Promise((resolve) => intruder.socket.once("close", (code) => resolve(code)));
    assert.equal(closedCode, 4401);

    const viewer = openViewer(rig.apiPort, rig.started.viewerToken, rig.accessToken);
    await viewer.ready;
    viewer.auth();
    assert.ok(await waitFor(() => viewer.frames() > 0));
    viewer.send({ t: "text", v: MFA });
    viewer.send({ t: "key", a: "down", key: "Enter" });
    assert.ok(await waitFor(() => viewer.statuses.some((item) => item.s === "failed")));
    assert.equal(viewer.statuses.find((item) => item.s === "failed").code, "WRONG_GOOGLE_ACCOUNT");
    const account = (await db.pool.query(`select status, encrypted_session_state from recorder_bot_accounts where id = $1`, [rig.started.account.id])).rows[0];
    assert.deepEqual([account.status, account.encrypted_session_state], ["disabled", null]);
    viewer.socket.close();
  } finally {
    await rig.close();
  }
});

test("CANAL: token API→worker assinado por sessão e com validade; entradas inválidas descartadas", () => {
  const now = new Date();
  const token = signWorkerLinkToken(MASTER, "rprov-1", now);
  assert.equal(verifyWorkerLinkToken(MASTER, "rprov-1", token, now), true);
  assert.equal(verifyWorkerLinkToken(MASTER, "rprov-2", token, now), false, "outra sessão");
  assert.equal(verifyWorkerLinkToken("outro-segredo", "rprov-1", token, now), false);
  assert.equal(verifyWorkerLinkToken(MASTER, "rprov-1", token, new Date(now.getTime() + 120_000)), false, "expirado");
  assert.equal(parseViewerInput({ t: "text", v: "x".repeat(600) }), undefined);
  assert.equal(parseViewerInput({ t: "eval", code: "1" }), undefined);
  assert.equal(parseViewerInput({ t: "mouse", a: "down", x: "1", y: 2 }), undefined);
  assert.deepEqual(parseViewerInput({ t: "key", a: "down", key: "Enter", extra: 1 }), { t: "key", a: "down", key: "Enter" });
});

test("CAPACIDADE CONTEXTUAL: plano 3, quatro saudáveis, uma ocupada e conflito na reunião", () => {
  const accounts = [
    { status: "busy", hasEncryptedSessionState: true, googleEmail: "busy@empresa.test" },
    ...["pessoa", "gravador1", "gravador2"].map((name) => ({ status: "active", hasEncryptedSessionState: true, googleEmail: `${name}@empresa.test` })),
    { status: "reauth_required", hasEncryptedSessionState: true, googleEmail: "expirada@empresa.test" },
  ];
  const capacity = computeRecordingCapacity({ planLimit: 3, accounts, activeRecordings: 1 });
  assert.deepEqual([capacity.planCapacity, capacity.tenantHealthyCapacity, capacity.tenantAvailableCapacity, capacity.availableNow], [3, 3, 3, 2]);
  assert.equal(meetingEligibleRecorderCapacity({ capacity, accounts, excludedRecorderEmails: ["pessoa@empresa.test"] }), 2);
});

test("POOL TENANT: conta compartilhada atende outro workspace; restrição e cross-tenant são respeitados", async () => {
  const scope = await tenant("tenant-pool");
  const other = await workspaces().create({ tenantId: scope.tenantId, name: "Segundo workspace" });
  const restricted = await addAccount(scope, "restrita@empresa.test");
  const otherScope = { tenantId: scope.tenantId, workspaceId: other.id };
  const m = await meeting(otherScope);
  assert.equal((await admit(otherScope, m.id)).reason, "NO_RECORDER_ACCOUNT_AVAILABLE");
  const created = await repo().createRecorderAccount({ id: nextId("pool"), tenantId: scope.tenantId, createdByUserId: "u", label: "Pool", googleEmail: "pool@empresa.test", displayName: "Pool" });
  assert.equal(created.ok, true);
  assert.equal(created.account.workspaceId, undefined);
  await db.pool.query(`update recorder_bot_accounts set status = 'active', encrypted_session_state = 'enc' where id = $1`, [created.account.id]);
  const admitted = await admit(otherScope, m.id);
  assert.equal(admitted.botAccountId, created.account.id);
  assert.equal((await repo().getRecorderAccount({ accountId: restricted, tenantId: scope.tenantId })).status, "active");
  const foreign = await tenant("tenant-pool-foreign");
  await assert.rejects(db.pool.query(`update recorder_bot_accounts set workspace_id = $2 where id = $1`, [restricted, foreign.workspaceId]), { code: "23503" });
  await assert.rejects(db.pool.query(`update recorder_bot_accounts set current_tenant_id = $2 where id = $1`, [created.account.id, foreign.tenantId]), { code: "23514" });
});

test("BANCO: duas reuniões ou execuções ativas não podem usar a mesma conta, mesmo com status adulterado", async () => {
  const scope = await tenant("structural");
  const accountId = await addAccount(scope, "gravador@empresa.test");
  const first = await meeting(scope);
  const second = await meeting(scope);
  const reserved = await admit(scope, first.id);
  assert.equal(reserved.ok, true);
  await db.pool.query(`update recorder_bot_accounts set status = 'active', current_meeting_id = null where id = $1`, [accountId]);
  await assert.rejects(admit(scope, second.id), { code: "23505" });
  assert.equal((await repo().getDetail({ ...scope, meetingId: second.id })).status, "scheduled", "transaction rolled back");
  await repo().createRecorderRun({ id: nextId("run"), ...scope, meetingId: first.id, jobId: reserved.jobId, botAccountId: accountId, workerId: "w1", state: "starting", metrics: {} });
  const jobId = nextId("job");
  await db.pool.query(`insert into meeting_jobs (id, tenant_id, workspace_id, meeting_id, kind, idempotency_key) values ($1,$2,$3,$4,'record',$1)`, [jobId, scope.tenantId, scope.workspaceId, second.id]);
  await assert.rejects(repo().createRecorderRun({ id: nextId("run"), ...scope, meetingId: second.id, jobId, botAccountId: accountId, workerId: "w2", state: "starting", metrics: {} }), { code: "23505" });
});

test("IDENTIDADE INFERIDA: sugere confirmação; escolha explícita vence e não exclui organizador", async () => {
  const app = await buildTestApp();
  try {
    const scope = await tenant("inferred-confirm");
    const accountId = await addAccount(scope, "organizador@empresa.test");
    const m = await meeting(scope, { human: "organizador@empresa.test", extra: { humanJoinIdentitySource: "inferred_organizer", excludedRecorderEmails: ["organizador@empresa.test"] } });
    const eligibility = await app.inject({ method: "GET", url: `/v1/meetings/${m.id}/recorder-eligibility?workspaceId=${scope.workspaceId}`, headers: auth(scope.tenantId) });
    assert.equal(eligibility.statusCode, 200);
    assert.equal(eligibility.json().data.warning.code, "HUMAN_IDENTITY_REQUIRED");
    assert.equal(eligibility.json().data.meetingEligibleCapacity, 1, "inference does not exclude account");
    assert.equal((await admit(scope, m.id)).reason, "HUMAN_IDENTITY_REQUIRED");
    const response = await app.inject({ method: "POST", url: `/v1/meetings/${m.id}/recording`, headers: auth(scope.tenantId), payload: { workspaceId: scope.workspaceId, humanJoinAccountEmail: "outra@empresa.test" } });
    assert.equal(response.json().data.botAccountId, accountId);
    const updated = await repo().getDetail({ ...scope, meetingId: m.id });
    assert.deepEqual([updated.humanJoinAccountEmail, updated.humanJoinIdentitySource, updated.excludedRecorderEmails], ["outra@empresa.test", "explicit", ["outra@empresa.test"]]);
  } finally { await app.close(); }
});

async function claimedSession(scope, accountId) {
  const session = await repo().createProvisioningSession({ id: nextId("prov-safety"), ...scope, recorderAccountId: accountId, createdByUserId: `user-${scope.tenantId}`, viewerTokenHash: nextId("hash"), expiresAt: new Date(Date.now() + 60_000) });
  await db.pool.query(`update recorder_provisioning_sessions set status = 'cancelled' where status = 'pending' and id <> $1`, [session.id]);
  return repo().claimProvisioningSession({ workerId: "safety-worker", workerEndpoint: "ws://127.0.0.1:1", now: new Date() });
}

function directRun(session, state, healthCheck, extra = {}) {
  return runProvisioningSession({ repository: repo(), browsers: fakeBrowserFactory(state), healthCheck, encryptSession: (plaintext) => encryptSecret(plaintext, MASTER), workerId: "safety-worker", now: () => new Date(), pollMs: 10, viewerGraceMs: 10_000, ...extra }, session);
}

test("RECONEXÃO: health check falho preserva sessão anterior, REAUTH exclui capacidade e sucesso reativa", async () => {
  const scope = await tenant("reconnect-safety");
  const accountId = await addAccount(scope, "gravador@empresa.test", { session: "previous-encrypted-state" });
  const session = await claimedSession(scope, accountId);
  assert.equal(session.reconnect, true);
  assert.equal((await repo().getRecorderAccount({ accountId, tenantId: scope.tenantId })).status, "reauth_required");
  const m = await meeting(scope);
  assert.equal((await admit(scope, m.id)).reason, "INVALID_RECORDER_SESSION");
  const state = { opened: 0, closed: 0, inputs: [], loggedIn: true, loggedEmail: "gravador@empresa.test" };
  const run = directRun(session, state, { check: async () => ({ ok: false, reason: "redirect_login", details: {} }) });
  assert.equal(await run.done, "failed");
  assert.equal(state.closed, 1);
  const previous = (await db.pool.query(`select encrypted_session_state, status from recorder_bot_accounts where id = $1`, [accountId])).rows[0];
  assert.deepEqual([previous.encrypted_session_state, previous.status], ["previous-encrypted-state", "reauth_required"]);
  const accounts = await repo().listRecorderAccounts({ tenantId: scope.tenantId });
  assert.equal(computeRecordingCapacity({ planLimit: 3, accounts, activeRecordings: 0 }).tenantHealthyCapacity, 0);
  const next = await claimedSession(scope, accountId);
  const success = directRun(next, state, { check: async () => ({ ok: true, details: {} }) });
  assert.equal(await success.done, "completed");
  assert.equal((await repo().getRecorderAccount({ accountId, tenantId: scope.tenantId })).status, "active");
  const audit = (await db.pool.query(`select action from meeting_audit_log where tenant_id = $1`, [scope.tenantId])).rows.map((row) => row.action);
  for (const action of ["RECORDER_HEALTH_FAILED", "RECORDER_REAUTH_REQUIRED", "RECORDER_RECONNECTED"]) assert.ok(audit.includes(action));
});

test("PROVISIONAMENTO: cancelar durante health check impede atualização tardia da sessão", async () => {
  const scope = await tenant("cancel-health");
  const accountId = await addAccount(scope, "gravador@empresa.test", { session: "previous-state" });
  const session = await claimedSession(scope, accountId);
  let resolveHealth;
  let checking = false;
  const health = new Promise((resolve) => { resolveHealth = resolve; });
  const state = { opened: 0, closed: 0, inputs: [], loggedIn: true, loggedEmail: "gravador@empresa.test" };
  const run = directRun(session, state, { check: async () => { checking = true; return health; } });
  assert.ok(await waitFor(() => checking));
  await repo().updateProvisioningSession({ sessionId: session.id, status: "cancelled" });
  resolveHealth({ ok: true, details: {} });
  assert.equal(await run.done, "cancelled");
  const row = (await db.pool.query(`select encrypted_session_state, status from recorder_bot_accounts where id = $1`, [accountId])).rows[0];
  assert.deepEqual([row.encrypted_session_state, row.status], ["previous-state", "reauth_required"]);
});

test("DESATIVAÇÃO: cancela reconexão e impede health check antigo de reativar a conta", async () => {
  const scope = await tenant("disable-provisioning");
  const accountId = await addAccount(scope, "gravador@empresa.test", { session: "previous-state" });
  const requestedAt = new Date().toISOString();
  await repo().updateRecorderBotStatus({ botId: accountId, status: "disabled", health: { status: "pending", requestedAt } });
  const session = await claimedSession(scope, accountId);
  const disabled = await repo().setRecorderAccountEnabled({ tenantId: scope.tenantId, accountId, enabled: false });
  assert.equal(disabled.status, "disabled");
  assert.equal((await repo().getProvisioningSession({ sessionId: session.id })).status, "cancelled");
  const staleHealth = await repo().updateRecorderBotStatus({ botId: accountId, status: "active", health: { status: "healthy" }, expectedHealth: { requestedAt } });
  assert.equal(staleHealth, undefined);
  assert.equal((await repo().getRecorderAccount({ accountId, tenantId: scope.tenantId })).status, "disabled");
  await assert.rejects(repo().upsertRecorderBot({ id: accountId, label: "Manual", googleEmail: "gravador@empresa.test", displayName: "Manual", encryptedSessionState: "unvalidated-state", status: "active" }), /CUSTOMER_MANAGED/);
  assert.equal((await db.pool.query(`select encrypted_session_state from recorder_bot_accounts where id = $1`, [accountId])).rows[0].encrypted_session_state, "previous-state");
});

test("PROVISIONAMENTO: expiração e abandono fecham navegador e descartam estado incompleto", async () => {
  for (const abandoned of [false, true]) {
    const scope = await tenant(`cleanup-${abandoned}`);
    const accountId = await addAccount(scope, "gravador@empresa.test", { status: "disabled", session: null });
    const session = await claimedSession(scope, accountId);
    if (!abandoned) session.expiresAt = new Date(Date.now() - 1).toISOString();
    const state = { opened: 0, closed: 0, inputs: [], loggedIn: false, loggedEmail: "gravador@empresa.test" };
    const run = directRun(session, state, { check: async () => { throw new Error("must not check incomplete login"); } }, { viewerGraceMs: 1 });
    assert.equal(await run.done, abandoned ? "cancelled" : "expired");
    assert.equal(state.closed, 1);
    assert.equal((await repo().getRecorderAccount({ accountId, tenantId: scope.tenantId })).hasEncryptedSessionState, false);
  }
});

test("VIEWER: mesmo com token vazado, outro tenant/usuário não abre navegador; token tem uso único", async () => {
  const rig = await provisioningRig({ loggedEmail: "gravador01@empresa.test" });
  try {
    for (const accessToken of ["outro-tenant|owner|intruso", `${rig.scope.tenantId}|owner|outro-usuario`, `${rig.scope.tenantId}|viewer|user-${rig.scope.tenantId}`]) {
      const intruder = openViewer(rig.apiPort, rig.started.viewerToken, accessToken);
      await intruder.ready;
      const closed = new Promise((resolve) => intruder.socket.once("close", (code) => resolve(code)));
      intruder.auth();
      assert.equal(await closed, 4401);
      assert.equal(intruder.frames(), 0);
    }
    const viewer = openViewer(rig.apiPort, rig.started.viewerToken, rig.accessToken);
    await viewer.ready;
    viewer.auth();
    assert.ok(await waitFor(() => viewer.frames() > 0));
    const replay = openViewer(rig.apiPort, rig.started.viewerToken, rig.accessToken);
    await replay.ready;
    const closed = new Promise((resolve) => replay.socket.once("close", (code) => resolve(code)));
    replay.auth();
    assert.equal(await closed, 4401);
    viewer.socket.close();
  } finally { await rig.close(); }
});

test("COMERCIAL: diagnóstico técnico permanece honesto; disponibilidade segue decisão de produto", () => {
  const ready = { selfServiceProvisioning: "PASS", customerDependsOnVorixOperator: false, cliOnlyRequiredForCustomer: false, recorderAccountTenantIsolation: "PASS", identityConflictRuntimeCheck: "PASS", sessionEncryption: "PASS" };
  assert.deepEqual(meetingsCommercialBlockers(ready), []);
  for (const [field, value] of Object.entries(ready)) {
    const blocked = { ...ready, [field]: typeof value === "boolean" ? true : "PARTIAL" };
    assert.equal(meetingsCommercialBlockers(blocked).length, 1, field);
  }
  const prematurelyPublic = { key: "meetings", name: "Vorix Meetings", commercialAvailability: "public", defaultEntitlement: false };
  assert.equal(isSolutionContractable(prematurelyPublic), true);
  assert.doesNotThrow(() => assertGrantSourceAllowed(prematurelyPublic, "subscription"));
  // Conceitos separados: o gate comercial não mexe em entitlement, kill switch nem uso interno.
  const internal = resolveSolutionAccess({ solution: SOLUTIONS.meetings, entitlement: { enabled: true, source: "internal" }, killSwitchOn: false });
  assert.deepEqual([internal.enabled, internal.internal], [true, false], "homologação/uso interno continua funcionando");
  assert.equal(resolveSolutionAccess({ solution: SOLUTIONS.meetings, entitlement: { enabled: true, source: "internal" }, killSwitchOn: true }).enabled, false, "kill switch é independente");
  assert.equal(resolveSolutionAccess({ solution: SOLUTIONS.meetings, killSwitchOn: false }).enabled, false, "sem concessão: fail-closed");
  assert.equal(resolveSolutionAccess({ solution: SOLUTIONS.conversations, killSwitchOn: false }).enabled, true);
});

// --- Concorrência em Postgres REAL (opcional: VORIX_REAL_PG_URL) ---------------------------------

test("CONCORRÊNCIA REAL: N admissões paralelas nunca duplicam conta nem passam do plano", { skip: !process.env.VORIX_REAL_PG_URL && "defina VORIX_REAL_PG_URL (Postgres real, banco descartável)" }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.VORIX_REAL_PG_URL, max: 20 });
  try {
    const real = new PostgresMeetingRepository(pool);
    const suffix = Date.now().toString(36);
    const scope = { tenantId: `tenant-real-${suffix}`, workspaceId: `ws-real-${suffix}` };
    await pool.query(`insert into workspaces (id, tenant_id, name, status, created_at, updated_at) values ($1, $2, 'Real', 'active', now(), now())`, [scope.workspaceId, scope.tenantId]);
    const accounts = ["g1", "g2", "g3", "pessoa"].map((name) => `${name}-${suffix}@empresa.test`);
    for (const email of accounts) {
      await pool.query(`insert into recorder_bot_accounts (id, ownership_type, tenant_id, workspace_id, label, google_email, encrypted_session_state, status) values ($1, 'customer_managed', $2, $3, $1, $4, 'enc', 'active')`, [`acc-${email}`, scope.tenantId, scope.workspaceId, email]);
    }
    const human = accounts[3];
    const meetings = [];
    for (let index = 0; index < 12; index += 1) {
      const created = await real.create({ id: `meeting-real-${suffix}-${index}`, ...scope, ownerUserId: "u", createdByUserId: "u", title: `M${index}`, source: "external_link", status: "scheduled", meetingUrl: "https://meet.google.com/abc-defg-hij", timezone: "America/Sao_Paulo", autoRecord: false, participants: [], humanJoinAccountEmail: human, humanJoinIdentitySource: "explicit", excludedRecorderEmails: [human] });
      meetings.push(created.id);
    }
    const results = await Promise.all(meetings.map((meetingId) => real.admitRecording({ ...scope, meetingId, maxConcurrentRecordings: 5, now: new Date() })));
    const ok = results.filter((result) => result.ok);
    assert.equal(ok.length, 3, "3 contas elegíveis (a 4ª é a pessoa) → 3 gravações, mesmo com plano 5");
    assert.equal(new Set(ok.map((result) => result.botAccountId)).size, 3, "nenhuma conta duplicada");
    assert.ok(!ok.some((result) => result.botAccountId === `acc-${human}`), "a conta humana nunca é reservada");
    const busy = await pool.query(`select count(*)::int as n from recorder_bot_accounts where tenant_id = $1 and status = 'busy'`, [scope.tenantId]);
    assert.equal(busy.rows[0].n, 3);
    await pool.query(`delete from meeting_jobs where tenant_id = $1`, [scope.tenantId]);
    await pool.query(`delete from meeting_audit_log where tenant_id = $1`, [scope.tenantId]);
    await pool.query(`delete from meeting_participants where tenant_id = $1`, [scope.tenantId]);
    await pool.query(`delete from meeting_usage_monthly where tenant_id = $1`, [scope.tenantId]);
    await pool.query(`update recorder_bot_accounts set current_meeting_id = null where tenant_id = $1`, [scope.tenantId]);
    await pool.query(`delete from meetings where tenant_id = $1`, [scope.tenantId]);
    await pool.query(`delete from recorder_bot_accounts where tenant_id = $1`, [scope.tenantId]);
    await pool.query(`delete from workspaces where id = $1`, [scope.workspaceId]);
  } finally {
    await pool.end();
  }
});
