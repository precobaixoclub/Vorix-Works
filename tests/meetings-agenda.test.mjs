import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { applyMigrations } from "../dist/infrastructure/storage/postgres/migration-runner.js";
import { PostgresSolutionEntitlementRepository } from "../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js";
import { PostgresWorkspaceRepository } from "../dist/infrastructure/storage/postgres/postgres-workspace-repository.js";
import { PostgresMeetingRepository } from "../dist/infrastructure/storage/postgres/postgres-meeting-repository.js";
import { PostgresCalendarEventRepository } from "../dist/infrastructure/storage/postgres/postgres-calendar-event-repository.js";
import { PostgresCalendarConnectionRepository } from "../dist/infrastructure/storage/postgres/postgres-calendar-connection-repository.js";
import { GoogleCalendarOAuthService } from "../dist/infrastructure/calendar/google-calendar-oauth-service.js";
import { InMemorySecretManager } from "../dist/infrastructure/operations/secret-managers.js";
import { SolutionAccessService } from "../dist/application/solutions/solution-access.service.js";
import { MeetingsCalendarLink } from "../dist/application/meetings/meeting-processing.js";
import { resolveEventTimes } from "../dist/application/calendar/calendar-event-use-cases.js";
import { syncConnection } from "../dist/application/calendar/calendar-sync-use-cases.js";
import { completeGoogleCalendarConnect } from "../dist/application/calendar/calendar-connection-use-cases.js";
import { zonedLocalToUtc } from "../dist/domain/calendar/calendar.model.js";
import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { startTestPostgres } from "./helpers/pglite-test-db.mjs";

/**
 * Agenda do Vorix Meetings (evolução da 0127) + sync com Google Calendar. O Google é um FALSO em
 * memória com o comportamento que importa: etag por versão, sync token incremental, 410 de token
 * expirado, If-Match/412, link do Meet e ocorrências de recorrência com id próprio.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");
let db;
let counter = 0;
const nextId = (prefix) => `${prefix}-a${++counter}`;

before(async () => {
  db = await startTestPostgres({ port: 55763 });
  await applyMigrations(db.pool, MIGRATIONS_DIR);
});
after(async () => {
  await db.stop();
});

const events = () => new PostgresCalendarEventRepository(db.pool);
const connections = () => new PostgresCalendarConnectionRepository(db.pool);
const meetingsRepo = () => new PostgresMeetingRepository(db.pool);
const solutions = () => new SolutionAccessService({ repository: new PostgresSolutionEntitlementRepository(db.pool), cacheTtlMs: 0 });
const workspaces = () => new PostgresWorkspaceRepository(db.pool, { idGenerator: () => nextId("ws") });

async function setupTenant(label) {
  const tenantId = `tenant-agenda-${label}`;
  await solutions().setEntitlement({ tenantId, solutionKey: "meetings", enabled: true, source: "internal" });
  const workspace = await workspaces().create({ tenantId, name: `Agenda ${label}` });
  return { tenantId, workspaceId: workspace.id };
}

const authPort = {
  async verifyToken(token) {
    if (!token) return { authenticated: false, reason: "missing_token" };
    const [tenantId, role, userId] = token.split("|");
    return { authenticated: true, principal: { tenantId, role, userId, sessionId: "s1", isPlatformAdmin: false } };
  },
};
const auth = (tenantId, role = "owner", userId = `user-${tenantId}`) => ({ authorization: `Bearer ${tenantId}|${role}|${userId}` });

const fakeAuth = { isConfigured: () => false, begin: () => ({ authorizationUrl: "x" }), verifyState: () => { throw new Error("CALENDAR_OAUTH_STATE_INVALID: x"); }, complete: async () => { throw new Error("x"); }, disconnect: async () => undefined };

async function buildTestApp() {
  const config = loadApiConfig({ ZUNO_LOG_LEVEL: "silent", AUTH_MODE: "noop", CONVERSATIONS_MODULE_ENABLED: "true" });
  const repo = meetingsRepo();
  const meetingsAgenda = {
    calendar: { events: events(), connections: connections(), meetings: new MeetingsCalendarLink({ repository: repo, idGenerator: nextId, limitsFor: async () => ({ maxConcurrentRecordings: 1, monthlyRecordingMinutes: 600, meetingRetentionDays: 90, maxStorageBytes: 1_000_000 }) }), now: () => new Date() },
    connection: { connections: connections(), auth: fakeAuth, now: () => new Date() },
  };
  return buildApp({ config, container: { authPort, solutionAccess: solutions(), meetingsAgenda, workspaceRepository: workspaces() } });
}

const base = { allDay: false, timezone: "America/Sao_Paulo" };

// --- Fuso / dia inteiro ------------------------------------------------------------------------

test("FUSO: horário de parede no fuso do evento vira o instante UTC certo; dia inteiro usa a meia-noite local", () => {
  assert.equal(zonedLocalToUtc("2026-11-20T14:30", "America/Sao_Paulo").toISOString(), "2026-11-20T17:30:00.000Z");
  assert.equal(zonedLocalToUtc("2026-07-01T09:00", "Europe/Lisbon").toISOString(), "2026-07-01T08:00:00.000Z", "horário de verão em Lisboa (UTC+1)");
  const allDay = resolveEventTimes({ allDay: true, start: "2026-11-20", end: "2026-11-21", timezone: "America/Sao_Paulo" });
  assert.deepEqual(allDay, { startAt: "2026-11-20T03:00:00.000Z", endAt: "2026-11-22T03:00:00.000Z" }, "último dia inclusivo → fim exclusivo no dia seguinte");
  assert.throws(() => resolveEventTimes({ ...base, start: "2026-11-20T10:00", end: "2026-11-20T09:00" }), /CALENDAR_INVALID_INPUT/);
  assert.throws(() => resolveEventTimes({ allDay: false, start: "2026-11-20T10:00", end: "2026-11-20T11:00", timezone: "Marte/Olympus" }), /Fuso horário inválido/);
});

// --- API: CRUD, terminal, RBAC, isolamento -------------------------------------------------------

test("AGENDA CRUD: criar, listar, editar, concluir (terminal) e cancelar", async () => {
  const app = await buildTestApp();
  const { tenantId, workspaceId } = await setupTenant("crud");
  const created = await app.inject({ method: "POST", url: "/v1/meetings/agenda/events", headers: auth(tenantId), payload: { workspaceId, title: "Planejamento", ...base, start: "2026-11-20T14:30", end: "2026-11-20T15:30", attendees: ["Ana@Cliente.com"], location: "Sala 2" } });
  assert.equal(created.statusCode, 201, created.body);
  const event = created.json().data;
  assert.equal(event.startAt, "2026-11-20T17:30:00.000Z");
  assert.deepEqual(event.attendees, ["ana@cliente.com"]);
  assert.equal(event.syncState, "pending", "edição local fica pendente para o Google");

  const allDay = await app.inject({ method: "POST", url: "/v1/meetings/agenda/events", headers: auth(tenantId), payload: { workspaceId, title: "Feriado", allDay: true, start: "2026-11-21", end: "2026-11-21", timezone: "America/Sao_Paulo" } });
  assert.equal(allDay.json().data.allDay, true);

  const list = await app.inject({ method: "GET", url: `/v1/meetings/agenda/events?workspaceId=${workspaceId}&from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z`, headers: auth(tenantId) });
  assert.deepEqual(list.json().data.map((item) => item.title), ["Planejamento", "Feriado"]);

  const edited = await app.inject({ method: "PATCH", url: `/v1/meetings/agenda/events/${event.id}`, headers: auth(tenantId), payload: { workspaceId, title: "Planejamento Q1", ...base, start: "2026-11-20T15:00", end: "2026-11-20T16:00" } });
  assert.equal(edited.json().data.title, "Planejamento Q1");
  assert.equal(edited.json().data.localVersion, 2);

  const done = await app.inject({ method: "POST", url: `/v1/meetings/agenda/events/${event.id}/complete`, headers: auth(tenantId), payload: { workspaceId } });
  assert.equal(done.json().data.status, "done");
  const editDone = await app.inject({ method: "PATCH", url: `/v1/meetings/agenda/events/${event.id}`, headers: auth(tenantId), payload: { workspaceId, title: "x" } });
  assert.equal(editDone.statusCode, 409);
  assert.equal(editDone.json().error.code, "CALENDAR_EVENT_TERMINAL");
  const cancelDone = await app.inject({ method: "POST", url: `/v1/meetings/agenda/events/${event.id}/cancel`, headers: auth(tenantId), payload: { workspaceId } });
  assert.equal(cancelDone.statusCode, 409, "concluído não volta a cancelado");

  const cancelled = await app.inject({ method: "POST", url: `/v1/meetings/agenda/events/${allDay.json().data.id}/cancel`, headers: auth(tenantId), payload: { workspaceId } });
  assert.equal(cancelled.json().data.status, "cancelled");
  const row = await db.pool.query(`select count(*)::int as n from calendar_events where id = $1`, [allDay.json().data.id]);
  assert.equal(row.rows[0].n, 1, "cancelar nunca apaga");
  await app.close();
});

test("AGENDA RBAC + isolamento: viewer não cria; editor vê só os seus; outro tenant/workspace não enxerga", async () => {
  const app = await buildTestApp();
  const a = await setupTenant("rbac");
  const b = await setupTenant("rbac-b");
  const otherWorkspace = await workspaces().create({ tenantId: a.tenantId, name: "Outro WS" });
  const payload = { workspaceId: a.workspaceId, title: "Evento", ...base, start: "2026-11-20T10:00", end: "2026-11-20T11:00" };
  assert.equal((await app.inject({ method: "POST", url: "/v1/meetings/agenda/events", headers: auth(a.tenantId, "viewer", "u-v"), payload })).statusCode, 403);
  const mine = (await app.inject({ method: "POST", url: "/v1/meetings/agenda/events", headers: auth(a.tenantId, "editor", "u-e"), payload: { ...payload, title: "Do editor" } })).json().data;
  const admins = (await app.inject({ method: "POST", url: "/v1/meetings/agenda/events", headers: auth(a.tenantId, "admin", "u-a"), payload: { ...payload, title: "Da gestão" } })).json().data;
  const range = "from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z";
  const editorList = await app.inject({ method: "GET", url: `/v1/meetings/agenda/events?workspaceId=${a.workspaceId}&${range}`, headers: auth(a.tenantId, "editor", "u-e") });
  assert.deepEqual(editorList.json().data.map((item) => item.title), ["Do editor"]);
  const adminList = await app.inject({ method: "GET", url: `/v1/meetings/agenda/events?workspaceId=${a.workspaceId}&${range}`, headers: auth(a.tenantId, "admin", "u-a") });
  assert.equal(adminList.json().data.length, 2);
  assert.equal((await app.inject({ method: "PATCH", url: `/v1/meetings/agenda/events/${admins.id}`, headers: auth(a.tenantId, "editor", "u-e"), payload: { workspaceId: a.workspaceId, title: "x" } })).statusCode, 404, "editor não altera evento de outra pessoa");
  assert.equal((await app.inject({ method: "GET", url: `/v1/meetings/agenda/events/${mine.id}?workspaceId=${a.workspaceId}`, headers: auth(b.tenantId) })).statusCode, 404, "outro tenant");
  assert.equal((await app.inject({ method: "GET", url: `/v1/meetings/agenda/events/${mine.id}?workspaceId=${otherWorkspace.id}`, headers: auth(a.tenantId) })).statusCode, 404, "outro workspace do mesmo tenant");
  const bList = await app.inject({ method: "GET", url: `/v1/meetings/agenda/events?workspaceId=${a.workspaceId}&${range}`, headers: auth(b.tenantId) });
  assert.equal(bList.json().data.length, 0);
  await app.close();
});

test("AGENDA sem Conversas + GRAVAR AUTOMATICAMENTE: prepara a reunião agendada vinculada (sem gravar)", async () => {
  const app = await buildTestApp();
  const { tenantId, workspaceId } = await setupTenant("auto");
  await solutions().setEntitlement({ tenantId, solutionKey: "conversations", enabled: false, source: "manual" });
  const created = await app.inject({ method: "POST", url: "/v1/meetings/agenda/events", headers: auth(tenantId), payload: { workspaceId, title: "Daily", ...base, start: "2026-11-20T09:00", end: "2026-11-20T09:30", location: "https://meet.google.com/abc-defg-hij", autoRecord: true, joinBeforeMinutes: 3, attendees: ["bia@cliente.com"] } });
  assert.equal(created.statusCode, 201, created.body);
  const { meetingId, id: eventId } = created.json().data;
  assert.ok(meetingId, "reunião criada junto");
  const meeting = (await db.pool.query(`select * from meetings where id = $1`, [meetingId])).rows[0];
  assert.equal(meeting.source, "calendar");
  assert.equal(meeting.status, "scheduled", "AGENDADA — nada de gravação nesta rodada");
  assert.equal(meeting.calendar_event_id, eventId);
  assert.equal(meeting.auto_record, true);
  assert.equal(meeting.join_before_minutes, 3);
  assert.equal(meeting.meeting_url, "https://meet.google.com/abc-defg-hij");

  await app.inject({ method: "PATCH", url: `/v1/meetings/agenda/events/${eventId}`, headers: auth(tenantId), payload: { workspaceId, ...base, start: "2026-11-20T10:00", end: "2026-11-20T10:30" } });
  assert.equal((await db.pool.query(`select scheduled_start_at from meetings where id = $1`, [meetingId])).rows[0].scheduled_start_at.toISOString(), "2026-11-20T13:00:00.000Z", "reunião acompanha a remarcação");
  await app.inject({ method: "POST", url: `/v1/meetings/agenda/events/${eventId}/cancel`, headers: auth(tenantId), payload: { workspaceId } });
  assert.equal((await db.pool.query(`select status from meetings where id = $1`, [meetingId])).rows[0].status, "cancelled");
  await app.close();
});

// --- Google: OAuth -----------------------------------------------------------------------------

function fakeGoogleOAuthFetch(state) {
  return async (url, init) => {
    const target = String(url);
    if (target.endsWith("/token")) {
      const body = new URLSearchParams(String(init.body));
      state.tokenCalls.push(body.get("grant_type"));
      if (body.get("grant_type") === "refresh_token" && state.refresh === "revoked") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      if (body.get("grant_type") === "refresh_token" && state.refresh === "down") return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ access_token: `at-${state.tokenCalls.length}`, refresh_token: "rt-1", expires_in: 3600 }), { status: 200 });
    }
    if (target.includes("userinfo")) return new Response(JSON.stringify({ email: "ana@empresa.com" }), { status: 200 });
    if (target.endsWith("/revoke")) return new Response("{}", { status: 200 });
    return new Response("{}", { status: 404 });
  };
}

function oauthService(state, secretManager, now = () => new Date()) {
  return new GoogleCalendarOAuthService({
    config: { enabled: true, clientId: "cid", clientSecret: "csecret", redirectUri: "https://app/callback", scopes: [] },
    connectionRepository: connections(),
    secretManager,
    stateSigningKey: Buffer.from("chave-de-teste-do-state"),
    httpClient: fakeGoogleOAuthFetch(state),
    now,
  });
}

test("GOOGLE OAUTH: state assinado (sem memória), connect, refresh, revogado e disconnect", async () => {
  const { tenantId, workspaceId } = await setupTenant("oauth");
  const state = { tokenCalls: [], refresh: "ok" };
  const secrets = new InMemorySecretManager();
  const service = oauthService(state, secrets);
  const { authorizationUrl } = service.begin({ tenantId, workspaceId, userId: "u-ana" });
  const signedState = new URL(authorizationUrl).searchParams.get("state");
  assert.match(new URL(authorizationUrl).searchParams.get("scope"), /calendar\.events/);
  assert.equal(new URL(authorizationUrl).searchParams.get("access_type"), "offline");

  // Outra instância do serviço (outra réplica/restart) valida o MESMO state: nada em memória.
  const other = oauthService(state, secrets);
  assert.throws(() => other.verifyState(`${signedState}x`), /CALENDAR_OAUTH_STATE_INVALID/);
  const deps = { connections: connections(), auth: other, now: () => new Date() };
  await assert.rejects(() => completeGoogleCalendarConnect(deps, { tenantId, userId: "u-outra" }, { state: signedState, code: "c" }), /outra conta/);
  const status = await completeGoogleCalendarConnect(deps, { tenantId, userId: "u-ana" }, { state: signedState, code: "c" });
  assert.equal(status.status, "connected");
  assert.equal(status.googleEmail, "ana@empresa.com");
  const expired = oauthService(state, secrets, () => new Date(Date.now() + 11 * 60_000));
  assert.throws(() => expired.verifyState(signedState), /expirado/);

  const owner = { tenantId, workspaceId, userId: "u-ana" };
  assert.equal((await other.getAccessToken(owner)).ok, true, "token válido em cache");
  // Força expiração do access token → refresh.
  const stored = await secrets.get(`calendar:${tenantId}:${workspaceId}:u-ana`);
  await secrets.put(`calendar:${tenantId}:${workspaceId}:u-ana`, { value: stored.value, expiresAt: new Date(Date.now() - 1000).toISOString() });
  const refreshed = await other.getAccessToken(owner);
  assert.equal(refreshed.ok, true);
  assert.ok(state.tokenCalls.includes("refresh_token"));
  await secrets.put(`calendar:${tenantId}:${workspaceId}:u-ana`, { value: stored.value, expiresAt: new Date(Date.now() - 1000).toISOString() });
  state.refresh = "down";
  assert.equal((await other.getAccessToken(owner)).reason, "transient", "Google fora do ar ≠ token revogado");
  state.refresh = "revoked";
  assert.equal((await other.getAccessToken(owner)).reason, "revoked");

  await other.disconnect(owner);
  assert.equal(await secrets.get(`calendar:${tenantId}:${workspaceId}:u-ana`), undefined, "tokens apagados");
  assert.equal((await connections().getByUser(owner)).status, "disconnected");
});

// --- Google: sync -------------------------------------------------------------------------------

class FakeGoogle {
  constructor() {
    this.events = new Map();
    this.version = 0;
    this.ids = 0;
    this.calls = [];
    this.expireSyncToken = false;
  }
  store(event) {
    this.version += 1;
    const saved = { ...event, etag: `"v${this.version}"`, updated: new Date(1_800_000_000_000 + this.version * 1000).toISOString(), _seq: this.version };
    this.events.set(saved.id, saved);
    return saved;
  }
  clean(event) {
    const { _seq, ...rest } = event;
    return structuredClone(rest);
  }
  remoteCreate(event) {
    this.ids += 1;
    return this.clean(this.store({ id: event.id ?? `remote${this.ids}`, status: "confirmed", ...event }));
  }
  remoteEdit(id, patch) {
    return this.clean(this.store({ ...this.events.get(id), ...patch }));
  }
  async listEvents({ syncToken }) {
    this.calls.push(syncToken ? "list:incremental" : "list:full");
    if (syncToken && this.expireSyncToken) {
      this.expireSyncToken = false;
      throw Object.assign(new Error("gone"), { status: 410 });
    }
    const since = syncToken ? Number(syncToken.slice(1)) : 0;
    const items = [...this.events.values()].filter((event) => event._seq > since && (syncToken || event.status !== "cancelled")).map((event) => this.clean(event));
    return { items, nextSyncToken: `t${this.version}` };
  }
  async getEvent({ eventId }) {
    return this.clean(this.events.get(eventId));
  }
  async insertEvent({ event, createMeet }) {
    this.calls.push("insert");
    this.ids += 1;
    const id = `google${this.ids}`;
    return this.clean(this.store({ ...event, id, status: "confirmed", ...(createMeet ? { hangoutLink: "https://meet.google.com/xyz-abcd-efg" } : {}) }));
  }
  async patchEvent({ eventId, event, ifMatchEtag }) {
    this.calls.push("patch");
    const current = this.events.get(eventId);
    if (!current) throw Object.assign(new Error("not found"), { status: 404 });
    if (ifMatchEtag && ifMatchEtag !== current.etag) throw Object.assign(new Error("precondition failed"), { status: 412 });
    return this.clean(this.store({ ...current, ...event }));
  }
  async deleteEvent({ eventId }) {
    this.calls.push("delete");
    const current = this.events.get(eventId);
    if (current) this.store({ ...current, status: "cancelled" });
  }
}

async function connectedAccount(label) {
  const { tenantId, workspaceId } = await setupTenant(label);
  const connection = await connections().upsert({ tenantId, workspaceId, userId: `u-${label}`, googleEmail: `${label}@empresa.com`, status: "connected" });
  return { tenantId, workspaceId, userId: `u-${label}`, connection };
}

function syncDeps(google, oauth = { getAccessToken: async () => ({ ok: true, accessToken: "at" }) }) {
  return { events: events(), connections: connections(), oauth, api: google, now: () => new Date(), intervalMs: 60_000, leaseMs: 60_000, fullSyncPastDays: 365 };
}

async function localEvent(account, patch = {}) {
  return events().create({ tenantId: account.tenantId, workspaceId: account.workspaceId, ownerUserId: account.userId, title: "Reunião local", startAt: "2026-11-20T13:00:00.000Z", endAt: "2026-11-20T14:00:00.000Z", timezone: "America/Sao_Paulo", attendees: [], source: "system", ...patch });
}

test("GOOGLE PULL: eventos, dia inteiro e OCORRÊNCIAS de recorrência como linhas próprias (sem colapsar no mestre)", async () => {
  const account = await connectedAccount("pull");
  const google = new FakeGoogle();
  google.remoteCreate({ id: "single1", summary: "Avulsa", start: { dateTime: "2026-11-20T10:00:00-03:00" }, end: { dateTime: "2026-11-20T11:00:00-03:00" } });
  google.remoteCreate({ id: "allday1", summary: "Dia todo", start: { date: "2026-11-21" }, end: { date: "2026-11-22" } });
  for (const day of ["23", "24", "25"]) {
    google.remoteCreate({ id: `weekly_202611${day}T130000Z`, recurringEventId: "weekly", summary: "Semanal", start: { dateTime: `2026-11-${day}T10:00:00-03:00`, timeZone: "America/Sao_Paulo" }, end: { dateTime: `2026-11-${day}T10:30:00-03:00` }, originalStartTime: { dateTime: `2026-11-${day}T10:00:00-03:00` } });
  }
  const report = await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "worker-1" });
  assert.equal(report.status, "synced");
  assert.equal(report.pulled, 5);
  assert.equal(report.fullResync, true);
  const rows = (await db.pool.query(`select google_event_id, google_recurring_event_id, all_day, start_at, source, local_version, synced_version from calendar_events where google_account_id = $1 order by start_at`, [account.connection.id])).rows;
  assert.equal(rows.filter((row) => row.google_recurring_event_id === "weekly").length, 3, "3 ocorrências = 3 linhas");
  assert.equal(new Set(rows.map((row) => row.google_event_id)).size, 5);
  const allDay = rows.find((row) => row.google_event_id === "allday1");
  assert.equal(allDay.all_day, true);
  assert.equal(allDay.start_at.toISOString(), "2026-11-21T03:00:00.000Z", "meia-noite em São Paulo");
  assert.ok(rows.every((row) => row.source === "google" && row.local_version === row.synced_version), "vindo do Google nasce sincronizado (sem push de volta)");
  const second = await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "worker-1" });
  assert.equal(second.pulled, 0, "incremental sem mudanças");
  assert.equal(second.pushed, 0, "nada volta para o Google (anti-eco)");
  assert.deepEqual(google.calls.filter((call) => call !== "list:full" && call !== "list:incremental"), []);
});

test("GOOGLE PUSH + MEET + ANTI-ECO: evento local vai para o Google uma vez e o pull seguinte não gera loop", async () => {
  const account = await connectedAccount("push");
  const google = new FakeGoogle();
  const event = await localEvent(account, { wantsMeetLink: true });
  const first = await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  assert.equal(first.pushed, 1);
  const synced = await events().getById(event.id);
  assert.ok(synced.googleEventId);
  assert.equal(synced.meetLink, "https://meet.google.com/xyz-abcd-efg", "link do Meet gerado na criação");
  assert.equal(synced.syncState, "ok");
  assert.equal(synced.syncedVersion, synced.localVersion);
  assert.equal(google.events.get(synced.googleEventId).extendedProperties.private.vorixEventId, event.id);

  const second = await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  assert.equal(second.echoes, 1, "o próprio insert volta no pull e é ignorado");
  assert.equal(second.pushed, 0);
  assert.equal(second.pulled, 0);
  const third = await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  assert.equal(third.pushed + third.pulled + third.echoes, 0, "estável: pull → save → push → pull não entra em loop");
  assert.equal(google.calls.filter((call) => call === "insert").length, 1);

  await events().applyLocalChange(event.id, { title: "Título editado no Vorix" });
  const fourth = await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  assert.equal(fourth.pushed, 1);
  assert.equal(google.events.get(synced.googleEventId).summary, "Título editado no Vorix");
  await events().applyLocalChange(event.id, { status: "cancelled" });
  await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  assert.equal(google.events.get(synced.googleEventId).status, "cancelled", "cancelamento local remove no Google");
  const logged = await connections().listLog({ tenantId: account.tenantId, connectionId: account.connection.id, limit: 50 });
  assert.ok(logged.some((entry) => entry.direction === "push" && entry.action === "create" && entry.status === "ok"));
  assert.ok(logged.some((entry) => entry.direction === "push" && entry.action === "delete"));
});

test("GOOGLE CONFLITO: os dois lados mudaram → nada é sobrescrito; resolução explícita (manter Vorix / aceitar Google)", async () => {
  const account = await connectedAccount("conflict");
  const google = new FakeGoogle();
  const event = await localEvent(account);
  await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  const googleId = (await events().getById(event.id)).googleEventId;

  google.remoteEdit(googleId, { summary: "Editado no Google" });
  await events().applyLocalChange(event.id, { title: "Editado no Vorix" });
  const report = await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  assert.equal(report.conflicts, 1);
  const conflicted = await events().getById(event.id);
  assert.equal(conflicted.syncState, "conflict");
  assert.equal(conflicted.title, "Editado no Vorix", "edição local preservada");
  assert.equal(google.events.get(googleId).summary, "Editado no Google", "Google não foi sobrescrito");
  assert.equal(conflicted.conflictRemote.summary, "Editado no Google", "snapshot remoto guardado para decisão");

  // Resolve mantendo o Vorix: reenvia sobre o etag atual do Google.
  const { resolveCalendarConflict } = await import("../dist/application/calendar/calendar-sync-use-cases.js");
  await resolveCalendarConflict({ events: events() }, { event: conflicted, keep: "local" });
  await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  assert.equal(google.events.get(googleId).summary, "Editado no Vorix");
  assert.equal((await events().getById(event.id)).syncState, "ok");

  // Novo conflito, agora aceitando a versão do Google.
  google.remoteEdit(googleId, { summary: "Versão do Google" });
  await events().applyLocalChange(event.id, { title: "Versão do Vorix" });
  await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  await resolveCalendarConflict({ events: events() }, { event: await events().getById(event.id), keep: "remote" });
  const accepted = await events().getById(event.id);
  assert.equal(accepted.title, "Versão do Google");
  assert.equal(accepted.syncState, "ok");
  const after = await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  assert.equal(after.pushed, 0, "aceitar o Google não reenvia nada");
});

test("GOOGLE 412 no push: mudança no Google entre o pull e o push vira conflito (If-Match)", async () => {
  const account = await connectedAccount("412");
  const google = new FakeGoogle();
  const event = await localEvent(account);
  await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  const googleId = (await events().getById(event.id)).googleEventId;
  await events().applyLocalChange(event.id, { title: "Local" });
  // O Google muda DEPOIS do pull e ANTES do push: simulamos com um pull que não vê a mudança.
  const api = Object.create(google);
  api.listEvents = async (input) => {
    const result = await google.listEvents(input);
    google.remoteEdit(googleId, { summary: "Mudou no meio" });
    return { items: result.items.filter((item) => item.id !== googleId), nextSyncToken: result.nextSyncToken };
  };
  const report = await syncConnection(syncDeps(api), { connectionId: account.connection.id, owner: "w" });
  assert.equal(report.conflicts, 1);
  assert.equal((await events().getById(event.id)).syncState, "conflict");
  assert.equal(google.events.get(googleId).summary, "Mudou no meio", "nunca sobrescreve");
});

test("GOOGLE estado TERMINAL: concluído no Vorix não volta a confirmado nem é cancelado por pull", async () => {
  const account = await connectedAccount("terminal");
  const google = new FakeGoogle();
  google.remoteCreate({ id: "evt-done", summary: "Visita", start: { dateTime: "2026-11-20T10:00:00-03:00" }, end: { dateTime: "2026-11-20T11:00:00-03:00" } });
  await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  const local = await events().findByGoogleEventId(account.connection.id, "evt-done");
  await events().applyLocalChange(local.id, { status: "done" });
  await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  google.remoteEdit("evt-done", { summary: "Visita (ajustada)" });
  await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  let current = await events().getById(local.id);
  assert.equal(current.status, "done", "edição remota não rebaixa o concluído");
  assert.equal(current.title, "Visita (ajustada)", "conteúdo do Google é aplicado");
  google.remoteEdit("evt-done", { status: "cancelled" });
  await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  current = await events().getById(local.id);
  assert.equal(current.status, "done", "cancelamento remoto não desfaz o concluído");
  const logged = await connections().listLog({ tenantId: account.tenantId, connectionId: account.connection.id, limit: 50 });
  assert.ok(logged.some((entry) => entry.action === "cancel_ignored_terminal"));
});

test("GOOGLE sync token expirado (410): refaz a carga completa sem duplicar", async () => {
  const account = await connectedAccount("410");
  const google = new FakeGoogle();
  google.remoteCreate({ id: "e1", summary: "Um", start: { dateTime: "2026-11-20T10:00:00Z" }, end: { dateTime: "2026-11-20T11:00:00Z" } });
  await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  google.remoteCreate({ id: "e2", summary: "Dois", start: { dateTime: "2026-11-21T10:00:00Z" }, end: { dateTime: "2026-11-21T11:00:00Z" } });
  google.expireSyncToken = true;
  const report = await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "w" });
  assert.equal(report.status, "synced");
  assert.equal(report.fullResync, true);
  const count = await db.pool.query(`select count(*)::int as n from calendar_events where google_account_id = $1`, [account.connection.id]);
  assert.equal(count.rows[0].n, 2);
  const logged = await connections().listLog({ tenantId: account.tenantId, connectionId: account.connection.id, limit: 50 });
  assert.ok(logged.some((entry) => entry.action === "sync_token_expired"));
});

test("GOOGLE token revogado → conexão em ERRO ('precisa ser reconectado'); falha transitória mantém conectada com backoff", async () => {
  const account = await connectedAccount("revoked");
  const google = new FakeGoogle();
  const transient = await syncConnection(syncDeps(google, { getAccessToken: async () => ({ ok: false, reason: "transient", message: "Google fora do ar" }) }), { connectionId: account.connection.id, owner: "w" });
  assert.equal(transient.status, "error");
  let connection = await connections().getById(account.connection.id);
  assert.equal(connection.status, "connected");
  assert.equal(connection.consecutiveFailures, 1);
  assert.ok(new Date(connection.nextSyncAt) > new Date(), "próxima tentativa adiada");
  const revoked = await syncConnection(syncDeps(google, { getAccessToken: async () => ({ ok: false, reason: "revoked", message: "invalid_grant" }) }), { connectionId: account.connection.id, owner: "w" });
  assert.equal(revoked.status, "reconnect_required");
  connection = await connections().getById(account.connection.id);
  assert.equal(connection.status, "error");
  assert.equal(connection.lastErrorMessage, "Google Calendar precisa ser reconectado.");
  const logged = await connections().listLog({ tenantId: account.tenantId, connectionId: account.connection.id, limit: 10 });
  assert.ok(logged.some((entry) => entry.direction === "auth" && entry.status === "error"));
});

test("LOCK DISTRIBUÍDO: dois processos nunca sincronizam a mesma conta; lease vencido libera para outro", async () => {
  const account = await connectedAccount("lock");
  const google = new FakeGoogle();
  const repo = connections();
  assert.ok(await repo.acquireSyncLease(account.connection.id, "worker-A", 200));
  assert.equal(await repo.acquireSyncLease(account.connection.id, "worker-B", 200), undefined, "B não pega enquanto A segura");
  const locked = await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "worker-B" });
  assert.equal(locked.status, "locked");
  assert.equal(google.calls.length, 0, "B não tocou no Google");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const recovered = await syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "worker-B" });
  assert.equal(recovered.status, "synced", "A morreu sem liberar: o lease venceu e B assumiu");
  // Simultâneo: dois syncs ao mesmo tempo → só um roda.
  const [one, two] = await Promise.all([
    syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "worker-C" }),
    syncConnection(syncDeps(google), { connectionId: account.connection.id, owner: "worker-D" }),
  ]);
  assert.deepEqual([one.status, two.status].sort(), ["locked", "synced"]);
});
