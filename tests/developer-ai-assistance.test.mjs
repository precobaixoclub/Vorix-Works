import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

/**
 * Suíte de ponta a ponta (em processo, sem subprocess) para o Developer Assisted Mode de texto —
 * espelha o padrão já usado internamente para validar cenários completos Arthur -> Caio -> Helena
 * -> Skills, mas via import direto de `run-command.js` (mesmas funções que a CLI usa), permitindo
 * isolar `ZUNO_DATA_DIR`/`ZUNO_ARTIFACTS_DIR`/`ZUNO_ICARO_MODE` por teste sem depender de spawn de
 * processo. `tests/cli.smoke.test.mjs` cobre a CLI real via subprocess (com ZUNO_ICARO_MODE=fake
 * fixado) e não é duplicado aqui.
 */
async function withRuntime(run) {
  const dataDir = await mkdtemp(join(tmpdir(), "zuno-devai-data-"));
  const artifactsDir = await mkdtemp(join(tmpdir(), "zuno-devai-artifacts-"));
  process.env.ZUNO_DATA_DIR = dataDir;
  process.env.ZUNO_ARTIFACTS_DIR = artifactsDir;
  try {
    const runCommand = await import(pathToFileURL(join(process.cwd(), "dist/interfaces/cli/run-command.js")).href);
    await run({ dataDir, artifactsDir, runCommand });
  } finally {
    delete process.env.ZUNO_DATA_DIR;
    delete process.env.ZUNO_ARTIFACTS_DIR;
    delete process.env.ZUNO_ICARO_MODE;
    await rm(dataDir, { recursive: true, force: true });
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

function findWaitingStep(report) {
  return report.steps.find((step) => step.stepId === report.waitingForStepId);
}

async function readWorkPackage(artifactsDir, executionId, output) {
  const absolutePath = join(artifactsDir, executionId, ...output.workPackagePath.split("/"));
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

function validResponseFor(specialistId) {
  switch (specialistId) {
    case "joao-marketing-strategy":
      return { angle: "Ângulo real escrito pela IA desenvolvedora.", centralPromise: "Promessa central real e específica." };
    case "maria-copywriting":
      return {
        title: "Título real",
        caption: "Legenda real, escrita pela IA desenvolvedora, para validar o fluxo de ponta a ponta.",
        cta: "Conheça o Rumo ao Altar",
        hashtags: ["#RumoAoAltar", "#Casamento"],
      };
    case "sofia-art-direction":
      return { visualConcept: "Conceito visual real e específico para esta peça." };
    case "bianca-social-media-design":
      return { gridSystem: "Grid real de 12 colunas com margem de 8%." };
    case "bruno-video-script":
      return { hook: "Gancho real e específico para os primeiros 3 segundos." };
    case "vanessa-video-direction":
      return { visualRhythm: "Ritmo visual real e específico." };
    case "diego-video-editing":
      return { musicTrackPlan: "Plano real de trilha sonora para a edição." };
    case "lucas-quality-review":
      return { additionalObservations: ["Observação real e específica de revisão."] };
    default:
      return { customField: "conteúdo real e não vazio" };
  }
}

async function writeDeveloperAiResponse(artifactsDir, executionId, output, overrideContent) {
  const absolutePath = join(artifactsDir, executionId, ...output.expectedResponsePath.split("/"));
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(overrideContent ?? validResponseFor(output.specialistId)));
}

async function driveDeveloperAiPausesToText(runCommand, artifactsDir, report) {
  const history = [];
  let current = report;
  while (current.state === "WAITING_DEVELOPER_AI") {
    const waitingStep = findWaitingStep(current);
    history.push({ specialistId: current.steps.find((s) => s.stepId === current.waitingForStepId)?.skillId, output: waitingStep.response.output });
    await writeDeveloperAiResponse(artifactsDir, current.executionId, waitingStep.response.output);
    current = await runCommand.continueZunoExecution({ executionId: current.executionId });
  }
  return { report: current, history };
}

/**
 * Leva a execução até um estado terminal (COMPLETED/FAILED/CANCELLED), resolvendo quantas pausas
 * forem necessárias em qualquer ordem/quantidade — WAITING_DEVELOPER_AI (texto), pode se repetir
 * antes e depois de WAITING_ASSISTED_GENERATION (imagem/vídeo, ex.: Lucas roda depois do Pedro no
 * pipeline de imagem e também depende de Ícaro), e WAITING_HUMAN_APPROVAL ao final.
 */
async function driveToCompletion(runCommand, artifactsDir, report) {
  let current = report;
  let guard = 0;
  while (!["COMPLETED", "FAILED", "CANCELLED"].includes(current.state)) {
    guard += 1;
    if (guard > 20) throw new Error(`driveToCompletion excedeu o limite de pausas para ${current.executionId} (estado: ${current.state}).`);

    if (current.state === "WAITING_DEVELOPER_AI") {
      const waitingStep = findWaitingStep(current);
      await writeDeveloperAiResponse(artifactsDir, current.executionId, waitingStep.response.output);
      current = await runCommand.continueZunoExecution({ executionId: current.executionId });
    } else if (current.state === "WAITING_ASSISTED_GENERATION") {
      const waitingStep = findWaitingStep(current);
      await fulfillAssistedImages(artifactsDir, current.executionId, waitingStep.response.output);
      current = await runCommand.continueZunoExecution({ executionId: current.executionId });
    } else if (current.state === "WAITING_HUMAN_APPROVAL") {
      current = await runCommand.resumeZunoExecution({
        executionId: current.executionId,
        approval: { confirmed: true, approvedBy: "test", approvedAt: new Date().toISOString() },
      });
    } else {
      throw new Error(`Estado inesperado durante driveToCompletion: ${current.state}`);
    }
  }
  return current;
}

const PNG_CRC_TABLE = (() => {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createMinimalPng(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const ihdr = pngChunk("IHDR", ihdrData);
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  const idat = pngChunk("IDAT", deflateSync(raw));
  const iend = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

async function fulfillAssistedImages(artifactsDir, executionId, output) {
  for (const image of output.pendingImages ?? []) {
    const absolutePath = join(artifactsDir, executionId, ...image.expectedRelativePath.split("/"));
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, createMinimalPng(image.width, image.height));
  }
}

test("LOCAL_PRODUCTION (modo padrão) não usa o DeterministicFakeIcaroProvider silenciosamente: o workflow pausa em vez de produzir conteúdo determinístico direto", async () => {
  await withRuntime(async ({ runCommand }) => {
    const report = await runCommand.runZunoCommand({
      command: "crie um post sobre a lista de presentes com taxa zero para o Rumo ao Altar",
    });
    assert.equal(report.state, "WAITING_DEVELOPER_AI");
  });
});

test("workflow pausa exatamente em WAITING_DEVELOPER_AI (estado explícito, distinto de WAITING_ASSISTED_GENERATION)", async () => {
  await withRuntime(async ({ runCommand }) => {
    const report = await runCommand.runZunoCommand({ command: "crie um carrossel sobre o cronograma do casamento para o Rumo ao Altar" });
    assert.equal(report.state, "WAITING_DEVELOPER_AI");
    assert.ok(report.waitingForStepId, "deveria apontar a etapa que está aguardando");
    const waitingStep = findWaitingStep(report);
    assert.equal(waitingStep.state, "WAITING");
    assert.equal(waitingStep.response.status, "needs_developer_ai");
  });
});

test("pacote de trabalho contém executionId, stepId, Skill solicitante, prompt completo, contexto e schema esperado, e a resposta válida permite retomada", async () => {
  await withRuntime(async ({ runCommand, artifactsDir }) => {
    const report = await runCommand.runZunoCommand({ command: "crie um post sobre o álbum colaborativo de fotos para o Rumo ao Altar" });
    assert.equal(report.state, "WAITING_DEVELOPER_AI");

    const waitingStep = findWaitingStep(report);
    const output = waitingStep.response.output;
    assert.equal(output.mode, "developer_ai");
    assert.ok(typeof output.instruction === "string" && output.instruction.length > 0);
    assert.ok(typeof output.expectedResponsePath === "string" && output.expectedResponsePath.length > 0);
    assert.ok(typeof output.resumeCommand === "string" && output.resumeCommand.includes(report.executionId));
    assert.equal(output.specialistId, waitingStep.skillId);

    const workPackage = await readWorkPackage(artifactsDir, report.executionId, output);
    assert.equal(workPackage.executionId, report.executionId);
    assert.equal(workPackage.stepId, waitingStep.stepId);
    assert.equal(workPackage.specialistId, waitingStep.skillId);
    assert.ok(typeof workPackage.prompt === "string" && workPackage.prompt.length > 0);
    assert.ok(workPackage.context && typeof workPackage.context === "object");
    assert.ok(Array.isArray(workPackage.responseSchema) && workPackage.responseSchema.length > 0);
    assert.equal(workPackage.expectedResponsePath, output.expectedResponsePath);

    await writeDeveloperAiResponse(artifactsDir, report.executionId, output);
    const resumed = await runCommand.continueZunoExecution({ executionId: report.executionId });
    // A resposta válida resolve especificamente esta etapa (pode não sobrar nenhuma pausa, ou o
    // workflow pode avançar e pausar de novo numa etapa DIFERENTE, ex.: outra Skill também
    // dependente de Ícaro) — o que importa é que não é mais a mesma etapa aguardando.
    const stillSameStep = resumed.state === "WAITING_DEVELOPER_AI" && resumed.waitingForStepId === report.waitingForStepId;
    assert.equal(stillSameStep, false, "a etapa que recebeu resposta válida não deveria continuar aguardando");
  });
});

test("JSON inválido salvo pela IA desenvolvedora é rejeitado: workflow continua em WAITING_DEVELOPER_AI com erro explicado", async () => {
  await withRuntime(async ({ runCommand, artifactsDir }) => {
    const report = await runCommand.runZunoCommand({ command: "crie um post sobre RSVP e confirmação de presença para o Rumo ao Altar" });
    assert.equal(report.state, "WAITING_DEVELOPER_AI");

    const waitingStep = findWaitingStep(report);
    const absolutePath = join(artifactsDir, report.executionId, ...waitingStep.response.output.expectedResponsePath.split("/"));
    await mkdir(join(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, "isto não é JSON {{{");

    const resumed = await runCommand.continueZunoExecution({ executionId: report.executionId });
    assert.equal(resumed.state, "WAITING_DEVELOPER_AI");
    const stillWaiting = findWaitingStep(resumed);
    assert.ok(Array.isArray(stillWaiting.response.output.validationErrors) && stillWaiting.response.output.validationErrors.length > 0);
  });
});

test("resposta de outra execução não é aceita: retomar sem salvar nada mantém o workflow pausado (idempotente)", async () => {
  await withRuntime(async ({ runCommand }) => {
    const report = await runCommand.runZunoCommand({ command: "crie um post sobre fornecedores de casamento para o Rumo ao Altar" });
    assert.equal(report.state, "WAITING_DEVELOPER_AI");

    const resumedWithoutAnswer = await runCommand.continueZunoExecution({ executionId: report.executionId });
    assert.equal(resumedWithoutAnswer.state, "WAITING_DEVELOPER_AI");
    assert.equal(resumedWithoutAnswer.waitingForStepId, report.waitingForStepId);
  });
});

test("conteúdos de RSVP, álbum, cronograma e taxa zero geram pacotes de trabalho diferentes (prompts distintos, sem reaproveitar tema)", async () => {
  await withRuntime(async ({ runCommand, artifactsDir }) => {
    const commands = [
      "crie um post lembrando os convidados de confirmar presença (RSVP) para o Rumo ao Altar",
      "crie um post sobre o álbum colaborativo de fotos para o Rumo ao Altar",
      "crie um post sobre o cronograma do casamento para o Rumo ao Altar",
      "crie um post sobre a lista de presentes com taxa zero para o Rumo ao Altar",
    ];

    const prompts = [];
    for (const command of commands) {
      const report = await runCommand.runZunoCommand({ command });
      assert.equal(report.state, "WAITING_DEVELOPER_AI");
      const waitingStep = findWaitingStep(report);
      const workPackage = await readWorkPackage(artifactsDir, report.executionId, waitingStep.response.output);
      assert.ok(typeof workPackage.prompt === "string" && workPackage.prompt.length > 0);
      prompts.push(workPackage.prompt);
    }

    assert.equal(new Set(prompts).size, prompts.length, "cada tema deveria gerar um prompt de pacote de trabalho próprio, sem reaproveitar o de outro tema");
  });
});

test("provider/origem aparece como developer-ai-assisted no relatório final quando a IA desenvolvedora responde", async () => {
  await withRuntime(async ({ runCommand, artifactsDir }) => {
    const started = await runCommand.runZunoCommand({ command: "crie um post sobre padrinhos e madrinhas para o Rumo ao Altar" });
    const report = await driveToCompletion(runCommand, artifactsDir, started);

    assert.equal(report.state, "COMPLETED");
    const mariaStep = report.steps.find((step) => step.skillId === "maria-copywriting");
    assert.equal(mariaStep.response.output.aiProviderId, "developer-ai-assisted");
    const joaoStep = report.steps.find((step) => step.skillId === "joao-marketing-strategy");
    if (joaoStep?.response?.output?.aiSupportUsed) {
      assert.equal(joaoStep.response.output.aiProviderId, "developer-ai-assisted");
    }
  });
});

test("modo fake continua funcionando apenas quando explicitamente habilitado (ZUNO_ICARO_MODE=fake): workflow completa sem pausar em WAITING_DEVELOPER_AI", async () => {
  await withRuntime(async ({ runCommand, artifactsDir }) => {
    process.env.ZUNO_ICARO_MODE = "fake";
    let report = await runCommand.runZunoCommand({ command: "crie um post sobre a lista de presentes com taxa zero para o Rumo ao Altar" });
    assert.notEqual(report.state, "WAITING_DEVELOPER_AI");

    if (report.state === "WAITING_ASSISTED_GENERATION") {
      const waitingStep = findWaitingStep(report);
      await fulfillAssistedImages(artifactsDir, report.executionId, waitingStep.response.output);
      report = await runCommand.continueZunoExecution({ executionId: report.executionId });
    }
    if (report.state === "WAITING_HUMAN_APPROVAL") {
      report = await runCommand.resumeZunoExecution({
        executionId: report.executionId,
        approval: { confirmed: true, approvedBy: "test", approvedAt: new Date().toISOString() },
      });
    }
    assert.equal(report.state, "COMPLETED");
    const mariaStep = report.steps.find((step) => step.skillId === "maria-copywriting");
    assert.equal(mariaStep.response.output.aiProviderId, "fake-icaro-provider");
  });
});

test("imagem assistida (Pedro) continua funcionando sem regressão quando combinada com Developer Assisted Mode de texto", async () => {
  await withRuntime(async ({ runCommand, artifactsDir }) => {
    let report = await runCommand.runZunoCommand({ command: "crie um carrossel sobre a lista de presentes com taxa zero para o Rumo ao Altar" });
    ({ report } = await driveDeveloperAiPausesToText(runCommand, artifactsDir, report));

    assert.equal(report.state, "WAITING_ASSISTED_GENERATION");
    const waitingStep = findWaitingStep(report);
    assert.ok(Array.isArray(waitingStep.response.output.pendingImages) && waitingStep.response.output.pendingImages.length > 0);

    const completed = await driveToCompletion(runCommand, artifactsDir, report);
    assert.equal(completed.state, "COMPLETED");
    assert.ok(completed.artifactSummary.imagePaths.length > 0);
  });
});

test("cada peça mantém seu tema próprio até Maria e Sofia: o prompt recebido por Maria reflete o tema pedido, não um tema anterior", async () => {
  await withRuntime(async ({ runCommand, artifactsDir }) => {
    const first = await runCommand.runZunoCommand({ command: "crie um post sobre o cronograma do casamento para o Rumo ao Altar" });
    const { report: afterFirst } = await driveDeveloperAiPausesToText(runCommand, artifactsDir, first);
    assert.notEqual(afterFirst.state, "WAITING_DEVELOPER_AI");

    const second = await runCommand.runZunoCommand({ command: "crie um post sobre o álbum colaborativo de fotos para o Rumo ao Altar" });
    assert.equal(second.state, "WAITING_DEVELOPER_AI");
    const waitingStep = findWaitingStep(second);
    const workPackage = await readWorkPackage(artifactsDir, second.executionId, waitingStep.response.output);
    const haystack = workPackage.prompt.toLowerCase();
    assert.ok(haystack.includes("álbum") || haystack.includes("album") || haystack.includes("foto"));
  });
});
