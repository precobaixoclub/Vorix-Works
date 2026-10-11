// /uploads privado por padrão: URL assinada curta por chave, objetos públicos explícitos, isolamento
// tenant/workspace (404), traversal/symlink bloqueados, consumidores internos assinando no uso.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { registerSignedObjectUrlResponses, createObjectKeyReadAuthorizer } from "../dist/interfaces/api/object-url-access.js";
import { configureObjectUrlSigning, signObjectKey, signOwnedUrl, stripObjectUrlSignature, parseOwnedObjectUrl, verifyObjectSignature, classifyObjectKeyOwner, OBJECT_URL_TTL } from "../dist/shared/utils/object-url-signing.js";
import { fetchAsBuffer } from "../dist/application/creative-engine/run-gpt-creative-engine.js";
import { OpenAiIcaroTextProvider } from "../dist/infrastructure/ai-providers/openai-icaro-text-provider.js";
import { createReferenceAssetResolver } from "../dist/application/assets/reference-asset-policy.js";

const BASE = "https://api.test/uploads";
const KEY = Buffer.alloc(32, 7);
let clock = Date.UTC(2026, 9, 11, 12, 0, 0);

class TestTokenAuthPort {
  async verifyToken(token) {
    if (!token) return { authenticated: false, reason: "missing_token" };
    return { authenticated: true, principal: { userId: `user-${token}`, tenantId: token, role: "owner", sessionId: "s", isPlatformAdmin: false } };
  }
}

let rootDir;
let outsideDir;
let app;
let wsA1;
let wsA2;
let wsB1;

const pathOf = (url) => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};
const canonical = (key) => `${BASE}/${key}`;
const auth = (tenant) => ({ authorization: `Bearer ${tenant}` });

before(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "vorix-uploads-sec-"));
  outsideDir = await mkdtemp(join(tmpdir(), "vorix-uploads-outside-"));
  const config = loadApiConfig({
    AUTH_MODE: "noop",
    OBJECT_STORAGE_ENABLED: "true",
    OBJECT_STORAGE_DRIVER: "local",
    OBJECT_STORAGE_LOCAL_DIR: rootDir,
    OBJECT_STORAGE_PUBLIC_BASE_URL: BASE,
    MEDIA_UPLOAD_MAX_BYTES: "5000000",
  });
  app = await buildApp({ config, container: { authPort: new TestTokenAuthPort() } });
  // Chave e relógio controlados pelo teste (expiração/adulteração determinísticas).
  configureObjectUrlSigning({ publicBaseUrl: BASE, signingKey: KEY, now: () => clock });
  const repo = app.zunoContainer.workspaceRepository;
  wsA1 = (await repo.create({ tenantId: "tenant-A", name: "A1" })).id;
  wsA2 = (await repo.create({ tenantId: "tenant-A", name: "A2" })).id;
  wsB1 = (await repo.create({ tenantId: "tenant-B", name: "B1" })).id;
  const files = {
    [`assets/tenant-A/${wsA1}/a.png`]: "A1",
    [`assets/tenant-A/${wsA2}/a2.png`]: "A2",
    [`assets/tenant-A/${wsB1}/forged.png`]: "forged",
    [`assets/tenant-B/${wsB1}/b.png`]: "B1",
    ["gpt-creative-engine/tenant-A/final.jpg"]: "final",
    ["qa-assets/editorial/logo.png"]: "qa",
    ["public-ok/tenant-A/banner.png"]: "public",
  };
  for (const [key, body] of Object.entries(files)) {
    await mkdir(join(rootDir, ...key.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(rootDir, ...key.split("/")), body);
  }
  await writeFile(join(outsideDir, "secret.txt"), "SECRET");
});

after(async () => {
  await app?.close();
  await rm(rootDir, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

async function sign(tenant, url) {
  return app.inject({ method: "POST", url: "/v1/files/sign", headers: { ...auth(tenant), "content-type": "application/json" }, payload: { url } });
}

test("A: owner autenticado assina a própria chave e lê → 200 (cache privado)", async () => {
  const signed = await sign("tenant-A", canonical(`assets/tenant-A/${wsA1}/a.png`));
  assert.equal(signed.statusCode, 200, signed.body);
  const read = await app.inject({ method: "GET", url: pathOf(signed.json().data.url) });
  assert.equal(read.statusCode, 200);
  assert.equal(read.body, "A1");
  assert.match(read.headers["cache-control"], /^private/);
  // saída do motor (chave só de tenant) também
  const final = await sign("tenant-A", canonical("gpt-creative-engine/tenant-A/final.jpg"));
  assert.equal(final.statusCode, 200);
});

test("B: mesmo tenant no prefixo, mas workspace de OUTRO tenant → 404", async () => {
  const response = await sign("tenant-A", canonical(`assets/tenant-A/${wsB1}/forged.png`));
  assert.equal(response.statusCode, 404);
  const unknownWorkspace = await sign("tenant-A", canonical("assets/tenant-A/workspace-nao-existe/a.png"));
  assert.equal(unknownWorkspace.statusCode, 404);
});

test("C: outro tenant → 404 (nunca 403), e a resposta JSON não assina a chave alheia", async () => {
  const response = await sign("tenant-B", canonical(`assets/tenant-A/${wsA1}/a.png`));
  assert.equal(response.statusCode, 404);
  const engine = await sign("tenant-B", canonical("gpt-creative-engine/tenant-A/final.jpg"));
  assert.equal(engine.statusCode, 404);
  const qa = await sign("tenant-B", canonical("qa-assets/editorial/logo.png"));
  assert.equal(qa.statusCode, 404, "fixtures de QA só para a allowlist de QA");
});

test("D: arquivo privado sem auth/sem assinatura → bloqueado (404); assinar exige autenticação", async () => {
  const unsigned = await app.inject({ method: "GET", url: `/uploads/assets/tenant-A/${wsA1}/a.png` });
  assert.equal(unsigned.statusCode, 404);
  const noAuth = await app.inject({ method: "POST", url: "/v1/files/sign", headers: { "content-type": "application/json" }, payload: { url: canonical(`assets/tenant-A/${wsA1}/a.png`) } });
  assert.equal(noAuth.statusCode, 401);
});

test("E: objeto público EXPLÍCITO (com motivo persistido) é servido sem assinatura; os demais continuam privados", async () => {
  await app.zunoContainer.publicObjectRepository.markPublic({ objectKey: "public-ok/tenant-A/banner.png", tenantId: "tenant-A", reason: "teste: peça publicada" });
  const response = await app.inject({ method: "GET", url: "/uploads/public-ok/tenant-A/banner.png" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["cache-control"], /^public/);
  await app.zunoContainer.publicObjectRepository.unmarkPublic("public-ok/tenant-A/banner.png");
  assert.equal((await app.inject({ method: "GET", url: "/uploads/public-ok/tenant-A/banner.png" })).statusCode, 404);
});

test("F: chave inexistente (mesmo assinada) → 404", async () => {
  const response = await app.inject({ method: "GET", url: pathOf(signObjectKey(`assets/tenant-A/${wsA1}/nao-existe.png`, 600)) });
  assert.equal(response.statusCode, 404);
});

test("G/H: path traversal cru e codificado → bloqueado (404), nunca lê fora da raiz", async () => {
  for (const url of ["/uploads/../../etc/passwd", "/uploads/%2e%2e/%2e%2e/etc/passwd", "/uploads/assets/%2e%2e%2f%2e%2e%2fsecret", "/uploads/..%5c..%5csecret", "/uploads/%00", "/uploads/a/./b"]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 404, url);
  }
  assert.equal(parseOwnedObjectUrl(`${BASE}/assets/%2e%2e/x.png`), undefined);
  assert.equal(parseOwnedObjectUrl(`${BASE}/assets/../x.png`), undefined);
  const signTraversal = await sign("tenant-A", `${BASE}/assets/tenant-A/${wsA1}/..%2F..%2Fsecret`);
  assert.equal(signTraversal.statusCode, 404);
});

test("I: symlink/junção apontando para fora da raiz nunca é servido, mesmo com assinatura válida", async () => {
  await symlink(outsideDir, join(rootDir, "escape"), process.platform === "win32" ? "junction" : "dir");
  const response = await app.inject({ method: "GET", url: pathOf(signObjectKey("escape/secret.txt", 600)) });
  assert.equal(response.statusCode, 404);
  assert.ok(!response.body.includes("SECRET"));
});

test("J: URL assinada expirada → bloqueada", async () => {
  const signed = signObjectKey(`assets/tenant-A/${wsA1}/a.png`, OBJECT_URL_TTL.preview);
  assert.equal((await app.inject({ method: "GET", url: pathOf(signed) })).statusCode, 200);
  const original = clock;
  clock += 2 * 60 * 60 * 1000;
  try {
    assert.equal((await app.inject({ method: "GET", url: pathOf(signed) })).statusCode, 404);
  } finally {
    clock = original;
  }
});

test("K: assinatura do asset A aplicada ao asset B (ou exp alterado) → bloqueada", async () => {
  const signedA = new URL(signObjectKey(`assets/tenant-A/${wsA1}/a.png`, 600));
  const swapped = `/uploads/assets/tenant-B/${wsB1}/b.png${signedA.search}`;
  assert.equal((await app.inject({ method: "GET", url: swapped })).statusCode, 404);
  const params = new URLSearchParams(signedA.search);
  params.set("exp", String(Number(params.get("exp")) + 3600));
  assert.equal((await app.inject({ method: "GET", url: `${signedA.pathname}?${params}` })).statusCode, 404);
  assert.equal(verifyObjectSignature(`assets/tenant-A/${wsA1}/a.png`, params.get("exp"), params.get("sig")), "INVALID");
  // Validade além do teto nunca é aceita.
  assert.equal(verifyObjectSignature("x", String(Math.floor(clock / 1000) + 30 * 24 * 3600), "a".repeat(43)), "INVALID");
});

test("L: consumidores internos assinam no uso — download do motor e image_url enviado à OpenAI", async () => {
  const owned = canonical("gpt-creative-engine/tenant-A/final.jpg");
  const seen = [];
  const previous = global.fetch;
  global.fetch = async (url) => {
    seen.push(String(url));
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) };
  };
  try {
    await fetchAsBuffer(owned);
    await fetchAsBuffer("https://provider.example/image.png");
  } finally {
    global.fetch = previous;
  }
  assert.match(seen[0], /\?exp=\d+&sig=[A-Za-z0-9_-]{43}$/);
  assert.equal(stripObjectUrlSignature(seen[0]), owned);
  assert.equal(seen[1], "https://provider.example/image.png", "URL de fora nunca é alterada");

  let body;
  const provider = new OpenAiIcaroTextProvider({ getApiKey: async () => "sk-test" }, async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "{}" } }] }), text: async () => "" };
  });
  await provider.execute({ taskType: "review", prompt: "x", model: "", temperature: 0, maxTokens: 10, timeoutMs: 5000, imageUrls: [owned, "data:image/png;base64,AA=="] });
  const urls = body.messages[0].content.filter((part) => part.type === "image_url").map((part) => part.image_url.url);
  assert.match(urls[0], /\?exp=\d+&sig=/);
  assert.equal(urls[1], "data:image/png;base64,AA==");

  // Reference assets continuam lidos por CHAVE (sem HTTP); URL assinada vinda do frontend é aceita.
  const reads = [];
  const resolver = createReferenceAssetResolver({ publicBaseUrl: BASE }, { read: async (key) => { reads.push(key); return Buffer.from("x"); } });
  const signedRef = signOwnedUrl(canonical(`assets/tenant-A/${wsA1}/a.png`), 600);
  const loaded = await resolver.load(signedRef, { tenantId: "tenant-A", workspaceId: wsA1, qaNamespaceAllowed: false });
  assert.ok(loaded);
  assert.deepEqual(reads, [`assets/tenant-A/${wsA1}/a.png`]);
});

test("M: Asset Library — registro grava a URL canônica; a listagem devolve URL assinada que abre (preview)", async () => {
  const signedUpload = signOwnedUrl(canonical(`assets/tenant-A/${wsA1}/a.png`), 600);
  const registered = await app.inject({
    method: "POST",
    url: "/v1/assets",
    headers: { ...auth("tenant-A"), "content-type": "application/json" },
    payload: { workspaceId: wsA1, kind: "logo", name: "Logo", storageRef: { provider: "object_storage", objectKey: `assets/tenant-A/${wsA1}/a.png`, metadata: { url: signedUpload, contentType: "image/png" } } },
  });
  assert.equal(registered.statusCode, 200, registered.body);
  const assetId = registered.json().data.id;
  const stored = await app.zunoContainer.assetLibraryRepository.getAsset(assetId);
  assert.equal(stored.storageRef.metadata.url, canonical(`assets/tenant-A/${wsA1}/a.png`), "persistida sem assinatura");

  const list = await app.inject({ method: "GET", url: `/v1/assets?workspaceId=${wsA1}`, headers: auth("tenant-A") });
  assert.equal(list.statusCode, 200, list.body);
  const previewUrl = JSON.stringify(list.json()).match(/https:\/\/api\.test\/uploads\/[^"]+/)[0];
  assert.match(previewUrl, /\?exp=\d+&sig=/);
  assert.equal((await app.inject({ method: "GET", url: pathOf(previewUrl) })).statusCode, 200);

  // outro tenant não enxerga o asset (e nem recebe a URL assinada)
  const other = await app.inject({ method: "GET", url: `/v1/assets?workspaceId=${wsA1}`, headers: auth("tenant-B") });
  assert.equal(other.statusCode, 404);
});

test("Respostas JSON: só as chaves do próprio tenant saem assinadas; as alheias ficam canônicas (inacessíveis)", async () => {
  const mini = Fastify();
  mini.decorateRequest("zunoContext", null);
  mini.addHook("onRequest", async (request) => {
    request.zunoContext = { principal: { userId: "u", tenantId: "tenant-A", role: "owner", sessionId: "s", isPlatformAdmin: false } };
  });
  registerSignedObjectUrlResponses(mini, {
    publicBaseUrl: BASE,
    authorize: createObjectKeyReadAuthorizer({ workspaceRepository: app.zunoContainer.workspaceRepository, qaTenantIds: [] }),
  });
  mini.get("/x", async () => ({ mine: canonical("gpt-creative-engine/tenant-A/final.jpg"), theirs: canonical("gpt-creative-engine/tenant-B/final.jpg"), external: "https://other.example/x.png" }));
  const response = await mini.inject({ method: "GET", url: "/x" });
  const data = response.json();
  assert.match(data.mine, /\?exp=\d+&sig=/);
  assert.equal(data.theirs, canonical("gpt-creative-engine/tenant-B/final.jpg"));
  assert.equal(data.external, "https://other.example/x.png");
  await mini.close();
});

test("classifyObjectKeyOwner: layout do storage → dono (workspace, tenant, QA, desconhecido)", () => {
  assert.deepEqual(classifyObjectKeyOwner("assets/tenant-A/ws-1/a.png"), { kind: "workspace", tenantId: "tenant-A", workspaceId: "ws-1" });
  assert.deepEqual(classifyObjectKeyOwner("tenant-A/ws-1/a.png"), { kind: "workspace", tenantId: "tenant-A", workspaceId: "ws-1" });
  assert.deepEqual(classifyObjectKeyOwner("ai-generated/tenant-A/x.png"), { kind: "tenant", tenantId: "tenant-A" });
  assert.deepEqual(classifyObjectKeyOwner("qa-assets/editorial/logo.png"), { kind: "system_qa", namespace: "editorial" });
  assert.equal(classifyObjectKeyOwner("random/file.png"), undefined);
  assert.equal(classifyObjectKeyOwner("assets/not-a-tenant/ws/a.png"), undefined);
});

test("Log de acesso nunca grava a assinatura nem tokens de query (sig/media_token/avatar_token/stream_token)", async () => {
  const { redactSensitiveQuery, redactedRequestSerializer } = await import("../dist/interfaces/api/http/log-redaction.js");
  assert.equal(redactSensitiveQuery("/uploads/a/b.png?exp=123&sig=AbC-_xyz"), "/uploads/a/b.png?exp=123&sig=[REDACTED]");
  assert.equal(redactSensitiveQuery("/v1/inbox/media/m1?media_token=eyJ.abc.def"), "/v1/inbox/media/m1?media_token=[REDACTED]");
  assert.equal(redactSensitiveQuery("/v1/inbox/stream?x=1&stream_token=t&y=2"), "/v1/inbox/stream?x=1&stream_token=[REDACTED]&y=2");
  assert.equal(redactSensitiveQuery("/v1/assets?workspaceId=w"), "/v1/assets?workspaceId=w");
  const serialized = redactedRequestSerializer({ method: "GET", url: "/uploads/k?exp=1&sig=SECRET", hostname: "h", ip: "1.2.3.4", socket: { remotePort: 9 } });
  assert.ok(!JSON.stringify(serialized).includes("SECRET"));
  assert.equal(serialized.method, "GET");
});
