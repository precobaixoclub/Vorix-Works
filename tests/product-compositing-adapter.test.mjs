import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const { FfmpegProductCompositingAdapter } = await imp("dist/infrastructure/product-compositing/ffmpeg-product-compositing-adapter.js");
const { resolveFfmpegBinaryPath } = await imp("dist/infrastructure/video-rendering/ffmpeg-binary.js");

/**
 * PRODUCT COMPOSITING ENGINE — testes de integração REAIS contra o FFmpeg de verdade (nunca
 * mockado), mesmo espírito de `media-acquisition.test.mjs` (fixtures geradas via `lavfi`, não
 * arquivos binários versionados). O vídeo de origem é azul sólido; o "screen" é vermelho sólido —
 * isso permite verificar objetivamente, lendo pixels reais do resultado (não apenas "não lançou
 * erro"), que a composição caiu exatamente dentro do quadrilátero pedido e que o resto do frame
 * (fora do quadrilátero) continua mostrando o vídeo original, sem vazamento.
 */

const FF = resolveFfmpegBinaryPath();

function run(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(FF, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`))));
    child.on("error", rejectPromise);
  });
}

async function buildBlueVideo(path, { width = 640, height = 360, duration = 2 } = {}) {
  await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x0000ff:s=${width}x${height}:d=${duration}:r=24`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

async function buildRedImage(path, { width = 300, height = 300 } = {}) {
  await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0xff0000:s=${width}x${height}:d=1`, "-frames:v", "1", path]);
}

async function buildSplitColorImage(path, { width = 400, height = 400 } = {}) {
  // Metade esquerda verde, metade direita amarela — usado pelo teste de crop (contentCropRect).
  await run([
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `color=c=0x00ff00:s=${width / 2}x${height}:d=1`,
    "-f", "lavfi", "-i", `color=c=0xffff00:s=${width / 2}x${height}:d=1`,
    "-filter_complex", "hstack=inputs=2",
    "-frames:v", "1", path,
  ]);
}

/**
 * Lê o pixel (x,y) do frame em `atSeconds` de `path` como [r,g,b] via pipe rawvideo (mesma técnica
 * de `computePerceptualHash`). `crop=2:2` (não `1:1`) porque conteúdo `yuv420p` exige dimensões
 * pares no crop (subamostragem de croma 2x2) — um crop de 1x1 falha com "Invalid...size" nesse
 * pixel format; lemos o pixel superior-esquerdo do bloco 2x2 resultante.
 */
async function samplePixelRGB(path, atSeconds, x, y) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(FF, ["-hide_banner", "-loglevel", "error", "-ss", String(atSeconds), "-i", path, "-frames:v", "1", "-vf", `crop=2:2:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], { windowsHide: true });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (code) => {
      if (code !== 0) { rejectPromise(new Error(`ffmpeg sample exited ${code}`)); return; }
      const buffer = Buffer.concat(chunks);
      resolvePromise([buffer[0], buffer[1], buffer[2]]);
    });
    child.on("error", rejectPromise);
  });
}

function isCloseTo(actual, expected, tolerance = 30) {
  return Math.abs(actual - expected) <= tolerance;
}

function baseContract(overrides = {}) {
  return {
    sourceVideoPath: "",
    sourceVideoDurationSeconds: 2,
    productScreenId: "test-screen",
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

async function withWorkDir(run_) {
  const workDir = await mkdtemp(join(tmpdir(), "zuno-product-compositing-test-"));
  const outputDir = join(workDir, "output");
  await mkdir(outputDir, { recursive: true });
  try {
    await run_(workDir, outputDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

test("composite() com STATIC_SCREEN produz um vídeo real; o interior do quadrilátero mostra a tela composta e o exterior continua mostrando o vídeo original (sem vazamento)", async () => {
  await withWorkDir(async (workDir, outputDir) => {
    const sourceVideoPath = join(workDir, "source.mp4");
    const screenPath = join(workDir, "screen.png");
    await buildBlueVideo(sourceVideoPath);
    await buildRedImage(screenPath);

    const adapter = new FfmpegProductCompositingAdapter();
    const contract = baseContract({ sourceVideoPath });
    const outcome = await adapter.composite({
      contract, productScreenSourcePath: screenPath, productScreenIsVideo: false, outputDir, executionId: "test",
    });

    assert.equal(outcome.status, "composited");
    assert.ok(outcome.sizeBytes > 0);
    assert.ok(outcome.durationSeconds > 1.5, "duração final deve cobrir aproximadamente todo o vídeo original");

    const insideQuad = await samplePixelRGB(outcome.outputAbsolutePath, 0.8, 250, 180);
    assert.ok(isCloseTo(insideQuad[0], 255) && isCloseTo(insideQuad[2], 0), `centro do quadrilátero deveria ser vermelho (tela composta), recebeu ${insideQuad}`);

    const outsideQuad = await samplePixelRGB(outcome.outputAbsolutePath, 0.8, 20, 20);
    assert.ok(isCloseTo(outsideQuad[2], 255) && isCloseTo(outsideQuad[0], 0), `canto fora do quadrilátero deveria continuar azul (vídeo original), recebeu ${outsideQuad}`);

    const beforeWindow = await samplePixelRGB(outcome.outputAbsolutePath, 0.05, 250, 180);
    assert.ok(isCloseTo(beforeWindow[2], 255), "antes de startTime, o vídeo original (azul) deve aparecer sem composição");
  });
});

test("composite() com contentCropRect recorta só a região pedida da tela (metade verde, não a metade amarela)", async () => {
  await withWorkDir(async (workDir, outputDir) => {
    const sourceVideoPath = join(workDir, "source.mp4");
    const screenPath = join(workDir, "screen-split.png");
    await buildBlueVideo(sourceVideoPath);
    await buildSplitColorImage(screenPath);

    const adapter = new FfmpegProductCompositingAdapter();
    const contract = baseContract({ sourceVideoPath });
    const outcome = await adapter.composite({
      contract,
      productScreenSourcePath: screenPath,
      productScreenContentCropRect: { x: 0, y: 0, width: 200, height: 400 },
      productScreenIsVideo: false,
      outputDir, executionId: "test",
    });

    assert.equal(outcome.status, "composited");
    const insideQuad = await samplePixelRGB(outcome.outputAbsolutePath, 0.8, 250, 180);
    assert.ok(isCloseTo(insideQuad[1], 255) && isCloseTo(insideQuad[0], 0), `crop deveria trazer só a metade verde, recebeu ${insideQuad}`);
  });
});

test("composite() com SIMPLE_KEYFRAME_TRACKING (2 keyframes) usa múltiplos segmentos de interpolação", async () => {
  await withWorkDir(async (workDir, outputDir) => {
    const sourceVideoPath = join(workDir, "source.mp4");
    const screenPath = join(workDir, "screen.png");
    await buildBlueVideo(sourceVideoPath, { duration: 3 });
    await buildRedImage(screenPath);

    const adapter = new FfmpegProductCompositingAdapter();
    const contract = baseContract({
      sourceVideoPath,
      startTime: 0.2,
      endTime: 2.5,
      sourceVideoDurationSeconds: 3,
      mode: "SIMPLE_KEYFRAME_TRACKING",
      keyframes: [
        { time: 0.4, corners: { topLeft: [50, 50], topRight: [250, 50], bottomRight: [250, 200], bottomLeft: [50, 200] } },
        { time: 2.2, corners: { topLeft: [300, 150], topRight: [500, 150], bottomRight: [500, 300], bottomLeft: [300, 300] } },
      ],
    });
    const outcome = await adapter.composite({
      contract, productScreenSourcePath: screenPath, productScreenIsVideo: false, outputDir, executionId: "test",
    });

    assert.equal(outcome.status, "composited");
    assert.ok(outcome.interpolationSubsteps > 1, "SIMPLE_KEYFRAME_TRACKING deve usar mais de 1 substep de interpolação");

    const nearFirstKeyframe = await samplePixelRGB(outcome.outputAbsolutePath, 0.4, 150, 125);
    assert.ok(isCloseTo(nearFirstKeyframe[0], 255) && isCloseTo(nearFirstKeyframe[2], 0), "perto do primeiro keyframe, a região do primeiro quadrilátero deve mostrar a tela composta");

    const nearSecondKeyframe = await samplePixelRGB(outcome.outputAbsolutePath, 2.2, 400, 225);
    assert.ok(isCloseTo(nearSecondKeyframe[0], 255) && isCloseTo(nearSecondKeyframe[2], 0), "perto do segundo keyframe, a região do segundo quadrilátero deve mostrar a tela composta");
  });
});

test("composite() bloqueia (nunca lança exceção não tratada) quando um keyframe cai fora da duração do vídeo", async () => {
  await withWorkDir(async (workDir, outputDir) => {
    const sourceVideoPath = join(workDir, "source.mp4");
    const screenPath = join(workDir, "screen.png");
    await buildBlueVideo(sourceVideoPath);
    await buildRedImage(screenPath);

    const adapter = new FfmpegProductCompositingAdapter();
    const contract = baseContract({ sourceVideoPath, keyframes: [{ time: 50, corners: baseContract().keyframes[0].corners }] });
    const outcome = await adapter.composite({
      contract, productScreenSourcePath: screenPath, productScreenIsVideo: false, outputDir, executionId: "test",
    });

    assert.equal(outcome.status, "blocked");
    assert.match(outcome.reason, /keyframe_outside_duration/);
  });
});

test("composite() bloqueia quando as coordenadas formam uma área excessivamente pequena", async () => {
  await withWorkDir(async (workDir, outputDir) => {
    const sourceVideoPath = join(workDir, "source.mp4");
    const screenPath = join(workDir, "screen.png");
    await buildBlueVideo(sourceVideoPath);
    await buildRedImage(screenPath);

    const adapter = new FfmpegProductCompositingAdapter();
    const contract = baseContract({
      sourceVideoPath,
      keyframes: [{ time: 0.8, corners: { topLeft: [100, 100], topRight: [102, 100], bottomRight: [102, 102], bottomLeft: [100, 102] } }],
    });
    const outcome = await adapter.composite({
      contract, productScreenSourcePath: screenPath, productScreenIsVideo: false, outputDir, executionId: "test",
    });

    assert.equal(outcome.status, "blocked");
    assert.match(outcome.reason, /area_too_small/);
  });
});

test("composite() com cornerRadius/feather/screenBrightness/screenContrast não quebra o pipeline (smoke funcional dos ajustes finos)", async () => {
  await withWorkDir(async (workDir, outputDir) => {
    const sourceVideoPath = join(workDir, "source.mp4");
    const screenPath = join(workDir, "screen.png");
    await buildBlueVideo(sourceVideoPath);
    await buildRedImage(screenPath);

    const adapter = new FfmpegProductCompositingAdapter();
    const contract = baseContract({
      sourceVideoPath, cornerRadius: 0.12, feather: 0.03, screenBrightness: 0.05, screenContrast: 1.1, screenSaturation: 0.9, blur: 0.2, grain: 0.1,
    });
    const outcome = await adapter.composite({
      contract, productScreenSourcePath: screenPath, productScreenIsVideo: false, outputDir, executionId: "test",
    });

    assert.equal(outcome.status, "composited");
  });
});

test("composite() com occlusionKeyframes recorta a região da oclusão (alpha=0), deixando o vídeo original visível ali dentro do quadrilátero", async () => {
  await withWorkDir(async (workDir, outputDir) => {
    const sourceVideoPath = join(workDir, "source.mp4");
    const screenPath = join(workDir, "screen.png");
    await buildBlueVideo(sourceVideoPath);
    await buildRedImage(screenPath);

    const adapter = new FfmpegProductCompositingAdapter();
    const contract = baseContract({
      sourceVideoPath,
      occlusionKeyframes: [{ time: 0.8, polygon: [[150, 130], [250, 130], [250, 230], [150, 230]] }],
    });
    const outcome = await adapter.composite({
      contract, productScreenSourcePath: screenPath, productScreenIsVideo: false, outputDir, executionId: "test",
    });

    assert.equal(outcome.status, "composited");
    const insideOcclusion = await samplePixelRGB(outcome.outputAbsolutePath, 0.8, 200, 180);
    assert.ok(isCloseTo(insideOcclusion[2], 255) && isCloseTo(insideOcclusion[0], 0), `dentro do polígono de oclusão deve mostrar o vídeo original (azul), recebeu ${insideOcclusion}`);

    const outsideOcclusionButInsideQuad = await samplePixelRGB(outcome.outputAbsolutePath, 0.8, 350, 180);
    assert.ok(isCloseTo(outsideOcclusionButInsideQuad[0], 255) && isCloseTo(outsideOcclusionButInsideQuad[2], 0), `fora do polígono mas dentro do quadrilátero deve continuar mostrando a tela composta, recebeu ${outsideOcclusionButInsideQuad}`);
  });
});

test("validatePlacement() é chamado internamente — capabilities() reporta a lista honesta de capacidades", async () => {
  const adapter = new FfmpegProductCompositingAdapter();
  const capabilities = adapter.capabilities();
  const byName = Object.fromEntries(capabilities.map((c) => [c.capability, c.status]));
  assert.equal(byName.static_screen_composition, "implemented");
  assert.equal(byName.simple_keyframe_tracking, "implemented");
  assert.equal(byName.automatic_motion_tracking, "not_implemented");
  assert.equal(byName.occlusion_handling, "not_implemented");
});

test("buildAssistedPackage() extrai frames de referência reais nos timestamps pedidos", async () => {
  await withWorkDir(async (workDir, outputDir) => {
    const sourceVideoPath = join(workDir, "source.mp4");
    await buildBlueVideo(sourceVideoPath, { duration: 3 });

    const adapter = new FfmpegProductCompositingAdapter();
    const pkg = await adapter.buildAssistedPackage({
      assetId: "asset-1", sourceVideoPath, sourceVideoDurationSeconds: 3,
      screenType: "phone", referenceTimestamps: [0.5, 1.5], outputDir,
    });

    assert.equal(pkg.referenceFrames.length, 2);
    for (const frame of pkg.referenceFrames) {
      const stat = await import("node:fs/promises").then((fs) => fs.stat(frame.frameImagePath));
      assert.ok(stat.size > 0);
    }
  });
});

test("buildAssistedPackage() rejeita timestamp fora da duração do vídeo", async () => {
  await withWorkDir(async (workDir, outputDir) => {
    const sourceVideoPath = join(workDir, "source.mp4");
    await buildBlueVideo(sourceVideoPath, { duration: 2 });
    const adapter = new FfmpegProductCompositingAdapter();
    await assert.rejects(() => adapter.buildAssistedPackage({
      assetId: "asset-1", sourceVideoPath, sourceVideoDurationSeconds: 2,
      screenType: "phone", referenceTimestamps: [10], outputDir,
    }));
  });
});
