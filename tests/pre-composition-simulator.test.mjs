import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { simulatePreComposition } = await imp("dist/infrastructure/footage-acquisition/pre-composition-simulator.js");
const { resolveFfmpegBinaryPath } = await imp("dist/infrastructure/video-rendering/ffmpeg-binary.js");

function analysis(overrides = {}) {
  return {
    stage: "compositing_candidate",
    screenVisible: true,
    screenArea: 0.1,
    screenBoundingBoxFraction: { x: 0.3, y: 0.3, width: 0.3, height: 0.3 },
    referenceTimestampSeconds: 1,
    deviceOrientation: "front",
    deviceConfidence: 0.6,
    screenConfidence: 0.6,
    humanPresenceScore: 0.5,
    humanInteractionScore: 0.5,
    colorVarietyScore: 0.3,
    persistenceRatio: 0.8,
    framesAnalyzed: 5,
    occlusionRisk: false,
    sharpnessSufficient: true,
    resolutionSufficient: true,
    aspectRatioPlausible: true,
    rejectionReasons: [],
    ...overrides,
  };
}

test("responde NAO com justificativa quando não há evidência visual (análise ausente) e finalStage vira rejected", async () => {
  const result = await simulatePreComposition({ analysis: undefined, width: 1080, height: 1920 });
  assert.equal(result.verdict, "NAO");
  assert.equal(result.finalStage, "rejected");
  assert.ok(result.justification.length > 10);
});

test("responde NAO e nunca eleva o estágio quando a análise ainda não chegou a compositing_candidate (ex.: screen_visible capado por oclusão)", async () => {
  const result = await simulatePreComposition({ analysis: analysis({ stage: "screen_visible" }), width: 1080, height: 1920 });
  assert.equal(result.verdict, "NAO");
  assert.equal(result.finalStage, "screen_visible");
});

test("responde NAO quando nenhuma tela candidata foi detectada (sem bounding box), mesmo com stage forçado", async () => {
  const result = await simulatePreComposition({ analysis: analysis({ screenBoundingBoxFraction: undefined }), width: 1080, height: 1920 });
  assert.equal(result.verdict, "NAO");
});

test("responde NAO quando a área da região candidata é pequena demais", async () => {
  const result = await simulatePreComposition({
    analysis: analysis({ screenBoundingBoxFraction: { x: 0.5, y: 0.5, width: 0.01, height: 0.01 } }),
    width: 1080, height: 1920,
  });
  assert.equal(result.verdict, "NAO");
  assert.match(result.justification, /pequena demais|Área/i);
  assert.equal(result.finalStage, "compositing_candidate");
});

test("responde SIM e eleva finalStage a compositing_ready quando todos os critérios geométricos passam", async () => {
  const result = await simulatePreComposition({ analysis: analysis(), width: 1080, height: 1920 });
  assert.equal(result.verdict, "SIM");
  assert.equal(result.finalStage, "compositing_ready");
  assert.match(result.justification, /revisão humana/i);
});

test("nunca lança exceção para nenhuma combinação de entrada", async () => {
  await assert.doesNotReject(() => simulatePreComposition({ analysis: undefined, width: 0, height: 0 }));
  await assert.doesNotReject(() => simulatePreComposition({ analysis: analysis({ screenArea: -1 }), width: -100, height: -100 }));
});

// ---------------------------------------------------------------------------------------------
// Seção 7 — geração real de artefatos de revisão (frame anotado + zoom), com ffmpeg de verdade.
// ---------------------------------------------------------------------------------------------

const FF = resolveFfmpegBinaryPath();
function run(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(FF, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (code) => (code === 0 ? resolvePromise() : rejectPromise(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))));
    child.on("error", rejectPromise);
  });
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

test("gera artefatos visuais reais (frame anotado + zoom) quando absolutePath/assetId/artifactsDir são fornecidos e o verdict é SIM", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "zuno-precomposition-"));
  try {
    const videoPath = join(workDir, "clip.mp4");
    await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x336699:s=1080x1920:d=1:r=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
    const artifactsDir = join(workDir, "review-artifacts");

    const result = await simulatePreComposition({
      analysis: analysis({ referenceTimestampSeconds: 0.3 }), width: 1080, height: 1920,
      absolutePath: videoPath, assetId: "test-asset-1", artifactsDir,
    });

    assert.equal(result.verdict, "SIM");
    assert.ok(result.artifacts, "esperava artefatos gerados");
    assert.ok(result.artifacts.annotatedFramePath, "esperava caminho do frame anotado");
    assert.ok(result.artifacts.zoomFramePath, "esperava caminho do zoom");
    assert.ok(await fileExists(result.artifacts.annotatedFramePath), "arquivo do frame anotado deveria existir de verdade");
    assert.ok(await fileExists(result.artifacts.zoomFramePath), "arquivo do zoom deveria existir de verdade");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("nunca gera artefatos quando o verdict é NAO (nada para anotar)", async () => {
  const workDir = await mkdtemp(join(tmpdir(), "zuno-precomposition-nao-"));
  try {
    const result = await simulatePreComposition({
      analysis: analysis({ stage: "probable_screen" }), width: 1080, height: 1920,
      absolutePath: join(workDir, "clip.mp4"), assetId: "test-asset-2", artifactsDir: join(workDir, "review-artifacts"),
    });
    assert.equal(result.verdict, "NAO");
    assert.equal(result.artifacts, undefined);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});
