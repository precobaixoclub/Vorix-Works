import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { signWebhookPayload } from "../dist/application/webhook/webhook-signature-verifier.js";

function buildTestApp(role = "owner", env = {}) {
  return buildApp({
    config: loadApiConfig({
      AUTH_MODE: "noop",
      DEV_PRINCIPAL_TENANT_ID: "tenant-publication-api",
      DEV_PRINCIPAL_USER_ID: `user-${role}`,
      DEV_PRINCIPAL_ROLE: role,
      ZUNO_LOG_LEVEL: "silent",
      ...env,
    }),
  });
}

test("Publication API: cria plano inline, aprova, enfileira, worker publica e receipts ficam disponíveis", async () => {
  const app = await buildTestApp("owner");
  const workspaceId = "workspace-publication-api";
  const create = await app.inject({
    method: "POST",
    url: "/v1/publications",
    payload: {
      workspaceId,
      idempotencyKey: "publication-api-idem-1",
      artifacts: [{ id: "artifact-api-1", artifactType: "document", schemaId: "publication.manifest", schemaVersion: 1, checksum: "checksum-api-1", payload: { caption: "Olá" } }],
      channels: ["instagram"],
    },
  });
  assert.equal(create.statusCode, 200);
  const plan = create.json().data;
  assert.equal(plan.state, "waiting_for_approval");
  assert.equal(plan.mode, "dry_run");

  const approve = await app.inject({ method: "POST", url: `/v1/publications/${plan.id}/approve`, payload: { workspaceId, reason: "ok" } });
  assert.equal(approve.statusCode, 200);
  assert.equal(approve.json().data.plan.state, "approved");

  const publish = await app.inject({ method: "POST", url: `/v1/publications/${plan.id}/publish`, payload: { workspaceId, async: true } });
  assert.equal(publish.statusCode, 200);
  assert.equal(publish.json().data.enqueued, true);

  const queue = await app.inject({ method: "GET", url: "/v1/publications/queue" });
  assert.equal(queue.json().data.size, 1);

  const work = await app.inject({ method: "POST", url: "/v1/publications/operate/work" });
  assert.equal(work.statusCode, 200);
  assert.equal(work.json().data.processed, 1);

  const detail = await app.inject({ method: "GET", url: `/v1/publications/${plan.id}?workspaceId=${workspaceId}` });
  assert.equal(detail.json().data.plan.state, "published");
  assert.equal(detail.json().data.receipts.length, 1);

  const receipts = await app.inject({ method: "GET", url: `/v1/publications/${plan.id}/receipts?workspaceId=${workspaceId}` });
  assert.equal(receipts.json().data.length, 1);

  const metrics = await app.inject({ method: "GET", url: `/v1/publications/metrics?workspaceId=${workspaceId}` });
  assert.equal(metrics.json().data.publicationThroughput, 1);

  await app.close();
});

test("Publication API: publish síncrono também usa outbox durável", async () => {
  const app = await buildTestApp("owner");
  const workspaceId = "workspace-publication-api";
  const create = await app.inject({
    method: "POST",
    url: "/v1/publications",
    payload: {
      workspaceId,
      idempotencyKey: "publication-api-sync-outbox",
      artifacts: [{ id: "artifact-api-sync", artifactType: "document", schemaId: "publication.manifest", schemaVersion: 1, checksum: "checksum-api-sync", payload: { caption: "Sync" } }],
      channels: ["instagram"],
    },
  });
  const plan = create.json().data;
  await app.inject({ method: "POST", url: `/v1/publications/${plan.id}/approve`, payload: { workspaceId, reason: "ok" } });

  const publish = await app.inject({ method: "POST", url: `/v1/publications/${plan.id}/publish`, payload: { workspaceId, async: false } });
  assert.equal(publish.statusCode, 200);
  assert.equal(publish.json().data.plan.state, "published");
  assert.equal(publish.json().data.outbox[0].status, "dispatched");
  assert.equal(publish.json().data.receipts.length, 1);

  await app.close();
});

test("Publication API: Meta sandbox fora do canário cai para dry_run", async () => {
  const app = await buildTestApp("owner", {
    META_PAGES_SANDBOX_ENABLED: "true",
    META_APP_ID: "app-id",
    META_APP_SECRET: "app-secret",
    META_OAUTH_REDIRECT_URI: "https://zuno.test/oauth/callback",
    PUBLICATION_CANARY_ENABLED: "true",
    PUBLICATION_CANARY_TENANT_IDS: "tenant-publication-api",
    PUBLICATION_CANARY_WORKSPACE_IDS: "workspace-canary-only",
  });
  const workspaceId = "workspace-outside-canary";
  const create = await app.inject({
    method: "POST",
    url: "/v1/publications",
    payload: {
      workspaceId,
      idempotencyKey: "publication-api-meta-fallback",
      artifacts: [{ id: "artifact-api-meta", artifactType: "document", schemaId: "publication.manifest", schemaVersion: 1, checksum: "checksum-api-meta", payload: { caption: "Meta" } }],
      channels: ["facebook"],
      mode: "real",
      provider: "meta_pages_sandbox",
      policy: { requireApproval: false, approvalPolicy: "optional", allowedProviders: ["meta_pages_sandbox"], publishMode: "real" },
    },
  });
  assert.equal(create.statusCode, 200);
  const plan = create.json().data;
  assert.equal(plan.mode, "dry_run");
  assert.deepEqual(plan.policy.allowedProviders, ["dry_run"]);

  const detail = await app.inject({ method: "GET", url: `/v1/publications/${plan.id}?workspaceId=${workspaceId}` });
  assert.equal(detail.json().data.targets[0].provider, "dry_run");
  assert.equal(detail.json().data.targets[0].mode, "dry_run");
  await app.close();
});

test("Publication API RBAC: viewer lê, mas não cria/publica", async () => {
  const app = await buildTestApp("viewer");
  const list = await app.inject({ method: "GET", url: "/v1/publications?workspaceId=workspace-publication-api" });
  assert.equal(list.statusCode, 200);
  const create = await app.inject({
    method: "POST",
    url: "/v1/publications",
    payload: { workspaceId: "workspace-publication-api", idempotencyKey: "viewer", artifacts: [{ id: "a" }], channels: ["instagram"] },
  });
  assert.equal(create.statusCode, 403);
  const publish = await app.inject({ method: "POST", url: "/v1/publications/pub-1/publish", payload: { workspaceId: "workspace-publication-api" } });
  assert.equal(publish.statusCode, 403);
  await app.close();
});

test("Governance API: owner acessa credenciais, audit e compliance", async () => {
  const app = await buildTestApp("owner");
  const workspaceId = "workspace-governance-api";

  const credentials = await app.inject({ method: "GET", url: `/v1/credentials?workspaceId=${workspaceId}` });
  assert.equal(credentials.statusCode, 200);
  assert.deepEqual(credentials.json().data, []);

  const audit = await app.inject({ method: "GET", url: `/v1/audit?workspaceId=${workspaceId}` });
  assert.equal(audit.statusCode, 200);
  assert.deepEqual(audit.json().data, []);

  const auditExport = await app.inject({ method: "GET", url: `/v1/audit?workspaceId=${workspaceId}&format=csv` });
  assert.equal(auditExport.statusCode, 200);
  assert.equal(auditExport.json().data.contentType, "text/csv");

  const compliance = await app.inject({ method: "GET", url: `/v1/compliance?workspaceId=${workspaceId}` });
  assert.equal(compliance.statusCode, 200);
  assert.equal(compliance.json().data.overallStatus, "pass");

  await app.close();
});

test("Governance API RBAC: viewer não opera credenciais e tentativa é auditada", async () => {
  const app = await buildTestApp("viewer");
  const workspaceId = "workspace-governance-rbac";

  const rotate = await app.inject({ method: "POST", url: "/v1/credentials/rotate", payload: { workspaceId, credentialId: "credential-missing", reason: "viewer denied" } });
  assert.equal(rotate.statusCode, 403);

  await app.close();
});

test("Governance API: connect inicia OAuth pelo endpoint administrativo", async () => {
  const app = await buildTestApp("owner", {
    META_PAGES_SANDBOX_ENABLED: "true",
    META_APP_ID: "app-id",
    META_APP_SECRET: "app-secret",
    META_OAUTH_REDIRECT_URI: "https://zuno.test/oauth/callback",
  });
  const connect = await app.inject({ method: "POST", url: "/v1/credentials/connect", payload: { workspaceId: "workspace-governance-connect" } });
  assert.equal(connect.statusCode, 200);
  assert.ok(connect.json().data.authorizationUrl.includes("client_id=app-id"));
  assert.ok(connect.json().data.state);
  await app.close();
});

test("Provider/Webhook API: provider sandbox conectado publica, webhook assinado sincroniza receipt e audit", async () => {
  const workspaceId = "workspace-multi-provider-api";
  const app = await buildTestApp("owner", {
    PUBLICATION_CANARY_ENABLED: "true",
    PUBLICATION_CANARY_TENANT_IDS: "tenant-publication-api",
    PUBLICATION_CANARY_WORKSPACE_IDS: workspaceId,
  });

  const providers = await app.inject({ method: "GET", url: "/v1/providers" });
  assert.equal(providers.statusCode, 200);
  assert.equal(providers.json().data.some((provider) => provider.providerId === "linkedin_sandbox" && provider.oauthType === "oauth2_auth_code"), true);
  assert.equal(providers.json().data.some((provider) => provider.providerId === "x_sandbox" && provider.capabilities.webhooks), true);

  const connect = await app.inject({ method: "POST", url: "/v1/providers/linkedin_sandbox/connect", payload: { workspaceId } });
  assert.equal(connect.statusCode, 200);
  assert.equal(connect.json().data.connected, true);

  const create = await app.inject({
    method: "POST",
    url: "/v1/publications",
    payload: {
      workspaceId,
      idempotencyKey: "multi-provider-publication",
      artifacts: [{ id: "artifact-linkedin", artifactType: "document", schemaId: "publication.manifest", schemaVersion: 1, checksum: "checksum-linkedin", payload: { caption: "LinkedIn sandbox" } }],
      channels: ["linkedin"],
      mode: "real",
      provider: "linkedin_sandbox",
      policy: { requireApproval: false, approvalPolicy: "optional", allowedProviders: ["linkedin_sandbox"], publishMode: "real" },
    },
  });
  assert.equal(create.statusCode, 200);
  const plan = create.json().data;
  assert.equal(plan.mode, "real");

  const publish = await app.inject({ method: "POST", url: `/v1/publications/${plan.id}/publish`, payload: { workspaceId, async: false } });
  assert.equal(publish.statusCode, 200);
  assert.equal(publish.json().data.plan.state, "published");
  const target = publish.json().data.targets[0];
  const receipt = publish.json().data.receipts[0];
  assert.equal(receipt.provider, "linkedin_sandbox");

  const webhookPayload = {
    type: "receipt_updated",
    tenantId: "tenant-publication-api",
    workspaceId,
    publicationId: plan.id,
    targetId: target.id,
    providerPublicationId: receipt.providerPublicationId,
    providerRequestId: "webhook-request-1",
    idempotencyKey: target.idempotencyKey,
    channel: "linkedin",
    externalStatus: "updated",
    url: receipt.url,
    occurredAt: "2026-07-30T12:00:00.000Z",
  };
  const timestamp = new Date().toISOString();
  const nonce = "nonce-linkedin-1";
  const rawPayload = JSON.stringify(webhookPayload);
  const signature = signWebhookPayload({ secret: "linkedin-sandbox-webhook-secret", timestamp, nonce, rawPayload });
  const webhook = await app.inject({ method: "POST", url: "/webhooks/linkedin_sandbox", headers: { "x-zuno-signature": signature, "x-zuno-timestamp": timestamp, "x-zuno-nonce": nonce }, payload: webhookPayload });
  assert.equal(webhook.statusCode, 202);
  assert.equal(webhook.json().data.accepted, true);
  assert.equal(webhook.json().data.normalized, 1);
  assert.equal(webhook.json().data.synchronization.processed, 1);

  const detail = await app.inject({ method: "GET", url: `/v1/publications/${plan.id}?workspaceId=${workspaceId}` });
  assert.equal(detail.json().data.events.some((event) => event.eventType === "receipt_updated"), true);
  const audit = await app.inject({ method: "GET", url: `/v1/audit?workspaceId=${workspaceId}` });
  assert.equal(audit.json().data.some((event) => event.eventType === "publication.sync"), true);
  const webhooks = await app.inject({ method: "GET", url: `/v1/webhooks?workspaceId=${workspaceId}&providerId=linkedin_sandbox` });
  assert.equal(webhooks.json().data.metrics.received, 1);
  assert.equal(webhooks.json().data.metrics.processed, 1);

  const invalid = await app.inject({ method: "POST", url: "/webhooks/linkedin_sandbox", headers: { "x-zuno-signature": "bad", "x-zuno-timestamp": timestamp, "x-zuno-nonce": "nonce-invalid" }, payload: webhookPayload });
  assert.equal(invalid.statusCode, 400);
  const replay = await app.inject({ method: "POST", url: "/webhooks/linkedin_sandbox", headers: { "x-zuno-signature": signature, "x-zuno-timestamp": timestamp, "x-zuno-nonce": nonce }, payload: webhookPayload });
  assert.equal(replay.statusCode, 400);
  const metrics = await app.inject({ method: "GET", url: `/v1/webhooks?workspaceId=${workspaceId}&providerId=linkedin_sandbox` });
  assert.equal(metrics.json().data.metrics.invalidSignatures, 1);
  assert.equal(metrics.json().data.metrics.replayRejected, 1);

  const sync = await app.inject({ method: "GET", url: `/v1/publication-sync?workspaceId=${workspaceId}&providerId=linkedin_sandbox` });
  assert.equal(sync.statusCode, 200);
  assert.equal(sync.json().data.events.some((event) => event.status === "completed"), true);

  await app.close();
});
