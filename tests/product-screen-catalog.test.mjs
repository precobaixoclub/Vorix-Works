import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductScreenCatalogRepository } from "../dist/infrastructure/product-screens/product-screen-catalog.repository.js";

const ROOT = process.cwd();

async function withCatalog(run) {
  const workDir = await mkdtemp(join(tmpdir(), "zuno-product-screen-catalog-"));
  try {
    const catalog = new ProductScreenCatalogRepository({
      filePath: join(workDir, "product-screen-catalog.json"),
      libraryRoot: join(ROOT, "assets", "visual", "library"),
    });
    await run(catalog);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

test("scan() cataloga exatamente as sementes curadas (nunca varre a pasta às cegas)", async () => {
  await withCatalog(async (catalog) => {
    const result = await catalog.scan();
    assert.equal(result.added, 5);
    assert.equal(result.warnings.length, 0);
    const screens = await catalog.list();
    assert.equal(screens.length, 5);
    assert.ok(screens.every((screen) => screen.sourceType === "mockup"));
  });
});

test("scan() nunca inclui arquivos que não são telas de produto (ex.: fotos de contexto, marca)", async () => {
  await withCatalog(async (catalog) => {
    await catalog.scan();
    const screens = await catalog.list();
    const paths = screens.map((screen) => screen.sourcePath);
    assert.ok(!paths.some((path) => path.includes("photo-evidence")));
    assert.ok(!paths.some((path) => path.includes("rumo-ao-altar-mark")));
  });
});

test("scan() registra hash real e contentCropRect (nunca inventa recorte)", async () => {
  await withCatalog(async (catalog) => {
    await catalog.scan();
    const [screen] = await catalog.list();
    assert.equal(screen.hash.length, 64);
    assert.ok(screen.contentCropRect);
    assert.ok(screen.contentCropRect.width > 0 && screen.contentCropRect.height > 0);
  });
});

test("scan() registra licença conhecida para os mockups locais (nunca licenseStatus desconhecido)", async () => {
  await withCatalog(async (catalog) => {
    await catalog.scan();
    const screens = await catalog.list();
    assert.ok(screens.every((screen) => screen.license && screen.license.name.length > 0));
  });
});

test("approve()/reject() alteram approvalStatus e persistem entre instâncias", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "zuno-product-screen-catalog-"));
  try {
    const filePath = join(workDir, "product-screen-catalog.json");
    const libraryRoot = join(ROOT, "assets", "visual", "library");
    const catalogA = new ProductScreenCatalogRepository({ filePath, libraryRoot });
    await catalogA.scan();
    const [screen] = await catalogA.list();
    await catalogA.approve(screen.screenId);

    const catalogB = new ProductScreenCatalogRepository({ filePath, libraryRoot });
    const reloaded = await catalogB.get(screen.screenId);
    assert.equal(reloaded.approvalStatus, "approved");

    await catalogB.reject(screen.screenId, "teste de rejeição");
    const catalogC = new ProductScreenCatalogRepository({ filePath, libraryRoot });
    const rejected = await catalogC.get(screen.screenId);
    assert.equal(rejected.approvalStatus, "rejected");
    assert.ok(rejected.notes.some((note) => note.includes("teste de rejeição")));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("scan() repetido preserva approvalStatus já decidido (rescanear nunca reverte aprovação humana)", async () => {
  await withCatalog(async (catalog) => {
    await catalog.scan();
    const [screen] = await catalog.list();
    await catalog.approve(screen.screenId);
    await catalog.scan();
    const reloaded = await catalog.get(screen.screenId);
    assert.equal(reloaded.approvalStatus, "approved");
  });
});

test("select() nunca devolve tela reprovada, mesmo pedindo a funcionalidade certa", async () => {
  await withCatalog(async (catalog) => {
    await catalog.scan();
    const rsvpScreens = await catalog.list({ approvalStatus: "needs_review" });
    const rsvp = rsvpScreens.find((screen) => screen.functionality === "rsvp");
    await catalog.reject(rsvp.screenId);
    const selected = await catalog.select({ functionality: "rsvp" });
    assert.equal(selected.length, 0, "tela rejeitada nunca deve ser selecionável");
  });
});

test("select() por funcionalidade devolve a tela certa quando aprovada", async () => {
  await withCatalog(async (catalog) => {
    await catalog.scan();
    const screens = await catalog.list();
    for (const screen of screens) await catalog.approve(screen.screenId);
    const selected = await catalog.select({ functionality: "rsvp" });
    assert.equal(selected.length, 1);
    assert.equal(selected[0].functionality, "rsvp");
  });
});

test("select() por narrativeIntent mapeia frases livres para a funcionalidade certa (ex.: 'confirmar presença' -> rsvp)", async () => {
  await withCatalog(async (catalog) => {
    await catalog.scan();
    const screens = await catalog.list();
    for (const screen of screens) await catalog.approve(screen.screenId);
    const selected = await catalog.select({ narrativeIntent: "convite para confirmar presença no casamento" });
    assert.ok(selected.some((screen) => screen.functionality === "rsvp"));
  });
});

test("select() nunca devolve uma tela genérica quando nenhuma funcionalidade corresponde (gap real, não preenchimento arbitrário)", async () => {
  await withCatalog(async (catalog) => {
    await catalog.scan();
    const screens = await catalog.list();
    for (const screen of screens) await catalog.approve(screen.screenId);
    const selected = await catalog.select({ functionality: "funcionalidade-que-nao-existe" });
    assert.equal(selected.length, 0);
  });
});
