import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile as writeFileBytes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalArtifactDelivery } from "../dist/infrastructure/artifacts/local-artifact-delivery.js";

async function withTempRoot(run) {
  const rootDir = await mkdtemp(join(tmpdir(), "zuno-artifact-provenance-"));
  try {
    await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("writeFile: grava um sidecar de proveniência e readFile o devolve de volta", async () => {
  await withTempRoot(async (rootDir) => {
    const delivery = new LocalArtifactDelivery({ rootDir });
    await delivery.writeFile({
      executionId: "exec-1",
      relativePath: "images/slide-01.png",
      content: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
      provenance: { producer: "real_ai_generation", publishable: true },
    });

    const found = await delivery.readFile({ executionId: "exec-1", relativePath: "images/slide-01.png" });
    assert.ok(found);
    assert.deepEqual(found.provenance, { producer: "real_ai_generation", publishable: true });
  });
});

test("writeFile: propaga producer/publishable/reason fielmente pelo round-trip", async () => {
  await withTempRoot(async (rootDir) => {
    const delivery = new LocalArtifactDelivery({ rootDir });
    await delivery.writeFile({
      executionId: "exec-1",
      relativePath: "audio/narration.wav",
      content: "fake-audio-bytes",
      mimeType: "audio/wav",
      provenance: { producer: "synthetic_narration", publishable: false, reason: "Voz SAPI" },
    });

    const found = await delivery.readFile({ executionId: "exec-1", relativePath: "audio/narration.wav" });
    assert.equal(found.provenance.producer, "synthetic_narration");
    assert.equal(found.provenance.publishable, false);
    assert.equal(found.provenance.reason, "Voz SAPI");
  });
});

test("readFile: arquivo escrito por fora do ArtifactDeliveryPort (ex.: humano/IDE) nunca tem sidecar — provenance undefined, nunca um erro", async () => {
  await withTempRoot(async (rootDir) => {
    const executionDir = join(rootDir, "exec-1", "images");
    await import("node:fs/promises").then((fs) => fs.mkdir(executionDir, { recursive: true }));
    await writeFileBytes(join(executionDir, "slide-01.png"), Buffer.from([1, 2, 3]));

    const delivery = new LocalArtifactDelivery({ rootDir });
    const found = await delivery.readFile({ executionId: "exec-1", relativePath: "images/slide-01.png" });
    assert.ok(found);
    assert.equal(found.provenance, undefined);
  });
});

test("readFile: sidecar corrompido (JSON inválido) nunca derruba a leitura do artefato real — provenance undefined", async () => {
  await withTempRoot(async (rootDir) => {
    const executionDir = join(rootDir, "exec-1", "images");
    await import("node:fs/promises").then((fs) => fs.mkdir(executionDir, { recursive: true }));
    await writeFileBytes(join(executionDir, "slide-01.png"), Buffer.from([1, 2, 3]));
    await writeFileBytes(join(executionDir, "slide-01.png.provenance.json"), "{ isto não é json válido");

    const delivery = new LocalArtifactDelivery({ rootDir });
    const found = await delivery.readFile({ executionId: "exec-1", relativePath: "images/slide-01.png" });
    assert.ok(found);
    assert.equal(found.data.byteLength, 3);
    assert.equal(found.provenance, undefined);
  });
});

test("createZip: exige e propaga provenance para o writeFile interno", async () => {
  await withTempRoot(async (rootDir) => {
    const delivery = new LocalArtifactDelivery({ rootDir });
    await delivery.createZip({
      executionId: "exec-1",
      relativePath: "carousel.zip",
      entries: [{ relativePath: "a.png", data: new Uint8Array([1]) }],
      provenance: { producer: "deterministic_composition", publishable: true },
    });

    const found = await delivery.readFile({ executionId: "exec-1", relativePath: "carousel.zip" });
    assert.ok(found);
    assert.deepEqual(found.provenance, { producer: "deterministic_composition", publishable: true });
  });
});

test("readFile: arquivo inexistente continua devolvendo undefined (regressão)", async () => {
  await withTempRoot(async (rootDir) => {
    const delivery = new LocalArtifactDelivery({ rootDir });
    const found = await delivery.readFile({ executionId: "exec-1", relativePath: "images/nao-existe.png" });
    assert.equal(found, undefined);
  });
});
