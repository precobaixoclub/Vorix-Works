import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateLocalMusicPath } from "../dist/shared/utils/local-music-asset.js";
import { ArthurOrchestrator } from "../dist/application/orchestration/arthur.orchestrator.js";
import { CaioWorkflowExecutor } from "../dist/application/workflows/caio.executor.js";

function createDeterministicIdGenerator() {
  let nextNumber = 1;
  return {
    create(prefix) {
      const id = `${prefix}-${String(nextNumber).padStart(4, "0")}`;
      nextNumber += 1;
      return id;
    },
  };
}

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "zuno-music-validation-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("validateLocalMusicPath aceita um MP3 real existente", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "musica.mp3");
    await writeFile(filePath, Buffer.from([0xff, 0xfb, 0x90, 0x00]));
    const result = validateLocalMusicPath(filePath, dir);
    assert.equal(result.ok, true);
    assert.equal(result.absolutePath, filePath);
  });
});

test("validateLocalMusicPath aceita um WAV real existente", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "musica.wav");
    await writeFile(filePath, Buffer.from("RIFF....WAVEfmt "));
    const result = validateLocalMusicPath(filePath, dir);
    assert.equal(result.ok, true);
    assert.equal(result.absolutePath, filePath);
  });
});

test("validateLocalMusicPath resolve caminho relativo a partir do cwd informado", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "relativa.m4a"), Buffer.from("fake"));
    const result = validateLocalMusicPath("relativa.m4a", dir);
    assert.equal(result.ok, true);
    assert.equal(result.absolutePath, join(dir, "relativa.m4a"));
  });
});

test("validateLocalMusicPath rejeita arquivo inexistente", async () => {
  await withTempDir(async (dir) => {
    const result = validateLocalMusicPath(join(dir, "nao-existe.mp3"), dir);
    assert.equal(result.ok, false);
    assert.match(result.error, /não encontrado/);
  });
});

test("validateLocalMusicPath rejeita extensão fora da allowlist", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "musica.exe");
    await writeFile(filePath, Buffer.from("fake"));
    const result = validateLocalMusicPath(filePath, dir);
    assert.equal(result.ok, false);
    assert.match(result.error, /[Ee]xtensão/);
  });
});

test("validateLocalMusicPath bloqueia path traversal", () => {
  const result = validateLocalMusicPath("../../etc/musica.mp3", "/tmp/qualquer");
  assert.equal(result.ok, false);
  assert.match(result.error, /\.\./);
});

test("validateLocalMusicPath rejeita URL (file:// e http://), nunca baixa música da internet", () => {
  const fileResult = validateLocalMusicPath("file:///tmp/musica.mp3", "/tmp/qualquer");
  assert.equal(fileResult.ok, false);
  assert.match(fileResult.error, /URL/);

  const httpResult = validateLocalMusicPath("http://exemplo.com/musica.mp3", "/tmp/qualquer");
  assert.equal(httpResult.ok, false);
  assert.match(httpResult.error, /URL/);
});

test("validateLocalMusicPath rejeita caminho vazio", () => {
  const result = validateLocalMusicPath("   ", "/tmp/qualquer");
  assert.equal(result.ok, false);
});

test("Arthur embute localAssets.musicTrackPath na etapa de renderização de vídeo quando musicFilePath é informado", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });
  const musicFilePath = "/abs/assets/audio/music/minha-musica.mp3";

  const result = await arthur.planFromText({
    command: "Crie um vídeo para Reels de 30 segundos sobre RSVP do Rumo ao Altar.",
    clientId: "client-rumo",
    musicFilePath,
  });

  const renderingStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_rendering");
  assert.ok(renderingStep, "plano deveria conter a etapa de renderização de vídeo");
  assert.equal(renderingStep.input.localAssets?.musicTrackPath, musicFilePath);
});

test("Arthur não adiciona localAssets quando musicFilePath não é informado (comportamento atual preservado)", async () => {
  const arthur = new ArthurOrchestrator({ idGenerator: createDeterministicIdGenerator() });

  const result = await arthur.planFromText({
    command: "Crie um vídeo para Reels de 30 segundos sobre RSVP do Rumo ao Altar.",
    clientId: "client-rumo",
  });

  const renderingStep = result.executionPlan.steps.find((step) => step.skillCapability === "video_rendering");
  assert.equal(renderingStep.input.localAssets, undefined);
});

function fakeReportWithVideoRenderingStep(overrides = {}) {
  const videoStepId = "step-0006";
  return {
    executionId: "exec-music-test",
    planId: "plan-0001",
    clientId: "client-x",
    state: "WAITING_ASSISTED_GENERATION",
    startedAt: "2026-01-01T00:00:00.000Z",
    waitingForStepId: videoStepId,
    message: "Aguardando vídeo.",
    steps: [
      { stepId: videoStepId, order: 6, name: "Renderização de vídeo", type: "skill", skillCapability: "video_rendering", state: overrides.videoStepState ?? "WAITING" },
    ],
    artifactSummary: {
      htmlPaths: [], imagePaths: [], videoPaths: [], captionPaths: [], publicationPaths: [],
      metadataPaths: [], zipPaths: [], hashtagsPaths: [], reportPaths: [],
    },
    planSnapshot: {
      id: "plan-0001",
      intent: { id: "intent-1", objective: "Crie um vídeo para Reels." },
      createdBy: "arthur",
      tenant: { clientId: "client-x", source: "input" },
      steps: [
        {
          id: videoStepId,
          order: 6,
          type: "skill",
          name: "Renderização de vídeo",
          skillCapability: "video_rendering",
          instructions: "...",
          input: { videoObjective: "gerar vídeo", ...(overrides.existingInput ?? {}) },
          expectedOutput: "Vídeo final.",
          dependsOn: [],
        },
      ],
      acceptanceCriteria: [],
    },
    locale: "pt-BR",
    dryRun: true,
    mode: "LOCAL_PRODUCTION",
    correlationId: "exec-music-test",
  };
}

test("Caio.applyLocalMusicAsset injeta localAssets.musicTrackPath numa etapa de renderização de vídeo ainda pendente (cenário de --continue --music)", () => {
  const caio = new CaioWorkflowExecutor({ helena: {} });
  const report = fakeReportWithVideoRenderingStep();
  caio.hydrateExecution(report);

  const result = caio.applyLocalMusicAsset("exec-music-test", "/abs/musica.mp3");

  assert.equal(result.applied, true);
  const step = report.planSnapshot.steps.find((candidate) => candidate.skillCapability === "video_rendering");
  assert.equal(step.input.localAssets.musicTrackPath, "/abs/musica.mp3");
  assert.equal(step.input.videoObjective, "gerar vídeo", "resto do input original deveria ser preservado");
});

test("Caio.applyLocalMusicAsset preserva localAssets já existente (merge, nunca substitui outros campos)", () => {
  const caio = new CaioWorkflowExecutor({ helena: {} });
  const report = fakeReportWithVideoRenderingStep({ existingInput: { localAssets: { backgroundImagePathBySceneOrder: { 1: "/bg.png" } } } });
  caio.hydrateExecution(report);

  caio.applyLocalMusicAsset("exec-music-test", "/abs/musica.mp3");

  const step = report.planSnapshot.steps.find((candidate) => candidate.skillCapability === "video_rendering");
  assert.equal(step.input.localAssets.musicTrackPath, "/abs/musica.mp3");
  assert.equal(step.input.localAssets.backgroundImagePathBySceneOrder[1], "/bg.png");
});

test("Caio.applyLocalMusicAsset não aplica (applied: false) quando a etapa de renderização já foi concluída", () => {
  const caio = new CaioWorkflowExecutor({ helena: {} });
  const report = fakeReportWithVideoRenderingStep({ videoStepState: "COMPLETED" });
  caio.hydrateExecution(report);

  const result = caio.applyLocalMusicAsset("exec-music-test", "/abs/musica.mp3");

  assert.equal(result.applied, false);
  assert.match(result.reason, /já foi concluída/);
});

test("Caio.applyLocalMusicAsset não aplica (applied: false) quando o plano não tem etapa de renderização de vídeo", () => {
  const caio = new CaioWorkflowExecutor({ helena: {} });
  const report = fakeReportWithVideoRenderingStep();
  report.steps = [];
  caio.hydrateExecution(report);

  const result = caio.applyLocalMusicAsset("exec-music-test", "/abs/musica.mp3");

  assert.equal(result.applied, false);
  assert.match(result.reason, /não possui uma etapa/);
});

test("Caio.applyLocalMusicAsset lança erro para execução inexistente", () => {
  const caio = new CaioWorkflowExecutor({ helena: {} });
  assert.throws(() => caio.applyLocalMusicAsset("exec-nao-existe", "/abs/musica.mp3"), /não encontrada/);
});
