import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildApp } from "../dist/interfaces/api/app.js";
import { loadApiConfig } from "../dist/interfaces/api/config/api-config.js";
import { resolvePublicUrl } from "../dist/infrastructure/storage/s3-object-storage.js";
import { DisabledObjectStorage } from "../dist/infrastructure/storage/disabled-object-storage.js";
import { LocalObjectStorage } from "../dist/infrastructure/storage/local-object-storage.js";

class TestTokenAuthPort {
  async verifyToken(token) {
    if (!token) return { authenticated: false, reason: "missing_token" };
    const [tenantId, role = "owner"] = token.split(":");
    return { authenticated: true, principal: { userId: "test-user", tenantId, role, sessionId: "test-session" } };
  }
}

class FakeObjectStorage {
  constructor() {
    this.puts = [];
  }
  async health() {
    return { ok: true };
  }
  async put(input) {
    this.puts.push(input);
    return { url: `https://cdn.test/${input.key}` };
  }
  async delete() {}
}

function buildMultipartBody(boundary, fieldName, filename, contentType, data) {
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return Buffer.concat([Buffer.from(head, "utf8"), Buffer.from(data), Buffer.from(tail, "utf8")]);
}

function buildTestApp(objectStorage) {
  const config = loadApiConfig({ AUTH_MODE: "noop", MEDIA_UPLOAD_MAX_BYTES: "5000000" });
  return buildApp({ config, container: { authPort: new TestTokenAuthPort(), objectStorage } });
}

// ---------------------------------------------------------------------------------------------
// resolvePublicUrl (pure)
// ---------------------------------------------------------------------------------------------

test("resolvePublicUrl: publicBaseUrl explícito tem prioridade", () => {
  const url = resolvePublicUrl({ region: "auto", bucket: "b", publicBaseUrl: "https://cdn.exemplo.com/", accessKeyId: "x", secretAccessKey: "y" }, "t/w/1.jpg");
  assert.equal(url, "https://cdn.exemplo.com/t/w/1.jpg");
});

test("resolvePublicUrl: endpoint com forcePathStyle usa /bucket/key (R2/Spaces path-style)", () => {
  const url = resolvePublicUrl({ region: "auto", bucket: "meu-bucket", endpoint: "https://abc123.r2.cloudflarestorage.com", forcePathStyle: true, accessKeyId: "x", secretAccessKey: "y" }, "t/w/1.jpg");
  assert.equal(url, "https://abc123.r2.cloudflarestorage.com/meu-bucket/t/w/1.jpg");
});

test("resolvePublicUrl: endpoint sem forcePathStyle usa subdomínio do bucket (virtual-hosted style)", () => {
  const url = resolvePublicUrl({ region: "nyc3", bucket: "meu-bucket", endpoint: "https://nyc3.digitaloceanspaces.com", forcePathStyle: false, accessKeyId: "x", secretAccessKey: "y" }, "t/w/1.jpg");
  assert.equal(url, "https://meu-bucket.nyc3.digitaloceanspaces.com/t/w/1.jpg");
});

test("resolvePublicUrl: sem endpoint nem publicBaseUrl, deriva a URL padrão do AWS S3", () => {
  const url = resolvePublicUrl({ region: "us-east-1", bucket: "meu-bucket", accessKeyId: "x", secretAccessKey: "y" }, "t/w/1.jpg");
  assert.equal(url, "https://meu-bucket.s3.us-east-1.amazonaws.com/t/w/1.jpg");
});

// ---------------------------------------------------------------------------------------------
// DisabledObjectStorage
// ---------------------------------------------------------------------------------------------

test("DisabledObjectStorage: falha fechado com mensagem clara em put/delete, health reporta indisponível", async () => {
  const storage = new DisabledObjectStorage();
  const health = await storage.health();
  assert.equal(health.ok, false);
  await assert.rejects(() => storage.put({ key: "x", body: Buffer.from(""), contentType: "image/jpeg" }), /OBJECT_STORAGE_NOT_CONFIGURED/);
  await assert.rejects(() => storage.delete("x"), /OBJECT_STORAGE_NOT_CONFIGURED/);
});

test("LocalObjectStorage: salva em disco e devolve URL pública codificada", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "zuno-upload-"));
  try {
    const storage = new LocalObjectStorage({ rootDir, publicBaseUrl: "https://api.test/uploads/" });
    const result = await storage.put({ key: "tenant/workspace/minha foto.jpg", body: Buffer.from("img"), contentType: "image/jpeg" });

    assert.equal(result.url, "https://api.test/uploads/tenant/workspace/minha%20foto.jpg");
    assert.equal(await readFile(join(rootDir, "tenant", "workspace", "minha foto.jpg"), "utf8"), "img");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("GET /uploads/*: serve arquivo salvo no storage local", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "zuno-upload-route-"));
  try {
    await writeFile(join(rootDir, "foto.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const config = loadApiConfig({
      AUTH_MODE: "noop",
      OBJECT_STORAGE_ENABLED: "true",
      OBJECT_STORAGE_DRIVER: "local",
      OBJECT_STORAGE_LOCAL_DIR: rootDir,
      OBJECT_STORAGE_PUBLIC_BASE_URL: "https://api.test/uploads",
      MEDIA_UPLOAD_MAX_BYTES: "5000000",
    });
    const app = await buildApp({ config, container: { authPort: new TestTokenAuthPort() } });

    const response = await app.inject({ method: "GET", url: "/uploads/foto.png" });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /^image\/png/);
    assert.deepEqual(response.rawPayload, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await app.close();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// POST /v1/publication-media/upload
// ---------------------------------------------------------------------------------------------

test("POST /v1/publication-media/upload: sobe imagem válida e devolve URL pública", async () => {
  const objectStorage = new FakeObjectStorage();
  const app = await buildTestApp(objectStorage);
  const boundary = "----zunotestboundary";
  const body = buildMultipartBody(boundary, "file", "foto.jpg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const response = await app.inject({
    method: "POST",
    url: "/v1/publication-media/upload?workspaceId=workspace-1",
    headers: { authorization: "Bearer tenant-1", "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });

  assert.equal(response.statusCode, 200);
  const parsed = response.json();
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.contentType, "image/jpeg");
  assert.match(parsed.data.url, /^https:\/\/cdn\.test\//);
  assert.equal(objectStorage.puts.length, 1);
  assert.match(objectStorage.puts[0].key, /^tenant-1\/workspace-1\/.+\.jpg$/);
});

test("POST /v1/publication-media/upload: tipo não suportado é rejeitado com 400", async () => {
  const objectStorage = new FakeObjectStorage();
  const app = await buildTestApp(objectStorage);
  const boundary = "----zunotestboundary2";
  const body = buildMultipartBody(boundary, "file", "arquivo.txt", "text/plain", Buffer.from("conteudo"));

  const response = await app.inject({
    method: "POST",
    url: "/v1/publication-media/upload?workspaceId=workspace-1",
    headers: { authorization: "Bearer tenant-1", "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(objectStorage.puts.length, 0);
});

test("POST /v1/publication-media/upload: sem autenticação responde 401", async () => {
  const objectStorage = new FakeObjectStorage();
  const app = await buildTestApp(objectStorage);
  const response = await app.inject({ method: "POST", url: "/v1/publication-media/upload?workspaceId=workspace-1" });
  assert.equal(response.statusCode, 401);
});
