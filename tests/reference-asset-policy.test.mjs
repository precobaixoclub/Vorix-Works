// Política única de reference assets (isolamento por tenant/workspace + SSRF). Nenhum teste faz
// requisição de rede real — `global.fetch` é trocado por um espião que falha se for chamado.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  authorizeReferenceAssetUrl,
  createReferenceAssetResolver,
  isReferenceAssetError,
  REFERENCE_ASSET_MAX_BYTES,
} from "../dist/application/assets/reference-asset-policy.js";
import { LocalObjectStorage } from "../dist/infrastructure/storage/local-object-storage.js";
import { authorizeProductionReferenceAssets } from "../dist/interfaces/api/routes/v1/production.route.js";

const BASE = "https://api.vorixworks.com/uploads";
const CONFIG = { publicBaseUrl: BASE };
const TENANT_A = { tenantId: "tenant-aaa", workspaceId: "workspace-a1", qaNamespaceAllowed: false };
const QA_SCOPE = { tenantId: "tenant-qa", workspaceId: "workspace-qa", qaNamespaceAllowed: true };

async function withNoNetwork(run) {
  const previous = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error("rede proibida neste teste");
  };
  try {
    await run();
  } finally {
    global.fetch = previous;
  }
  assert.equal(calls, 0, "a política nunca pode fazer requisição de rede");
}

test("TENANT_MANAGED_ASSET: upload de mídia e Asset Library do próprio workspace são autorizados (absoluto e relativo)", () => {
  for (const url of [
    `${BASE}/tenant-aaa/workspace-a1/9f1c-produto.jpg`,
    `${BASE}/assets/tenant-aaa/workspace-a1/9f1c-logo.png`,
    "/uploads/tenant-aaa/workspace-a1/9f1c-produto.jpg",
  ]) {
    const result = authorizeReferenceAssetUrl(url, TENANT_A, CONFIG);
    assert.equal(result.ok, true, `${url}: ${JSON.stringify(result)}`);
    assert.equal(result.category, "TENANT_MANAGED_ASSET");
  }
});

test("cross-tenant: tenant A nunca resolve asset gerenciado do tenant B (FORBIDDEN, mensagem genérica)", () => {
  const result = authorizeReferenceAssetUrl(`${BASE}/tenant-bbb/workspace-b1/segredo.jpg`, TENANT_A, CONFIG);
  assert.equal(result.ok, false);
  assert.equal(result.code, "REFERENCE_ASSET_FORBIDDEN");
  assert.equal(result.reasonCategory, "ownership_mismatch");
});

test("WORKSPACE_ONLY: mesmo tenant, outro workspace também é negado", () => {
  const result = authorizeReferenceAssetUrl(`${BASE}/assets/tenant-aaa/workspace-a2/logo.png`, TENANT_A, CONFIG);
  assert.equal(result.ok, false);
  assert.equal(result.code, "REFERENCE_ASSET_FORBIDDEN");
});

test("SYSTEM_QA_ASSET: permitido só com homologação editorial comprovada", () => {
  const url = `${BASE}/qa-assets/editorial-smoke-a-d27d82a/product-ring-reminder.jpg`;
  const allowed = authorizeReferenceAssetUrl(url, QA_SCOPE, CONFIG);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.category, "SYSTEM_QA_ASSET");

  const normalTenant = authorizeReferenceAssetUrl(url, TENANT_A, CONFIG);
  assert.equal(normalTenant.ok, false);
  assert.equal(normalTenant.code, "REFERENCE_ASSET_FORBIDDEN");
  assert.equal(normalTenant.reasonCategory, "qa_namespace_not_authorized");
});

test("QA namespace: tentativas de escapar do namespace são negadas mesmo para o tenant QA", () => {
  for (const url of [
    `${BASE}/qa-assets/../tenant-bbb/workspace-b1/segredo.jpg`,
    `${BASE}/qa-assets/%2e%2e/tenant-bbb/workspace-b1/segredo.jpg`,
    `${BASE}/qa-assets/editorial/..%2f..%2fetc%2fpasswd`,
    `${BASE}/qa-assets/editorial/sub/deep.jpg`,
    `${BASE}/qa-assets/editorial\\..\\..\\segredo.jpg`,
    `${BASE}/qa-assets//product.jpg`,
    `${BASE}/qa-assets/editorial/%00product.jpg`,
  ]) {
    const result = authorizeReferenceAssetUrl(url, QA_SCOPE, CONFIG);
    assert.equal(result.ok, false, url);
  }
});

test("path traversal em chaves gerenciadas é bloqueado (literal, codificado, barra invertida)", () => {
  for (const url of [
    `${BASE}/tenant-aaa/workspace-a1/../../tenant-bbb/workspace-b1/x.jpg`,
    `${BASE}/tenant-aaa/workspace-a1/%2e%2e%2f%2e%2e%2fx.jpg`,
    "/uploads/../../etc/passwd",
    `${BASE}/tenant-aaa/workspace-a1/.%2e/x.jpg`,
    `${BASE}/tenant-aaa\\workspace-a1\\x.jpg`,
  ]) {
    const result = authorizeReferenceAssetUrl(url, TENANT_A, CONFIG);
    assert.equal(result.ok, false, url);
  }
});

test("SSRF: localhost, loopback, metadata, RFC1918, link-local, hostname interno, outros schemes e externos são negados sem rede", async () => {
  await withNoNetwork(async () => {
    for (const url of [
      "http://127.0.0.1/uploads/tenant-aaa/workspace-a1/x.jpg",
      "https://127.0.0.1/uploads/tenant-aaa/workspace-a1/x.jpg",
      "https://localhost/uploads/tenant-aaa/workspace-a1/x.jpg",
      "https://[::1]/uploads/tenant-aaa/workspace-a1/x.jpg",
      "https://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "https://10.0.0.5/uploads/x.jpg",
      "https://192.168.1.10/uploads/x.jpg",
      "https://172.16.0.1/uploads/x.jpg",
      "https://[fe80::1]/uploads/x.jpg",
      "https://[::ffff:127.0.0.1]/uploads/x.jpg",
      "https://2130706433/uploads/x.jpg",
      "https://zuno-postgres:5432/",
      "https://zuno-api:3000/uploads/tenant-aaa/workspace-a1/x.jpg",
      "https://api.vorixworks.com:8443/uploads/tenant-aaa/workspace-a1/x.jpg",
      "https://api.vorixworks.com.evil.example/uploads/tenant-aaa/workspace-a1/x.jpg",
      "https://user:pass@api.vorixworks.com/uploads/tenant-aaa/workspace-a1/x.jpg",
      "http://api.vorixworks.com/uploads/tenant-aaa/workspace-a1/x.jpg",
      "https://cdn.example.com/produto.jpg",
      "file:///etc/passwd",
      "ftp://api.vorixworks.com/uploads/tenant-aaa/workspace-a1/x.jpg",
      "gopher://127.0.0.1:6379/_INFO",
      "data:image/png;base64,iVBORw0KGgo=",
      "javascript:alert(1)",
      `${BASE}/tenant-aaa/workspace-a1/x.jpg?redirect=http://169.254.169.254`,
      `${BASE}/gpt-creative-engine/tenant-aaa/x.jpg`,
      `${BASE}/../../internal`,
    ]) {
      const result = authorizeReferenceAssetUrl(url, TENANT_A, CONFIG);
      assert.equal(result.ok, false, url);
      assert.ok(["REFERENCE_ASSET_SOURCE_NOT_ALLOWED", "REFERENCE_ASSET_INVALID", "REFERENCE_ASSET_FORBIDDEN"].includes(result.code), `${url}: ${result.code}`);
    }
  });
});

test("resolver: referência negada nunca chega ao storage; autorizada lê pela chave com o teto de bytes", async () => {
  const reads = [];
  const resolver = createReferenceAssetResolver(CONFIG, { read: async (key, options) => { reads.push({ key, ...options }); return Buffer.from("ok"); } });
  await withNoNetwork(async () => {
    await assert.rejects(resolver.load("https://169.254.169.254/latest/meta-data/", TENANT_A), (error) => isReferenceAssetError(error) && error.code === "REFERENCE_ASSET_SOURCE_NOT_ALLOWED");
    await assert.rejects(resolver.load(`${BASE}/tenant-bbb/workspace-b1/x.jpg`, TENANT_A), (error) => error.code === "REFERENCE_ASSET_FORBIDDEN" && !/tenant-bbb/.test(error.message));
    assert.equal(reads.length, 0);
    const buffer = await resolver.load(`${BASE}/tenant-aaa/workspace-a1/x.jpg`, TENANT_A);
    assert.equal(buffer.toString(), "ok");
  });
  assert.deepEqual(reads, [{ key: "tenant-aaa/workspace-a1/x.jpg", maxBytes: REFERENCE_ASSET_MAX_BYTES }]);
});

test("LocalObjectStorage.read: lê o objeto, recusa acima do limite antes de ler, objeto ausente, traversal e symlink que escapa do root", async () => {
  const root = await mkdtemp(join(tmpdir(), "vorix-ref-root-"));
  const outside = await mkdtemp(join(tmpdir(), "vorix-ref-outside-"));
  try {
    await mkdir(join(root, "tenant-aaa", "workspace-a1"), { recursive: true });
    await writeFile(join(root, "tenant-aaa", "workspace-a1", "x.jpg"), Buffer.alloc(1000, 1));
    await writeFile(join(outside, "secret.jpg"), Buffer.from("secret"));
    const storage = new LocalObjectStorage({ rootDir: root, publicBaseUrl: BASE });

    assert.equal((await storage.read("tenant-aaa/workspace-a1/x.jpg", { maxBytes: 5000 })).length, 1000);
    await assert.rejects(storage.read("tenant-aaa/workspace-a1/x.jpg", { maxBytes: 999 }), (error) => error.code === "REFERENCE_ASSET_TOO_LARGE");
    await assert.rejects(storage.read("tenant-aaa/workspace-a1/missing.jpg", { maxBytes: 5000 }), (error) => error.code === "REFERENCE_ASSET_NOT_FOUND");
    await assert.rejects(storage.read("../outside/secret.jpg", { maxBytes: 5000 }), (error) => error.code === "REFERENCE_ASSET_INVALID");

    let symlinkCreated = true;
    try {
      await symlink(join(outside, "secret.jpg"), join(root, "tenant-aaa", "workspace-a1", "link.jpg"));
    } catch {
      symlinkCreated = false; // Windows sem privilégio de symlink — coberto no runtime Linux.
    }
    if (symlinkCreated) {
      await assert.rejects(storage.read("tenant-aaa/workspace-a1/link.jpg", { maxBytes: 5000 }), (error) => error.code === "REFERENCE_ASSET_INVALID" && error.reasonCategory === "symlink_escape");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------------
// Ponto de entrada HTTP (`POST /production/ideas/generate`) — autoriza antes da visão da OpenAI.
// ---------------------------------------------------------------------------------------------

const routeResolver = createReferenceAssetResolver(CONFIG, { read: async () => { throw new Error("rota nunca lê"); } });
const routeDeps = {
  referenceAssetResolver: routeResolver,
  editorialQaAllowlist: [{ tenantId: "tenant-qa", workspaceId: "workspace-qa" }],
  featureFlags: { creativeEngineEditorialExperimentalEnabled: true },
};

test("rota: referência do próprio workspace passa; externa, cross-tenant e rede interna são 403 antes de qualquer IA", () => {
  const logs = [];
  authorizeProductionReferenceAssets({ workspaceId: "workspace-a1", referenceImages: [`${BASE}/tenant-aaa/workspace-a1/p.jpg`] }, "tenant-aaa", routeDeps, (line) => logs.push(line));
  for (const url of ["https://cdn.example.com/p.jpg", `${BASE}/tenant-bbb/workspace-b1/p.jpg`, "http://127.0.0.1:3000/uploads/x.jpg"]) {
    assert.throws(
      () => authorizeProductionReferenceAssets({ workspaceId: "workspace-a1", referenceAssets: [{ url, role: "product_photo" }] }, "tenant-aaa", routeDeps, (line) => logs.push(line)),
      (error) => error.statusCode === 403 && !/tenant-bbb/.test(error.message),
      url,
    );
  }
  assert.ok(logs.every((line) => !/https?:\/\//.test(line)), "log sanitizado nunca carrega a URL");
});

test("rota: qa-assets só com modo editorial + flag + allowlist do tenant/workspace", () => {
  const qa = { workspaceId: "workspace-qa", referenceAssets: [{ url: `${BASE}/qa-assets/editorial-smoke-a-d27d82a/product-ring-reminder.jpg`, role: "product_photo" }] };
  authorizeProductionReferenceAssets({ ...qa, creativeEngineCompositionMode: "editorial_experimental" }, "tenant-qa", routeDeps, () => undefined);
  assert.throws(() => authorizeProductionReferenceAssets(qa, "tenant-qa", routeDeps, () => undefined), (error) => error.statusCode === 403);
  assert.throws(() => authorizeProductionReferenceAssets({ ...qa, creativeEngineCompositionMode: "editorial_experimental" }, "tenant-aaa", routeDeps, () => undefined), (error) => error.statusCode === 403);
  assert.throws(() => authorizeProductionReferenceAssets({ ...qa, creativeEngineCompositionMode: "editorial_experimental" }, "tenant-qa", { ...routeDeps, featureFlags: { creativeEngineEditorialExperimentalEnabled: false } }, () => undefined), (error) => error.statusCode === 403);
});

test("rota: sem storage gerenciado configurado, qualquer referência falha fechado", () => {
  assert.throws(() => authorizeProductionReferenceAssets({ workspaceId: "workspace-a1", referenceImages: [`${BASE}/tenant-aaa/workspace-a1/p.jpg`] }, "tenant-aaa", { ...routeDeps, referenceAssetResolver: undefined }, () => undefined), (error) => error.statusCode === 403);
  authorizeProductionReferenceAssets({ workspaceId: "workspace-a1" }, "tenant-aaa", { ...routeDeps, referenceAssetResolver: undefined }, () => undefined);
});
