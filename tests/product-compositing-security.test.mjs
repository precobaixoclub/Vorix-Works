import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { FfmpegProductCompositingAdapter } = await imp("dist/infrastructure/product-compositing/ffmpeg-product-compositing-adapter.js");

function baseContract(overrides = {}) {
  return {
    sourceVideoPath: join(ROOT, "does-not-exist.mp4"),
    sourceVideoDurationSeconds: 5,
    productScreenId: "screen-1",
    startTime: 0.2,
    endTime: 1.5,
    mode: "STATIC_SCREEN",
    keyframes: [{ time: 0.8, corners: { topLeft: [100, 80], topRight: [400, 80], bottomRight: [400, 280], bottomLeft: [100, 280] } }],
    interpolationMode: "linear",
    opacity: 1,
    blendMode: "normal",
    cropMode: "stretch_to_quad",
    perspectiveTransform: true,
    cornerRadius: 0,
    screenBrightness: 0,
    screenContrast: 1,
    screenSaturation: 1,
    blur: 0,
    reflection: false,
    grain: 0,
    feather: 0.005,
    safeMargin: 0,
    ...overrides,
  };
}

test("composite() rejeita sourceVideoPath relativo (nunca aceita caminho não-absoluto)", async () => {
  const adapter = new FfmpegProductCompositingAdapter();
  await assert.rejects(
    () => adapter.composite({
      contract: baseContract({ sourceVideoPath: "relative/video.mp4" }),
      productScreenSourcePath: join(ROOT, "screen.png"),
      productScreenIsVideo: false,
      outputDir: join(ROOT, "out"),
      executionId: "test",
    }),
    /absoluto/,
  );
});

test("composite() rejeita productScreenSourcePath relativo", async () => {
  const adapter = new FfmpegProductCompositingAdapter();
  await assert.rejects(
    () => adapter.composite({
      contract: baseContract(),
      productScreenSourcePath: "../../etc/passwd",
      productScreenIsVideo: false,
      outputDir: join(ROOT, "out"),
      executionId: "test",
    }),
    /absoluto/,
  );
});

test("composite() rejeita outputDir relativo", async () => {
  const adapter = new FfmpegProductCompositingAdapter();
  await assert.rejects(
    () => adapter.composite({
      contract: baseContract(),
      productScreenSourcePath: join(ROOT, "screen.png"),
      productScreenIsVideo: false,
      outputDir: "relative/out",
      executionId: "test",
    }),
    /absoluto/,
  );
});

test("buildAssistedPackage() rejeita sourceVideoPath relativo", async () => {
  const adapter = new FfmpegProductCompositingAdapter();
  await assert.rejects(
    () => adapter.buildAssistedPackage({
      assetId: "asset-1",
      sourceVideoPath: "relative/video.mp4",
      sourceVideoDurationSeconds: 5,
      screenType: "phone",
      referenceTimestamps: [1],
      outputDir: join(ROOT, "out"),
    }),
    /absoluto/,
  );
});

test("buildAssistedPackage() rejeita outputDir relativo", async () => {
  const adapter = new FfmpegProductCompositingAdapter();
  await assert.rejects(
    () => adapter.buildAssistedPackage({
      assetId: "asset-1",
      sourceVideoPath: join(ROOT, "video.mp4"),
      sourceVideoDurationSeconds: 5,
      screenType: "phone",
      referenceTimestamps: [1],
      outputDir: "relative/out",
    }),
    /absoluto/,
  );
});

// -------------------------------------------------------------------------------------------
// Checagens estáticas (seção 13): nunca shell:true, nunca child_process.exec/execSync no motor
// de composição, nenhuma Skill importa a infraestrutura de composição diretamente (ADR 0002).
// -------------------------------------------------------------------------------------------

async function readAllTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await readAllTsFiles(fullPath)));
    else if (entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files;
}

test("nenhum arquivo do Product Compositing Engine usa child_process.exec/execSync ou shell:true", async () => {
  const dir = join(ROOT, "src", "infrastructure", "product-compositing");
  const files = await readAllTsFiles(dir);
  assert.ok(files.length > 0, "esperava encontrar arquivos-fonte do motor de composição");
  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.ok(!/\bexecSync\s*\(/.test(content), `${file} não deve usar execSync`);
    assert.ok(!/[^.]\bexec\s*\(\s*["'`]/.test(content), `${file} não deve usar child_process.exec com string de comando`);
    assert.ok(!/shell\s*:\s*true/.test(content), `${file} não deve usar shell:true`);
  }
});

test("nenhuma Skill (src/skills/**) importa o Product Compositing Engine ou o catálogo de telas de produto diretamente", async () => {
  const skillsDir = join(ROOT, "src", "skills");
  const files = await readAllTsFiles(skillsDir);
  assert.ok(files.length > 0, "esperava encontrar arquivos de Skills");
  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.ok(!content.includes("infrastructure/product-compositing"), `${file} não deve importar infra de composição diretamente`);
    assert.ok(!content.includes("infrastructure/product-screens"), `${file} não deve importar o catálogo de telas de produto diretamente`);
    assert.ok(!content.includes("ffmpeg-product-compositing-adapter"), `${file} não deve importar o adapter de composição diretamente`);
  }
});

test("nenhuma Skill importa FFmpeg ou node:child_process diretamente (mesma regra de isolamento já aplicada a Rafa)", async () => {
  const skillsDir = join(ROOT, "src", "skills");
  const files = await readAllTsFiles(skillsDir);
  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.ok(!content.includes('from "ffmpeg-static"'), `${file} não deve importar ffmpeg-static diretamente`);
    assert.ok(!/from\s+["']node:child_process["']/.test(content), `${file} não deve importar node:child_process diretamente`);
  }
});
