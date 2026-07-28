import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LocalVisualAssetLibrary, VisualAssetResolver } from "../dist/infrastructure/visual-assets/index.js";

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "zuno-visual-assets-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createPngHeader(width, height) {
  const bytes = Buffer.alloc(33, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 2;
  return bytes;
}

async function writePng(filePath, width = 1080, height = 1920) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, createPngHeader(width, height));
}

function baseQuery(overrides = {}) {
  return {
    executionId: "exec-assets",
    sceneOrder: 1,
    sceneName: "Gancho",
    theme: "Casal usando celular para acessar o site oficial do casamento",
    emotion: "tranquilidade",
    narrativeFunction: "mostrar organização e confiança",
    desiredKind: "photo",
    framing: "meio corpo",
    movement: "push-in suave",
    lighting: "luz natural",
    composition: "regra dos terços",
    requiredTags: ["casamento", "casal", "celular", "site"],
    targetWidth: 1080,
    targetHeight: 1920,
    targetAspectRatio: "9:16",
    brandKeywords: ["Rumo ao Altar"],
    ...overrides,
  };
}

function license(name = "CC0") {
  return {
    name,
    url: "https://example.test/license",
    allowsCommercialUse: true,
    requiresAttribution: false,
  };
}

test("VisualAssetResolver seleciona asset local, registra licença e gera relatório", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    const imagePath = join(libraryDir, "casal-celular-site.png");
    await writePng(imagePath);
    await writeFile(join(libraryDir, "manifest.json"), JSON.stringify([
      {
        id: "casal-celular-site",
        path: "casal-celular-site.png",
        provider: "local-test",
        origin: "local_library",
        author: "Equipe Zuno",
        sourceUrl: "local://casal-celular-site",
        license: license("Arquivo próprio"),
        tags: ["casamento", "casal", "celular", "site", "rumo-ao-altar"],
        theme: "Casal usando celular no casamento",
        emotion: "tranquilidade",
        kind: "photo",
      },
    ], null, 2), "utf8");

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    const result = await resolver.resolve({ executionId: "exec-assets", scenes: [baseQuery()] });

    assert.equal(result.pending.length, 0);
    assert.equal(result.resolved.length, 1);
    assert.equal(result.resolved[0].asset.id, "casal-celular-site");
    assert.equal(result.resolved[0].asset.license.name, "Arquivo próprio");
    assert.equal(result.resolved[0].asset.origin, "local_library");
    assert.ok(result.resolved[0].score >= 62);
    assert.equal(result.reportRelativePath, "visual-assets/asset-report.json");
    const report = JSON.parse(await readFile(join(dir, "artifacts", "exec-assets", "visual-assets", "asset-report.json"), "utf8"));
    assert.equal(report.resolved[0].asset.id, "casal-celular-site");
  });
});

test("LocalVisualAssetLibrary lê dimensões e duração reais de um asset de vídeo (kind: video) via inspeção do próprio FFmpeg", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    const videoPath = join(libraryDir, "casal-caminhando.mp4");
    await mkdir(libraryDir, { recursive: true });

    const { spawnSync } = await import("node:child_process");
    const ffmpeg = (await import("ffmpeg-static")).default;
    const buildResult = spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=608x1080:duration=3:rate=30", "-pix_fmt", "yuv420p", videoPath]);
    assert.equal(buildResult.status, 0, buildResult.stderr?.toString());

    await writeFile(join(libraryDir, "manifest.json"), JSON.stringify([
      {
        id: "casal-caminhando",
        path: "casal-caminhando.mp4",
        provider: "local-test",
        origin: "local_library",
        license: license("Arquivo próprio"),
        tags: ["casamento", "casal", "b-roll"],
        theme: "Casal caminhando no jardim",
        emotion: "romance",
        kind: "video",
      },
    ], null, 2), "utf8");

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    const result = await resolver.resolve({
      executionId: "exec-assets",
      scenes: [baseQuery({ requiredTags: ["casamento", "casal", "b-roll"] })],
    });

    assert.equal(result.resolved.length, 1);
    const asset = result.resolved[0].asset;
    assert.equal(asset.id, "casal-caminhando");
    assert.equal(asset.kind, "video");
    assert.equal(asset.width, 608);
    assert.equal(asset.height, 1080);
    assert.ok(asset.durationSeconds >= 2.9 && asset.durationSeconds <= 3.1, `duração lida: ${asset.durationSeconds}`);
  });
});

test("VisualAssetResolver aceita provider gratuito/futuro via porta abstrata", async () => {
  await withTempDir(async (dir) => {
    const imagePath = join(dir, "free", "rsvp.png");
    await writePng(imagePath);
    const fakeFreeProvider = {
      providerId: "fake-free-provider",
      async search() {
        return {
          assets: [{
            id: "free-rsvp",
            provider: "fake-free-provider",
            origin: "free_provider",
            absolutePath: imagePath,
            author: "Autor Externo",
            sourceUrl: "https://free.example.test/rsvp",
            license: license("Licença gratuita teste"),
            downloadedAt: "2026-07-13T00:00:00.000Z",
            tags: ["casamento", "rsvp", "celular", "site", "produto-real", "mockup", "interface"],
            theme: "RSVP no celular",
            emotion: "tranquilidade",
            width: 1080,
            height: 1920,
            aspectRatio: "9:16",
            kind: "photo",
          }],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeFreeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({
      executionId: "exec-assets",
      scenes: [baseQuery({ requiredTags: ["rsvp", "celular"], sceneName: "RSVP" })],
    });

    assert.equal(result.pending.length, 0);
    assert.equal(result.resolved[0].asset.origin, "free_provider");
    assert.equal(result.resolved[0].asset.author, "Autor Externo");
    assert.equal(result.resolved[0].asset.license.name, "Licença gratuita teste");
  });
});

test("VisualAssetResolver prioriza asset real do produto sobre foto genérica quando a cena exige interface", async () => {
  await withTempDir(async (dir) => {
    const genericPath = join(dir, "generic-decoration.png");
    const productPath = join(dir, "product-mockup.png");
    await writePng(genericPath, 1080, 1920);
    await writePng(productPath, 1080, 1920);
    const fakeProvider = {
      providerId: "product-priority-provider",
      async search() {
        return {
          assets: [
            {
              id: "generic-decoration",
              provider: "product-priority-provider",
              origin: "local_library",
              absolutePath: genericPath,
              license: license(),
              tags: ["casamento", "decoracao", "velas", "site"],
              theme: "decoração de casamento com velas",
              emotion: "romantismo",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "photo",
            },
            {
              id: "site-official-product-mockup",
              provider: "product-priority-provider",
              origin: "local_library",
              absolutePath: productPath,
              license: license("Arquivo próprio"),
              tags: ["casamento", "rumo-ao-altar", "site", "produto-real", "mockup", "interface", "rsvp"],
              theme: "mockup real do site oficial do casamento no celular",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "mockup",
            },
          ],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({
      executionId: "exec-assets",
      scenes: [baseQuery({
        desiredKind: "mockup",
        sceneName: "Demonstração do site oficial",
        requiredTags: ["casamento", "site", "produto-real", "mockup", "interface", "rsvp"],
        forbiddenTags: ["vela", "decoracao", "generico"],
      })],
    });

    assert.equal(result.pending.length, 0);
    assert.equal(result.resolved[0].asset.id, "site-official-product-mockup");
    assert.ok(result.resolved[0].scoreBreakdown.semanticMatch >= 80);
    assert.ok(result.resolved[0].scoreBreakdown.requirementCoverage >= 80);
  });
});

test("VisualAssetResolver prioriza pessoa usando produto quando a cena exige composição humana", async () => {
  await withTempDir(async (dir) => {
    const mockupPath = join(dir, "mockup.png");
    const personPath = join(dir, "person-product.png");
    await writePng(mockupPath, 1080, 1920);
    await writePng(personPath, 1080, 1920);
    const fakeProvider = {
      providerId: "human-product-priority-provider",
      async search() {
        return {
          assets: [
            {
              id: "isolated-product-mockup",
              provider: "human-product-priority-provider",
              origin: "local_library",
              absolutePath: mockupPath,
              license: license("Arquivo próprio"),
              tags: ["casamento", "site", "produto-real", "mockup", "interface"],
              theme: "mockup isolado do site oficial",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "mockup",
            },
            {
              id: "couple-using-product",
              provider: "human-product-priority-provider",
              origin: "local_library",
              absolutePath: personPath,
              license: license("Arquivo próprio"),
              tags: ["casamento", "casal", "pessoa", "celular", "site", "produto-real", "pessoa-usando-produto"],
              theme: "casal usando celular com site oficial do casamento",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "photo",
            },
          ],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({
      executionId: "exec-assets",
      scenes: [baseQuery({
        desiredKind: "photo",
        sceneName: "Gancho humano",
        requiredTags: ["casamento", "casal", "pessoa", "celular", "site", "pessoa-usando-produto", "produto-real"],
      })],
    });

    assert.equal(result.pending.length, 0);
    assert.equal(result.resolved[0].asset.id, "couple-using-product");
  });
});

test("VisualAssetResolver não usa mockup isolado quando a cena exige foto humana", async () => {
  await withTempDir(async (dir) => {
    const mockupPath = join(dir, "mockup.png");
    await writePng(mockupPath, 1080, 1920);
    const fakeProvider = {
      providerId: "strict-photo-provider",
      async search() {
        return {
          assets: [{
            id: "isolated-product-mockup",
            provider: "strict-photo-provider",
            origin: "local_library",
            absolutePath: mockupPath,
            license: license("Arquivo próprio"),
            tags: ["casamento", "casal", "celular", "site", "produto-real", "mockup", "interface", "pessoa-usando-produto"],
            theme: "mockup isolado do site oficial com tags humanas indevidas",
            emotion: "tranquilidade",
            width: 1080,
            height: 1920,
            aspectRatio: "9:16",
            kind: "mockup",
          }],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({
      executionId: "exec-assets",
      scenes: [baseQuery({
        desiredKind: "photo",
        sceneName: "Gancho humano",
        requiredTags: ["casamento", "casal", "pessoa", "celular", "site", "pessoa-usando-produto", "produto-real"],
      })],
    });

    assert.equal(result.resolved.length, 0);
    assert.equal(result.pending.length, 1);
    assert.match(result.warnings.join("\n"), /abaixo da nota mínima|criação assistida pendente/);
  });
});

test("VisualAssetResolver não sacrifica aderência funcional apenas para variar asset", async () => {
  await withTempDir(async (dir) => {
    const sitePath = join(dir, "site-mockup.png");
    const rsvpPath = join(dir, "rsvp-mockup.png");
    const giftsPath = join(dir, "gifts-mockup.png");
    await writePng(sitePath, 1080, 1920);
    await writePng(rsvpPath, 1080, 1920);
    await writePng(giftsPath, 1080, 1920);
    const fakeProvider = {
      providerId: "functional-priority-provider",
      async search() {
        return {
          assets: [
            {
              id: "site-product-mockup",
              provider: "functional-priority-provider",
              origin: "local_library",
              absolutePath: sitePath,
              license: license("Arquivo próprio"),
              tags: ["casamento", "rumo-ao-altar", "site", "produto-real", "mockup", "interface", "celular"],
              theme: "mockup real do site oficial do Rumo ao Altar",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "mockup",
            },
            {
              id: "rsvp-product-mockup",
              provider: "functional-priority-provider",
              origin: "local_library",
              absolutePath: rsvpPath,
              license: license("Arquivo próprio"),
              tags: ["casamento", "rumo-ao-altar", "site", "produto-real", "mockup", "interface", "rsvp"],
              theme: "mockup real do RSVP do Rumo ao Altar",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "mockup",
            },
            {
              id: "gifts-product-mockup",
              provider: "functional-priority-provider",
              origin: "local_library",
              absolutePath: giftsPath,
              license: license("Arquivo próprio"),
              tags: ["casamento", "rumo-ao-altar", "site", "produto-real", "mockup", "interface", "presentes", "pix"],
              theme: "mockup real da lista de presentes com Pix",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "mockup",
            },
          ],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({
      executionId: "exec-assets",
      scenes: [
        baseQuery({
          sceneOrder: 1,
          sceneName: "Site oficial",
          desiredKind: "mockup",
          requiredTags: ["casamento", "site", "produto-real", "mockup", "interface", "celular"],
        }),
        baseQuery({
          sceneOrder: 2,
          sceneName: "RSVP 2",
          desiredKind: "mockup",
          requiredTags: ["casamento", "site", "produto-real", "mockup", "interface", "rsvp"],
        }),
      ],
    });

    assert.equal(result.pending.length, 0);
    assert.deepEqual(result.resolved.map((entry) => entry.asset.id), ["site-product-mockup", "rsvp-product-mockup"]);
  });
});

test("VisualAssetResolver usa overview apenas em cenas de visão geral, sem roubar cenas funcionais", async () => {
  await withTempDir(async (dir) => {
    const overviewPath = join(dir, "overview-mockup.png");
    const giftsPath = join(dir, "gifts-mockup.png");
    await writePng(overviewPath, 1080, 1920);
    await writePng(giftsPath, 1080, 1920);
    const fakeProvider = {
      providerId: "overview-provider",
      async search() {
        return {
          assets: [
            {
              id: "overview-product-mockup",
              provider: "overview-provider",
              origin: "local_library",
              absolutePath: overviewPath,
              license: license("Arquivo próprio"),
              tags: ["casamento", "rumo-ao-altar", "site", "overview", "produto-real", "mockup", "interface"],
              theme: "visão geral do site com rsvp, presentes, álbum e cronograma em um só lugar",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "mockup",
            },
            {
              id: "gifts-product-mockup",
              provider: "overview-provider",
              origin: "local_library",
              absolutePath: giftsPath,
              license: license("Arquivo próprio"),
              tags: ["casamento", "rumo-ao-altar", "site", "presentes", "pix", "produto-real", "mockup", "interface"],
              theme: "mockup real da lista de presentes com Pix",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "mockup",
            },
          ],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({
      executionId: "exec-assets",
      scenes: [
        baseQuery({
          sceneOrder: 1,
          sceneName: "Descoberta",
          desiredKind: "mockup",
          requiredTags: ["casamento", "site", "overview", "produto-real", "mockup", "interface"],
        }),
        baseQuery({
          sceneOrder: 2,
          sceneName: "Benefícios",
          desiredKind: "mockup",
          requiredTags: ["casamento", "site", "presentes", "pix", "produto-real", "mockup", "interface"],
        }),
      ],
    });

    assert.equal(result.pending.length, 0);
    assert.deepEqual(result.resolved.map((entry) => entry.asset.id), ["overview-product-mockup", "gifts-product-mockup"]);
  });
});

test("VisualAssetResolver pontua proporção/emoção e escolhe o asset mais compatível", async () => {
  await withTempDir(async (dir) => {
    const portraitPath = join(dir, "portrait.png");
    const landscapePath = join(dir, "landscape.png");
    await writePng(portraitPath, 1080, 1920);
    await writePng(landscapePath, 1920, 1080);
    const fakeProvider = {
      providerId: "score-provider",
      async search() {
        return {
          assets: [
            {
              id: "landscape-generic",
              provider: "score-provider",
              origin: "local_library",
              absolutePath: landscapePath,
              license: license(),
              tags: ["casamento", "site"],
              theme: "cena genérica",
              emotion: "neutro",
              width: 1920,
              height: 1080,
              aspectRatio: "16:9",
              kind: "photo",
            },
            {
              id: "portrait-casal-celular",
              provider: "score-provider",
              origin: "local_library",
              absolutePath: portraitPath,
              license: license(),
              tags: ["casamento", "casal", "celular", "site"],
              theme: "casal usando celular",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "photo",
            },
          ],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({ executionId: "exec-assets", scenes: [baseQuery()] });

    assert.equal(result.pending.length, 0);
    assert.equal(result.resolved[0].asset.id, "portrait-casal-celular");
    assert.ok(result.resolved[0].scoreBreakdown.creativeFitness >= 85);
  });
});

test("VisualAssetResolver prioriza variedade entre cenas quando há alternativas aprovadas", async () => {
  await withTempDir(async (dir) => {
    const firstPath = join(dir, "casal-celular.png");
    const secondPath = join(dir, "album-convidados.png");
    await writePng(firstPath, 1080, 1920);
    await writePng(secondPath, 1080, 1920);
    const fakeProvider = {
      providerId: "variety-provider",
      async search() {
        return {
          assets: [
            {
              id: "casal-celular",
              provider: "variety-provider",
              origin: "local_library",
              absolutePath: firstPath,
              license: license(),
              tags: ["casamento", "casal", "celular", "site"],
              theme: "casal usando celular",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "photo",
            },
            {
              id: "album-convidados",
              provider: "variety-provider",
              origin: "local_library",
              absolutePath: secondPath,
              license: license(),
              tags: ["casamento", "casal", "celular", "site"],
              theme: "convidados usando celular",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "photo",
            },
          ],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({
      executionId: "exec-assets",
      scenes: [
        baseQuery({ sceneOrder: 1, sceneName: "Gancho" }),
        baseQuery({ sceneOrder: 2, sceneName: "Benefício" }),
      ],
    });

    assert.equal(result.pending.length, 0);
    assert.deepEqual(result.resolved.map((entry) => entry.asset.id), ["casal-celular", "album-convidados"]);
  });
});

test("VisualAssetResolver prioriza vídeo real sobre fotografia estática com as mesmas tags — comercial de agência prioriza vídeo, b-roll e cinemagraph nesta ordem", async () => {
  await withTempDir(async (dir) => {
    const photoPath = join(dir, "foto.jpg");
    const videoPath = join(dir, "video.mp4");
    await writePng(photoPath, 1080, 1920);
    await writeFile(videoPath, Buffer.from("fake-mp4-bytes"));
    const fakeProvider = {
      providerId: "media-priority-provider",
      async search() {
        return {
          assets: [
            {
              id: "foto",
              provider: "media-priority-provider",
              origin: "local_library",
              absolutePath: photoPath,
              license: license(),
              tags: ["casamento", "casal", "celular"],
              theme: "casal usando celular",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "photo",
            },
            {
              id: "video",
              provider: "media-priority-provider",
              origin: "local_library",
              absolutePath: videoPath,
              license: license(),
              tags: ["casamento", "casal", "celular"],
              theme: "casal usando celular",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "video",
              durationSeconds: 4,
            },
          ],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({ executionId: "exec-assets", scenes: [baseQuery({ desiredKind: "photo" })] });

    assert.equal(result.resolved[0].asset.id, "video");
    assert.equal(result.resolved[0].asset.kind, "video");
    assert.ok(result.resolved[0].scoreBreakdown.creativeFitness >= 95);
  });
});

test("VisualAssetResolver monta a sequência a partir de sequenceRoles (não apenas sequenceSize), marcando o papel narrativo de cada asset resolvido", async () => {
  await withTempDir(async (dir) => {
    const firstPath = join(dir, "estabelecimento.png");
    const secondPath = join(dir, "interacao.png");
    await writePng(firstPath, 1080, 1920);
    await writePng(secondPath, 1080, 1920);
    const fakeProvider = {
      providerId: "sequence-role-provider",
      async search() {
        return {
          assets: [
            {
              id: "estabelecimento",
              provider: "sequence-role-provider",
              origin: "local_library",
              absolutePath: firstPath,
              license: license(),
              tags: ["casamento", "casal", "celular", "site"],
              theme: "casal usando celular no casamento",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "photo",
            },
            {
              id: "interacao",
              provider: "sequence-role-provider",
              origin: "local_library",
              absolutePath: secondPath,
              license: license(),
              tags: ["casamento", "casal", "celular", "site"],
              theme: "interação humana com o produto",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "photo",
            },
          ],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({
      executionId: "exec-assets",
      scenes: [baseQuery({ sceneOrder: 1, sceneName: "Desenvolvimento 1", sequenceRoles: ["establishing", "human_interaction"] })],
    });

    const entries = result.resolved.filter((entry) => entry.sceneOrder === 1);
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((entry) => entry.sequenceRole), ["establishing", "human_interaction"]);
    assert.deepEqual(entries.map((entry) => entry.sequenceIndex), [0, 1]);
  });
});

test("VisualAssetResolver monta uma sequência visual coerente (sequenceSize > 1) com sequenceIndex crescente e assets distintos, nunca abaixo da nota mínima", async () => {
  await withTempDir(async (dir) => {
    const firstPath = join(dir, "casal-convite.png");
    const secondPath = join(dir, "interface-app.png");
    const weakPath = join(dir, "generico-fraco.png");
    await writePng(firstPath, 1080, 1920);
    await writePng(secondPath, 1080, 1920);
    await writePng(weakPath, 1080, 1920);
    const fakeProvider = {
      providerId: "sequence-provider",
      async search() {
        return {
          assets: [
            {
              id: "casal-convite",
              provider: "sequence-provider",
              origin: "local_library",
              absolutePath: firstPath,
              license: license(),
              tags: ["casamento", "casal", "celular", "site"],
              theme: "casal usando celular no casamento",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "photo",
            },
            {
              id: "interface-app",
              provider: "sequence-provider",
              origin: "local_library",
              absolutePath: secondPath,
              license: license(),
              tags: ["casamento", "casal", "celular", "site"],
              theme: "interface do site oficial do casamento",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "photo",
            },
            {
              id: "generico-fraco",
              provider: "sequence-provider",
              origin: "local_library",
              absolutePath: weakPath,
              license: license(),
              tags: ["irrelevante"],
              theme: "paisagem genérica sem relação com o tema",
              emotion: "neutro",
              width: 200,
              height: 200,
              aspectRatio: "1:1",
              kind: "photo",
            },
          ],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({
      executionId: "exec-assets",
      scenes: [baseQuery({ sceneOrder: 1, sceneName: "Desenvolvimento 1", sequenceSize: 2 })],
    });

    const sequenceEntries = result.resolved.filter((entry) => entry.sceneOrder === 1);
    assert.equal(sequenceEntries.length, 2);
    assert.deepEqual(sequenceEntries.map((entry) => entry.sequenceIndex), [0, 1]);
    assert.notEqual(sequenceEntries[0].asset.id, sequenceEntries[1].asset.id);
    // O asset fraco (score abaixo do mínimo) nunca deveria ser usado só para completar a sequência.
    assert.ok(!sequenceEntries.some((entry) => entry.asset.id === "generico-fraco"));
  });
});

test("VisualAssetResolver não força um segundo asset da sequência quando não há alternativa acima da nota mínima (sequenceSize maior que o disponível)", async () => {
  await withTempDir(async (dir) => {
    const onlyPath = join(dir, "casal-celular.png");
    await writePng(onlyPath, 1080, 1920);
    const fakeProvider = {
      providerId: "single-asset-provider",
      async search() {
        return {
          assets: [
            {
              id: "casal-celular",
              provider: "single-asset-provider",
              origin: "local_library",
              absolutePath: onlyPath,
              license: license(),
              tags: ["casamento", "casal", "celular", "site"],
              theme: "casal usando celular no casamento",
              emotion: "tranquilidade",
              width: 1080,
              height: 1920,
              aspectRatio: "9:16",
              kind: "photo",
            },
          ],
          warnings: [],
        };
      },
    };

    const resolver = new VisualAssetResolver({ providers: [fakeProvider], artifactsRootDir: join(dir, "artifacts") });
    const result = await resolver.resolve({
      executionId: "exec-assets",
      scenes: [baseQuery({ sceneOrder: 1, sceneName: "Desenvolvimento 1", sequenceSize: 3 })],
    });

    const sequenceEntries = result.resolved.filter((entry) => entry.sceneOrder === 1);
    assert.equal(sequenceEntries.length, 1);
    assert.equal(sequenceEntries[0].sequenceIndex, 0);
  });
});

test("VisualAssetResolver gera pacote Developer Assisted e retoma quando o arquivo é criado", async () => {
  await withTempDir(async (dir) => {
    const resolver = new VisualAssetResolver({ providers: [], artifactsRootDir: join(dir, "artifacts") });
    const first = await resolver.resolve({ executionId: "exec-assets", scenes: [baseQuery()] });

    assert.equal(first.resolved.length, 0);
    assert.equal(first.pending.length, 1);
    assert.equal(first.pending[0].expectedRelativePath, "visual-assets/scene-01.png");
    assert.ok(first.pending[0].prompt.includes("Crie uma imagem realista"));
    assert.ok(first.warnings.some((warning) => warning.includes("criação assistida pendente")));

    await writePng(first.pending[0].expectedAbsolutePath, 1080, 1920);
    const resumed = await resolver.resolve({ executionId: "exec-assets", scenes: [baseQuery()] });

    assert.equal(resumed.pending.length, 0);
    assert.equal(resumed.resolved.length, 1);
    assert.equal(resumed.resolved[0].asset.origin, "developer_assisted");
    assert.equal(resumed.resolved[0].asset.license.allowsCommercialUse, true);
  });
});


// ---------------------------------------------------------------------------------------------
// AGENCY FILM PIPELINE 2.0 — Resolver por Shot (uma query por Shot, sem fanout de sequenceRoles)
// ---------------------------------------------------------------------------------------------

test("AGENCY FILM PIPELINE 2.0: em modo Shot (shotId presente) o resolver devolve 1 asset por query e ecoa shotId/shotOrder/shotPurpose", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    await writePng(join(libraryDir, "shot-a.png"));
    await writePng(join(libraryDir, "shot-b.png"));
    await writeFile(join(libraryDir, "manifest.json"), JSON.stringify([
      { id: "shot-a", path: "shot-a.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular", "site", "detalhe"], theme: "Detalhe mão no celular", emotion: "tranquilidade", kind: "b_roll" },
      { id: "shot-b", path: "shot-b.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular", "site", "reacao"], theme: "Casal sorrindo", emotion: "tranquilidade", kind: "video" },
    ], null, 2), "utf8");

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    const result = await resolver.resolve({
      executionId: "exec-shots",
      scenes: [
        baseQuery({ shotId: "s1-shot-1", shotOrder: 1, shotPurpose: "detail", requiredTags: ["casamento", "casal", "celular", "site", "detalhe"], sequenceSize: 2 }),
        baseQuery({ shotId: "s1-shot-2", shotOrder: 2, shotPurpose: "reaction", requiredTags: ["casamento", "casal", "celular", "site", "reacao"], sequenceSize: 2 }),
      ],
    });

    // Modo Shot NUNCA faz fanout — 2 queries de shot = exatamente 2 resolveds (não 4 apesar de sequenceSize=2).
    assert.equal(result.resolved.length, 2);
    for (const entry of result.resolved) {
      assert.ok(entry.shotId, "esperava shotId ecoado");
      assert.ok(entry.shotPurpose, "esperava shotPurpose ecoado");
    }
    assert.equal(result.resolved[0].shotId, "s1-shot-1");
    assert.equal(result.resolved[1].shotId, "s1-shot-2");
    // Diversidade: dois Shots vizinhos NUNCA recebem o mesmo asset (o dedupe interno já garante).
    assert.notEqual(result.resolved[0].asset.id, result.resolved[1].asset.id);
  });
});

test("AGENCY FILM PIPELINE 2.0: forbidAssetIds proíbe explicitamente reutilizar assets já selecionados por outro Shot", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    await writePng(join(libraryDir, "asset-forte.png"));
    await writePng(join(libraryDir, "asset-alternativo.png"));
    await writeFile(join(libraryDir, "manifest.json"), JSON.stringify([
      { id: "asset-forte", path: "asset-forte.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular", "site", "detalhe"], theme: "melhor asset", emotion: "tranquilidade", kind: "photo" },
      { id: "asset-alternativo", path: "asset-alternativo.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular", "site", "detalhe"], theme: "segundo melhor", emotion: "tranquilidade", kind: "photo" },
    ], null, 2), "utf8");

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    const result = await resolver.resolve({
      executionId: "exec-forbid",
      scenes: [
        baseQuery({ shotId: "s1-shot-1", shotOrder: 1, forbidAssetIds: ["asset-forte"] }),
      ],
    });

    assert.equal(result.resolved.length, 1);
    assert.notEqual(result.resolved[0].asset.id, "asset-forte");
  });
});

// ---------------------------------------------------------------------------------------------
// ASSET DIVERSITY GATE — perfil premium desativa shot_reuse_fallback; Developer Assisted Mode
// passa a suportar vídeo real (não só raster).
// ---------------------------------------------------------------------------------------------

test("VisualAssetResolver reutiliza o melhor candidato abaixo da nota mínima (shot_reuse_fallback) quando qualityProfile não é premium", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    await writePng(join(libraryDir, "unico-asset.png"));
    await writeFile(join(libraryDir, "manifest.json"), JSON.stringify([
      { id: "unico-asset", path: "unico-asset.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular", "site", "detalhe"], theme: "asset único da biblioteca", emotion: "tranquilidade", kind: "photo" },
    ], null, 2), "utf8");

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    const mismatchedQuery = baseQuery({
      shotId: "s1-shot-1",
      shotOrder: 1,
      theme: "conteúdo majoritariamente sem relação",
      emotion: "urgencia",
      // Um único termo em comum ("casamento") garante que o asset ainda apareça como candidato
      // (o provider local só devolve assets com AO MENOS uma tag/tema em comum — ver
      // `matchesQuery` em `local-visual-asset-library.ts`); o restante desalinhado + a tag
      // proibida derrubam a nota bem abaixo do mínimo (62) sem zerar os candidatos.
      requiredTags: ["casamento", "irrelevante-um", "irrelevante-dois", "irrelevante-tres"],
      forbiddenTags: ["site"],
      qualityProfile: "standard",
    });

    const result = await resolver.resolve({ executionId: "exec-fallback", scenes: [mismatchedQuery] });

    assert.equal(result.pending.length, 0, "esperava reuso via fallback, não pending");
    assert.equal(result.resolved.length, 1);
    assert.ok(result.resolved[0].selectionReason?.startsWith("shot_reuse_fallback"), result.resolved[0].selectionReason);
  });
});

test("VisualAssetResolver NUNCA usa shot_reuse_fallback em perfil premium: Shot cai em pending (Developer Assisted Mode) em vez de reutilizar um asset abaixo da nota mínima", async () => {
  await withTempDir(async (dir) => {
    const libraryDir = join(dir, "library");
    await writePng(join(libraryDir, "unico-asset.png"));
    await writeFile(join(libraryDir, "manifest.json"), JSON.stringify([
      { id: "unico-asset", path: "unico-asset.png", provider: "local-test", origin: "local_library", license: license(), tags: ["casamento", "casal", "celular", "site", "detalhe"], theme: "asset único da biblioteca", emotion: "tranquilidade", kind: "photo" },
    ], null, 2), "utf8");

    const resolver = new VisualAssetResolver({
      providers: [new LocalVisualAssetLibrary({ rootDir: libraryDir })],
      artifactsRootDir: join(dir, "artifacts"),
    });

    const mismatchedQuery = baseQuery({
      shotId: "s1-shot-1",
      shotOrder: 1,
      theme: "conteúdo majoritariamente sem relação",
      emotion: "urgencia",
      requiredTags: ["casamento", "irrelevante-um", "irrelevante-dois", "irrelevante-tres"],
      forbiddenTags: ["site"],
      qualityProfile: "premium",
    });

    const result = await resolver.resolve({ executionId: "exec-premium-fallback", scenes: [mismatchedQuery] });

    assert.equal(result.resolved.length, 0, "premium nunca deveria aceitar um asset abaixo da nota mínima via fallback");
    assert.equal(result.pending.length, 1);
    assert.equal(result.pending[0].expectedRelativePath, "visual-assets/scene-01-shot-01.png");
  });
});

test("VisualAssetResolver aceita vídeo real (.mp4) criado via Developer Assisted Mode para um Shot que pede desiredKind: video, lendo duração/dimensões via FFmpeg", async () => {
  await withTempDir(async (dir) => {
    const resolver = new VisualAssetResolver({ providers: [], artifactsRootDir: join(dir, "artifacts") });
    const videoQuery = baseQuery({ shotId: "s1-shot-1", shotOrder: 1, desiredKind: "video" });

    const first = await resolver.resolve({ executionId: "exec-video-dam", scenes: [videoQuery] });
    assert.equal(first.resolved.length, 0);
    assert.equal(first.pending.length, 1);
    assert.equal(first.pending[0].expectedRelativePath, "visual-assets/scene-01-shot-01.mp4");

    const { spawnSync } = await import("node:child_process");
    const ffmpeg = (await import("ffmpeg-static")).default;
    // Largura >= 640px: a validação Developer Assisted (`readDeveloperAssistedAssetIfExists`)
    // exige um mínimo de 640px em cada lado, diferente da leitura direta da biblioteca local.
    const buildResult = spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=size=720x1280:duration=2:rate=30", "-pix_fmt", "yuv420p", first.pending[0].expectedAbsolutePath]);
    assert.equal(buildResult.status, 0, buildResult.stderr?.toString());

    const resumed = await resolver.resolve({ executionId: "exec-video-dam", scenes: [videoQuery] });
    assert.equal(resumed.pending.length, 0);
    assert.equal(resumed.resolved.length, 1);
    const asset = resumed.resolved[0].asset;
    assert.equal(asset.kind, "video");
    assert.equal(asset.width, 720);
    assert.equal(asset.height, 1280);
    assert.ok(asset.durationSeconds >= 1.9 && asset.durationSeconds <= 2.1, `duração lida: ${asset.durationSeconds}`);
    assert.equal(asset.id, "developer-assisted-s1-shot-1");
  });
});

test("VisualAssetResolver gera um id único por Shot (não por cena) para assets Developer Assisted, mesmo quando dois Shots da mesma cena são assistidos", async () => {
  await withTempDir(async (dir) => {
    const resolver = new VisualAssetResolver({ providers: [], artifactsRootDir: join(dir, "artifacts") });
    const shot1 = baseQuery({ sceneOrder: 3, shotId: "s3-shot-1", shotOrder: 1 });
    const shot2 = baseQuery({ sceneOrder: 3, shotId: "s3-shot-2", shotOrder: 2 });

    const first = await resolver.resolve({ executionId: "exec-dam-ids", scenes: [shot1, shot2] });
    assert.equal(first.pending.length, 2);
    await writePng(first.pending[0].expectedAbsolutePath, 1080, 1920);
    await writePng(first.pending[1].expectedAbsolutePath, 1080, 1920);

    const resumed = await resolver.resolve({ executionId: "exec-dam-ids", scenes: [shot1, shot2] });
    assert.equal(resumed.resolved.length, 2);
    assert.notEqual(resumed.resolved[0].asset.id, resumed.resolved[1].asset.id, "dois Shots distintos da mesma cena nunca podem colidir no mesmo id de asset");
    assert.equal(resumed.resolved[0].asset.id, "developer-assisted-s3-shot-1");
    assert.equal(resumed.resolved[1].asset.id, "developer-assisted-s3-shot-2");
  });
});

