import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { analyzeVisualCandidate, classifyVisualEvidence } = await imp("dist/infrastructure/footage-acquisition/visual-candidate-validator.js");
const { resolveFfmpegBinaryPath } = await imp("dist/infrastructure/video-rendering/ffmpeg-binary.js");

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

/** Sinal "tela" que NÃO SE MOVE entre frames (fractal congelado num único frame estático, depois reaproveitado como imagem por toda a duração) — evita o problema do fixture antigo (mandelbrot ANIMADO com `rate=6` migra de posição/zoom a cada frame, o que o novo detector de PERSISTÊNCIA corretamente rejeitaria, já que uma tela real de app não "anda" pelo quadro). */
async function buildPersistentScreenLikeVideo(workDir, path) {
  const frame = join(workDir, "frozen-frame.png");
  await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "mandelbrot=size=110x180:rate=1", "-frames:v", "1", frame]);
  await run([
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x101010:s=200x300:d=2:r=6",
    "-loop", "1", "-i", frame,
    "-filter_complex", "[1:v]format=rgba[fg];[0:v][fg]overlay=45:60",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "2", path,
  ]);
}

/** Sinal de FALSO POSITIVO real e comprovado (relatório da sprint anterior): superfície de cor quase uniforme, brilhante, persistente — mimetiza a borda de uma capa de celular. Contraste local (ruído sutil) suficiente para acionar o cluster antigo, mas SEM variedade de cor entre blocos (a diferença central do novo discriminador). */
async function buildUniformColorPersistentRegion(workDir, path) {
  const frame = join(workDir, "solid-frame.png");
  // Ruído leve sobre uma cor sólida (laranja) para simular a textura/reflexo de uma capa plástica real, sem introduzir variedade de COR (todos os pixels permanecem próximos do mesmo matiz).
  await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xd97a2e:s=110x180", "-vf", "noise=alls=12:allf=t", "-frames:v", "1", frame]);
  await run([
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x101010:s=200x300:d=2:r=6",
    "-loop", "1", "-i", frame,
    "-filter_complex", "[1:v]format=rgba[fg];[0:v][fg]overlay=45:60",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", "2", path,
  ]);
}

async function buildUniformDarkVideo(path) {
  await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x202020:s=200x300:d=2:r=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

async function buildSkinToneVideo(path) {
  await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xc8966e:s=200x300:d=2:r=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

async function buildBlueVideo(path) {
  await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x0000ff:s=200x300:d=2:r=6", "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
}

async function withWorkDir(run_) {
  const workDir = await mkdtemp(join(tmpdir(), "zuno-visual-candidate-"));
  try {
    await run_(workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Integração real (ffmpeg) — poucos casos, cada um provando UMA transição de estágio real.
// ---------------------------------------------------------------------------------------------

test("analyzeVisualCandidate chega a screen_visible para uma região persistente, com variedade de cor e contraste real (sem exigência de dispositivo)", async () => {
  await withWorkDir(async (workDir) => {
    const path = join(workDir, "screen-like.mp4");
    await buildPersistentScreenLikeVideo(workDir, path);
    const analysis = await analyzeVisualCandidate(path, 2, 200, 300);
    assert.ok(analysis);
    assert.ok(["screen_visible", "compositing_candidate"].includes(analysis.stage), `esperava screen_visible+, recebeu ${analysis.stage}`);
    assert.equal(analysis.screenVisible, true);
    assert.ok(analysis.persistenceRatio >= 0.6, `esperava persistência alta, recebeu ${analysis.persistenceRatio}`);
    assert.ok(analysis.colorVarietyScore > 0, "variedade de cor deveria ser > 0 para um fractal real");
  });
});

test("analyzeVisualCandidate chega a compositing_candidate quando dispositivo+resolução+geometria também são plausíveis", async () => {
  await withWorkDir(async (workDir) => {
    const path = join(workDir, "screen-like.mp4");
    await buildPersistentScreenLikeVideo(workDir, path);
    const analysis = await analyzeVisualCandidate(path, 2, 1080, 1920, { device: "phone", screenVisibleRequired: true });
    assert.ok(analysis);
    assert.equal(analysis.stage, "compositing_candidate");
    assert.ok(analysis.deviceConfidence > 0);
  });
});

test("analyzeVisualCandidate NUNCA declara screenVisible=true para um frame uniformemente escuro (nenhum cluster)", async () => {
  await withWorkDir(async (workDir) => {
    const path = join(workDir, "uniform-dark.mp4");
    await buildUniformDarkVideo(path);
    const analysis = await analyzeVisualCandidate(path, 2, 200, 300);
    assert.ok(analysis);
    assert.equal(analysis.stage, "no_device_detected");
    assert.equal(analysis.screenVisible, false);
    assert.equal(analysis.deviceOrientation, "unknown");
  });
});

test("analyzeVisualCandidate NUNCA avança além de probable_screen para uma superfície de cor quase uniforme (caso real: borda de capa de celular) — o discriminador de variedade de cor é o que barra isso, nunca brilho/contraste isolado", async () => {
  await withWorkDir(async (workDir) => {
    const path = join(workDir, "uniform-color.mp4");
    await buildUniformColorPersistentRegion(workDir, path);
    const analysis = await analyzeVisualCandidate(path, 2, 1080, 1920, { device: "phone", screenVisibleRequired: true });
    assert.ok(analysis);
    assert.ok(!["screen_visible", "compositing_candidate", "compositing_ready"].includes(analysis.stage), `esperava estágio <= probable_screen, recebeu ${analysis.stage}`);
    assert.equal(analysis.screenVisible, false);
  });
});

test("analyzeVisualCandidate: humanPresenceScore alto para cor dominante de tom de pele (sem nenhum dispositivo candidato)", async () => {
  await withWorkDir(async (workDir) => {
    const path = join(workDir, "skin.mp4");
    await buildSkinToneVideo(path);
    const analysis = await analyzeVisualCandidate(path, 2, 200, 300);
    assert.ok(analysis);
    assert.ok(analysis.humanPresenceScore > 0.5, `esperava presença alta, recebeu ${analysis.humanPresenceScore}`);
    // Seção 4: sem região candidata nenhuma, não existe "dispositivo" para interagir — interactionScore é sempre 0, mesmo com presença humana alta em outro lugar do frame.
    assert.equal(analysis.humanInteractionScore, 0);
  });
});

test("analyzeVisualCandidate: humanPresenceScore baixo/zero para uma cor claramente não-pele (azul puro)", async () => {
  await withWorkDir(async (workDir) => {
    const path = join(workDir, "blue.mp4");
    await buildBlueVideo(path);
    const analysis = await analyzeVisualCandidate(path, 2, 200, 300);
    assert.ok(analysis);
    assert.equal(analysis.humanPresenceScore, 0);
  });
});

test("analyzeVisualCandidate marca resolutionSufficient corretamente (1080x1920 é o mínimo)", async () => {
  await withWorkDir(async (workDir) => {
    const path = join(workDir, "uniform-dark.mp4");
    await buildUniformDarkVideo(path);
    const lowRes = await analyzeVisualCandidate(path, 2, 640, 360);
    const highRes = await analyzeVisualCandidate(path, 2, 1080, 1920);
    assert.equal(lowRes.resolutionSufficient, false);
    assert.equal(highRes.resolutionSufficient, true);
  });
});

test("analyzeVisualCandidate devolve undefined (nunca lança) quando o arquivo não existe", async () => {
  const analysis = await analyzeVisualCandidate(join(process.cwd(), "nao-existe-de-verdade.mp4"), 2, 1080, 1920);
  assert.equal(analysis, undefined);
});

// ---------------------------------------------------------------------------------------------
// classifyVisualEvidence — escada de classificação pura, testada exaustivamente com evidência
// sintética (mais rápido e mais preciso que construir um vídeo real para cada combinação).
// ---------------------------------------------------------------------------------------------

function baseEvidence(overrides = {}) {
  return {
    screenAreaMax: 0.06,
    boundingFillRatioAtMax: 0.6,
    colorVarietyScore: 0.3,
    clusterContrast: 10,
    persistenceRatio: 0.8,
    framesAnalyzed: 5,
    expectedFrames: 5,
    aspectRatioPlausible: true,
    resolutionSufficient: true,
    occlusionRisk: false,
    humanInteractionScore: 0.5,
    interactionRequired: false,
    screenVisibleRequired: false,
    ...overrides,
  };
}

test("classifyVisualEvidence: nenhum cluster (screenAreaMax ~0) vira no_device_detected", () => {
  const { stage, rejectionReasons } = classifyVisualEvidence(baseEvidence({ screenAreaMax: 0, screenVisibleRequired: true }));
  assert.equal(stage, "no_device_detected");
  assert.ok(rejectionReasons.includes("no_screen"));
});

test("classifyVisualEvidence: geometria implausível (aspecto errado) trava em probable_device, mesmo com todo o resto perfeito", () => {
  const { stage, rejectionReasons } = classifyVisualEvidence(baseEvidence({ aspectRatioPlausible: false }));
  assert.equal(stage, "probable_device");
  assert.ok(rejectionReasons.includes("wrong_device"));
});

test("classifyVisualEvidence: poucos frames analisados (amostragem de baixa confiança) trava em probable_device", () => {
  const { stage } = classifyVisualEvidence(baseEvidence({ framesAnalyzed: 1, expectedFrames: 5 }));
  assert.equal(stage, "probable_device");
});

test("classifyVisualEvidence: persistência baixa entre frames trava em probable_device (região nova a cada frame, não a mesma tela)", () => {
  const { stage } = classifyVisualEvidence(baseEvidence({ persistenceRatio: 0.1 }));
  assert.equal(stage, "probable_device");
});

test("classifyVisualEvidence: área/preenchimento insuficientes travam em device_visible com screen_too_small", () => {
  const { stage, rejectionReasons } = classifyVisualEvidence(baseEvidence({ screenAreaMax: 0.01, boundingFillRatioAtMax: 0.9 }));
  assert.equal(stage, "device_visible");
  assert.ok(rejectionReasons.includes("screen_too_small"));
});

test("classifyVisualEvidence: variedade de cor baixa (caso real: capa de celular/superfície lisa) trava em probable_screen com visual_false_positive — NUNCA screen_visible só por brilho/contraste", () => {
  const { stage, rejectionReasons } = classifyVisualEvidence(baseEvidence({ colorVarietyScore: 0.02 }));
  assert.equal(stage, "probable_screen");
  assert.ok(rejectionReasons.includes("visual_false_positive"));
});

test("classifyVisualEvidence: persistência abaixo do piso de tela (mas acima do piso de dispositivo) trava em probable_screen", () => {
  const { stage } = classifyVisualEvidence(baseEvidence({ persistenceRatio: 0.5 }));
  assert.equal(stage, "probable_screen");
});

test("classifyVisualEvidence: nitidez insuficiente (região borrada) trava em probable_screen", () => {
  const { stage } = classifyVisualEvidence(baseEvidence({ clusterContrast: 1 }));
  assert.equal(stage, "probable_screen");
});

test("classifyVisualEvidence: interação extremamente baixa é sinal de falso positivo (seção 4) e força needs_human_review MESMO quando o Shot não exige interação", () => {
  const { stage, rejectionReasons } = classifyVisualEvidence(baseEvidence({ humanInteractionScore: 0.02, interactionRequired: false }));
  assert.equal(stage, "needs_human_review");
  assert.ok(rejectionReasons.includes("visual_false_positive"));
});

test("classifyVisualEvidence: oclusão crítica trava em screen_visible (nunca avança a compositing_candidate)", () => {
  const { stage, rejectionReasons } = classifyVisualEvidence(baseEvidence({ occlusionRisk: true }));
  assert.equal(stage, "screen_visible");
  assert.ok(rejectionReasons.includes("screen_occluded"));
});

test("classifyVisualEvidence: interação exigida pelo Shot mas abaixo do mínimo trava em screen_visible com interaction_missing", () => {
  // 0.1 fica ACIMA do piso de "sinal de falso positivo extremo" (0.08) mas ABAIXO do mínimo exigido
  // quando o Shot pede interação (0.12) — isola especificamente o ramo interaction_missing do ramo
  // needs_human_review (seção 4), que é testado separadamente acima.
  const { stage, rejectionReasons } = classifyVisualEvidence(baseEvidence({ interactionRequired: true, humanInteractionScore: 0.1 }));
  assert.equal(stage, "screen_visible");
  assert.ok(rejectionReasons.includes("interaction_missing"));
});

test("classifyVisualEvidence: resolução insuficiente trava em screen_visible (nunca chega a compositing_candidate)", () => {
  const { stage } = classifyVisualEvidence(baseEvidence({ resolutionSufficient: false }));
  assert.equal(stage, "screen_visible");
});

test("classifyVisualEvidence: todas as evidências combinadas avançam a compositing_candidate — NUNCA compositing_ready (isso só a Pre-composition Simulator decide)", () => {
  const { stage, rejectionReasons } = classifyVisualEvidence(baseEvidence());
  assert.equal(stage, "compositing_candidate");
  assert.deepEqual(rejectionReasons, []);
});
