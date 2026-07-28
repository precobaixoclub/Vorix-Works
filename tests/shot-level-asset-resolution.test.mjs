import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalVisualAssetLibrary, VisualAssetResolver } from "../dist/infrastructure/visual-assets/index.js";

// PNG mínimo (8x8 vermelho) para testes que só precisam de arquivo real no disco.
function writePng(path) {
  const data = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x04, 0x38, 0x00, 0x00, 0x07, 0x80,
    0x08, 0x02, 0x00, 0x00, 0x00, 0xbe, 0xf0, 0x76,
    0x5b, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0x99, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa4, 0x9a, 0xf6,
    0x35, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return writeFile(path, data);
}

function license(name = "CC0") {
  return { name, allowsCommercialUse: true, requiresAttribution: false };
}

function shotQuery(overrides = {}) {
  return {
    executionId: "exec-shot-asset",
    sceneOrder: 1,
    sceneName: "Gancho",
    theme: "casal com celular",
    emotion: "tranquilidade",
    narrativeFunction: "gancho",
    desiredKind: "photo",
    requiredTags: ["casamento", "casal", "celular"],
    targetWidth: 1080,
    targetHeight: 1920,
    targetAspectRatio: "9:16",
    shotId: "s1-shot-1",
    shotOrder: 1,
    shotPurpose: "detail",
    ...overrides,
  };
}

async function withTempDir(callback) {
  const dir = await mkdtemp(join(tmpdir(), "zuno-shot-asset-"));
  try {
    await callback(dir);
  } finally {
    // Cleanup opcional — os tests que criam artifacts não interferem entre si.
  }
}

test("SHOT-LEVEL ASSET RESOLUTION: cada query per-Shot devolve exatamente 1 asset com selectionReason preenchido", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    await mkdir(libraryDir, { recursive: true });
    await writePng(join(libraryDir, "asset-a.png"));
    await writePng(join(libraryDir, "asset-b.png"));
    await writeFile(join(libraryDir, "manifest.json"), JSON.stringify([
      { id: "asset-a", path: "asset-a.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular", "detail"], theme: "casal-celular-a", emotion: "tranquilidade", kind: "photo" },
      { id: "asset-b", path: "asset-b.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular", "reaction"], theme: "casal-celular-b", emotion: "tranquilidade", kind: "photo" },
    ], null, 2));

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    const result = await resolver.resolve({
      executionId: "exec-shot-asset",
      scenes: [
        shotQuery({ shotId: "s1-shot-1", shotOrder: 1, shotPurpose: "detail" }),
        shotQuery({ shotId: "s1-shot-2", shotOrder: 2, shotPurpose: "reaction" }),
      ],
    });

    assert.equal(result.resolved.length, 2);
    for (const entry of result.resolved) {
      assert.ok(entry.selectionReason, "cada Shot deve ter selectionReason");
      assert.ok(entry.selectionReason.startsWith("score:") || entry.selectionReason.startsWith("continuity_reuse") || entry.selectionReason.startsWith("shot_reuse_fallback"));
      assert.ok(entry.shotId);
    }
    // Diversidade: Shots vizinhos NÃO recebem o mesmo asset.
    assert.notEqual(result.resolved[0].asset.id, result.resolved[1].asset.id);
  });
});

test("SHOT-LEVEL ASSET RESOLUTION: continuityGroup permite reuso legítimo do mesmo asset entre Shots do grupo", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    await mkdir(libraryDir, { recursive: true });
    await writePng(join(libraryDir, "asset-a.png"));
    await writePng(join(libraryDir, "asset-b.png"));
    await writeFile(join(libraryDir, "manifest.json"), JSON.stringify([
      { id: "asset-a", path: "asset-a.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular"], theme: "casal-celular-a", emotion: "tranquilidade", kind: "photo" },
      { id: "asset-b", path: "asset-b.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular"], theme: "casal-celular-b", emotion: "tranquilidade", kind: "photo" },
    ], null, 2));

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    // Ambos os Shots pertencem ao mesmo continuityGroup — devem receber o MESMO asset.
    const result = await resolver.resolve({
      executionId: "exec-continuity",
      scenes: [
        shotQuery({ shotId: "s1-shot-1", shotOrder: 1, continuityGroup: "same-couple" }),
        shotQuery({ shotId: "s1-shot-2", shotOrder: 2, continuityGroup: "same-couple" }),
      ],
    });

    assert.equal(result.resolved.length, 2);
    assert.equal(result.resolved[0].asset.id, result.resolved[1].asset.id, "continuidade deveria reutilizar o mesmo asset");
    assert.equal(result.resolved[1].reusedFromShotId, "s1-shot-1");
    assert.ok(result.resolved[1].selectionReason?.startsWith("continuity_reuse"));
    assert.equal(result.resolved[0].continuityGroup, "same-couple");
    assert.equal(result.resolved[1].continuityGroup, "same-couple");
  });
});

test("SHOT-LEVEL ASSET RESOLUTION: reuse fallback quando biblioteca menor que # de shots (nunca cai em pending)", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    await mkdir(libraryDir, { recursive: true });
    // Apenas 1 asset na biblioteca para 3 shots — o resolver deve reutilizar em vez de fazer pending.
    await writePng(join(libraryDir, "unico.png"));
    await writeFile(join(libraryDir, "manifest.json"), JSON.stringify([
      { id: "unico", path: "unico.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular"], theme: "casal-celular", emotion: "tranquilidade", kind: "photo" },
    ], null, 2));

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    const result = await resolver.resolve({
      executionId: "exec-reuse-fallback",
      scenes: [
        shotQuery({ shotId: "s1-shot-1", shotOrder: 1 }),
        shotQuery({ shotId: "s1-shot-2", shotOrder: 2 }),
        shotQuery({ shotId: "s1-shot-3", shotOrder: 3 }),
      ],
    });

    // Todos os 3 Shots devem ter asset — nunca cai em pending quando há candidato.
    assert.equal(result.resolved.length, 3);
    assert.equal(result.pending.length, 0);
    // Shot 1 é o primeiro a receber; Shots 2 e 3 reutilizam.
    assert.equal(result.resolved[0].asset.id, "unico");
    for (let i = 1; i < 3; i++) {
      assert.equal(result.resolved[i].asset.id, "unico");
      assert.ok(
        result.resolved[i].selectionReason?.includes("shot_reuse_fallback") || result.resolved[i].reusedFromShotId,
        "Shots subsequentes devem indicar reuso",
      );
    }
  });
});

test("SHOT-LEVEL ASSET RESOLUTION: productRequirement.strict filtra candidatos sem tags de produto", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    await mkdir(libraryDir, { recursive: true });
    await writePng(join(libraryDir, "generic.png"));
    await writePng(join(libraryDir, "product.png"));
    await writeFile(join(libraryDir, "manifest.json"), JSON.stringify([
      { id: "generic", path: "generic.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular"], theme: "generic", emotion: "tranquilidade", kind: "photo" },
      { id: "product", path: "product.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular", "produto-real", "interface", "screenshot"], theme: "product", emotion: "tranquilidade", kind: "mockup" },
    ], null, 2));

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    const result = await resolver.resolve({
      executionId: "exec-strict-product",
      scenes: [
        shotQuery({
          shotId: "s1-shot-1",
          shotOrder: 1,
          shotPurpose: "product",
          productRequirement: { productName: "Rumo ao Altar", strict: true },
        }),
      ],
    });

    assert.equal(result.resolved.length, 1);
    assert.equal(result.resolved[0].asset.id, "product", "strict product deveria rejeitar 'generic' e escolher 'product'");
  });
});

test("SHOT-LEVEL ASSET RESOLUTION: humanRequirement.strict filtra candidatos sem tags humanas", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    await mkdir(libraryDir, { recursive: true });
    await writePng(join(libraryDir, "mockup-only.png"));
    await writePng(join(libraryDir, "human.png"));
    await writeFile(join(libraryDir, "manifest.json"), JSON.stringify([
      { id: "mockup-only", path: "mockup-only.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "celular", "mockup", "interface"], theme: "mockup", emotion: "tranquilidade", kind: "mockup" },
      { id: "human", path: "human.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "noivos", "celular", "pessoa", "contexto-humano"], theme: "casal-humano", emotion: "tranquilidade", kind: "photo" },
    ], null, 2));

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    const result = await resolver.resolve({
      executionId: "exec-strict-human",
      scenes: [
        shotQuery({
          shotId: "s1-shot-1",
          shotOrder: 1,
          shotPurpose: "human_interaction",
          humanRequirement: { subject: "casal", strict: true },
        }),
      ],
    });

    assert.equal(result.resolved.length, 1);
    assert.equal(result.resolved[0].asset.id, "human", "strict human deveria rejeitar 'mockup-only' e escolher 'human'");
  });
});

test("SHOT-LEVEL ASSET RESOLUTION: Developer Assisted Mode gera pacote per-Shot com caminho scene-XX-shot-YY.png", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    await mkdir(libraryDir, { recursive: true });
    // Biblioteca vazia — força pending.
    await writeFile(join(libraryDir, "manifest.json"), "[]");

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    const result = await resolver.resolve({
      executionId: "exec-dam-shot",
      scenes: [
        shotQuery({ shotId: "s2-shot-3", shotOrder: 3, sceneOrder: 2 }),
      ],
    });

    assert.equal(result.resolved.length, 0);
    assert.equal(result.pending.length, 1);
    // Caminho do pacote inclui shot- (não só scene-).
    assert.ok(
      result.pending[0].expectedRelativePath.includes("scene-02-shot-03"),
      `esperava caminho com shot-XX; recebeu ${result.pending[0].expectedRelativePath}`,
    );
  });
});
