import test from "node:test";
import assert from "node:assert/strict";
import { CaioWorkflowExecutor } from "../dist/application/workflows/caio.executor.js";
import { InMemoryCaioLogger } from "../dist/infrastructure/telemetry/in-memory-caio-logger.js";
import { InMemoryZunoEventRecorder } from "../dist/infrastructure/telemetry/in-memory-zuno-event-recorder.js";

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

function createPlan(steps) {
  return {
    id: "plan-test",
    createdBy: "arthur",
    tenant: {
      clientId: "client-rumo",
      tenantId: "tenant-rumo",
      source: "valentina",
    },
    intent: {
      id: "intent-test",
      objective: "Executar workflow de teste.",
      channels: ["instagram"],
      successCriteria: ["Executar sem providers externos."],
    },
    steps,
    acceptanceCriteria: ["Caio deve executar o plano sem modificá-lo."],
  };
}

function createSkillStep(id, order, name, capability, dependsOn = [], inputBindings) {
  return {
    id,
    order,
    type: "skill",
    name,
    skillCapability: capability,
    instructions: `Executar ${name}.`,
    input: { step: name },
    inputBindings,
    expectedOutput: `Saída de ${name}.`,
    dependsOn,
  };
}

function createHumanGateStep(id, order, dependsOn = []) {
  return {
    id,
    order,
    type: "human_gate",
    name: "Aprovação humana",
    instructions: "Aguardar aprovação humana.",
    input: {},
    expectedOutput: "Aprovação ou solicitação de ajustes.",
    dependsOn,
  };
}

function createSystemStep(id, order, dependsOn = []) {
  return {
    id,
    order,
    type: "system",
    name: "Preparar relatório interno",
    instructions: "Registrar etapa sistêmica local.",
    input: {},
    expectedOutput: "Etapa sistêmica concluída.",
    dependsOn,
  };
}

class FakeHelena {
  constructor(options = {}) {
    this.calls = [];
    this.failCapabilities = new Set(options.failCapabilities ?? []);
    this.throwCapabilities = new Set(options.throwCapabilities ?? []);
    this.responsesByCapability = options.responsesByCapability ?? {};
    // Por padrão toda capability tem uma Skill "pronta" — testes que querem simular uma
    // capability sem Skill implementada (checagem prévia do Caio) declaram missingCapabilities.
    this.missingCapabilities = new Set(options.missingCapabilities ?? []);
  }

  async discoverAndLoadSkills() {
    return [];
  }

  async findSkillByCapability(capability) {
    if (this.missingCapabilities.has(capability)) return undefined;
    return { manifest: { id: `skill-${capability}`, capabilities: [capability] }, state: "READY" };
  }

  async executeSkill(request) {
    this.calls.push(request);

    if (this.throwCapabilities.has(request.capability)) {
      throw new Error(`Falha lançada para ${request.capability}`);
    }

    if (this.failCapabilities.has(request.capability)) {
      return {
        skillId: `skill-${request.capability}`,
        state: "FAILED",
        response: {
          skillId: `skill-${request.capability}`,
          taskId: request.context.taskId,
          status: "failed",
          artifacts: [],
          warnings: [],
          error: {
            code: "CONTROLLED_SKILL_FAILURE",
            message: `Falha controlada em ${request.capability}`,
            recoverable: true,
          },
        },
      };
    }

    if (this.responsesByCapability[request.capability]) {
      return this.responsesByCapability[request.capability](request);
    }

    return {
      skillId: `skill-${request.capability}`,
      state: "COMPLETED",
      response: {
        skillId: `skill-${request.capability}`,
        taskId: request.context.taskId,
        status: "completed",
        output: { capability: request.capability, receivedInput: request.input },
        artifacts: [],
        warnings: [],
      },
    };
  }
}

function createCaio(helena) {
  const logger = new InMemoryCaioLogger();
  const events = new InMemoryZunoEventRecorder();
  const caio = new CaioWorkflowExecutor({
    helena,
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  });

  return { caio, logger, events };
}

test("Caio executa etapas sequenciais e chama Helena para cada etapa de Skill", async () => {
  const helena = new FakeHelena();
  const { caio, logger, events } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-strategy", 1, "Estratégia", "strategy"),
    createSkillStep("step-copy", 2, "Copy", "copywriting", ["step-strategy"]),
    createSystemStep("step-system", 3, ["step-copy"]),
  ]);

  const report = await caio.execute({ plan, dryRun: true, correlationId: "corr-test" });

  assert.equal(report.state, "COMPLETED");
  assert.equal(report.clientId, "client-rumo");
  assert.equal(report.tenantId, "tenant-rumo");
  assert.deepEqual(report.steps.map((step) => step.state), ["COMPLETED", "COMPLETED", "COMPLETED"]);
  assert.deepEqual(helena.calls.map((call) => call.capability), ["strategy", "copywriting"]);
  assert.equal(helena.calls[0].requestedBy, "caio");
  assert.equal(helena.calls[0].context.executionId, report.executionId);
  assert.equal(helena.calls[0].context.correlationId, "corr-test");
  assert.equal(report.planSnapshot, plan);
  assert.ok(logger.list().some((entry) => entry.action === "WorkflowCompleted"));
  assert.ok(events.list().some((event) => event.name === "ExecutionStarted"));
  assert.ok(events.list().some((event) => event.name === "ExecutionFinished"));
});

test("Caio agrega caminhos de entrega dos artefatos no relatório final do workflow", async () => {
  const helena = new FakeHelena({
    responsesByCapability: {
      image_generation: (request) => ({
        skillId: "pedro-image-generation",
        state: "COMPLETED",
        response: {
          skillId: "pedro-image-generation",
          taskId: request.context.taskId,
          status: "completed",
          output: {
            delivery: {
              htmlPath: "C:/zuno/artifacts/workflow-execution-0001/index.html",
              imagePaths: [
                "C:/zuno/artifacts/workflow-execution-0001/images/slide-01.png",
                "C:/zuno/artifacts/workflow-execution-0001/images/slide-02.png",
              ],
              captionPath: "C:/zuno/artifacts/workflow-execution-0001/caption.txt",
              metadataPath: "C:/zuno/artifacts/workflow-execution-0001/metadata.json",
              zipPath: "C:/zuno/artifacts/workflow-execution-0001/carousel.zip",
            },
          },
          artifacts: [],
          warnings: [],
        },
      }),
    },
  });
  const { caio } = createCaio(helena);
  const plan = createPlan([createSkillStep("step-image", 1, "Gerar imagens", "image_generation")]);

  const report = await caio.execute({ plan, dryRun: true });

  assert.equal(report.state, "COMPLETED");
  assert.deepEqual(report.artifactSummary.htmlPaths, ["C:/zuno/artifacts/workflow-execution-0001/index.html"]);
  assert.deepEqual(report.artifactSummary.imagePaths, [
    "C:/zuno/artifacts/workflow-execution-0001/images/slide-01.png",
    "C:/zuno/artifacts/workflow-execution-0001/images/slide-02.png",
  ]);
  assert.deepEqual(report.artifactSummary.captionPaths, ["C:/zuno/artifacts/workflow-execution-0001/caption.txt"]);
  assert.deepEqual(report.artifactSummary.metadataPaths, ["C:/zuno/artifacts/workflow-execution-0001/metadata.json"]);
  assert.deepEqual(report.artifactSummary.zipPaths, ["C:/zuno/artifacts/workflow-execution-0001/carousel.zip"]);
  assert.deepEqual(report.steps[0].artifactSummary.zipPaths, ["C:/zuno/artifacts/workflow-execution-0001/carousel.zip"]);
});

test("Caio pausa em human_gate e não executa etapas posteriores", async () => {
  const helena = new FakeHelena();
  const { caio, logger, events } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-copy", 1, "Copy", "copywriting"),
    createHumanGateStep("step-approval", 2, ["step-copy"]),
    createSkillStep("step-publish", 3, "Publicação", "social_publishing", ["step-approval"]),
  ]);

  const report = await caio.execute({ plan, dryRun: true });

  assert.equal(report.state, "WAITING_HUMAN_APPROVAL");
  assert.equal(report.waitingForStepId, "step-approval");
  assert.deepEqual(report.steps.map((step) => step.state), ["COMPLETED", "WAITING", "PENDING"]);
  assert.deepEqual(helena.calls.map((call) => call.capability), ["copywriting"]);
  assert.ok(report.message.includes("aprovação humana"));
  assert.ok(logger.list().some((entry) => entry.action === "StepWaitingHumanApproval"));
  assert.ok(events.list().some((event) => event.name === "WorkflowPaused"));
  assert.ok(!events.list().some((event) => event.payload?.stepId === "step-publish"));
});

test("Caio interrompe workflow quando Helena retorna falha de Skill", async () => {
  const helena = new FakeHelena({ failCapabilities: ["copywriting"] });
  const { caio, logger, events } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-copy", 1, "Copy", "copywriting"),
    createSkillStep("step-image", 2, "Imagem", "image_generation", ["step-copy"]),
  ]);

  const report = await caio.execute({ plan, dryRun: true });

  assert.equal(report.state, "FAILED");
  assert.equal(report.steps[0].state, "FAILED");
  assert.equal(report.steps[1].state, "PENDING");
  assert.deepEqual(helena.calls.map((call) => call.capability), ["copywriting"]);
  assert.equal(report.steps[0].error.code, "CONTROLLED_SKILL_FAILURE");
  assert.ok(logger.list().some((entry) => entry.action === "WorkflowFailed"));
  assert.ok(events.list().some((event) => event.name === "SkillFailed"));
  assert.ok(events.list().some((event) => event.name === "StepFailed"));
});

test("Caio transforma exceção da Helena em falha estruturada", async () => {
  const helena = new FakeHelena({ throwCapabilities: ["strategy"] });
  const { caio } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-strategy", 1, "Estratégia", "strategy"),
    createSkillStep("step-copy", 2, "Copy", "copywriting", ["step-strategy"]),
  ]);

  const report = await caio.execute({ plan, dryRun: true });

  assert.equal(report.state, "FAILED");
  assert.equal(report.steps[0].state, "FAILED");
  assert.equal(report.steps[0].error.code, "HELENA_EXECUTION_FAILED");
  assert.equal(report.steps[1].state, "PENDING");
  assert.deepEqual(helena.calls.map((call) => call.capability), ["strategy"]);
});

test("Caio rejeita plano que não foi criado por Arthur", async () => {
  const helena = new FakeHelena();
  const { caio } = createCaio(helena);
  const plan = {
    ...createPlan([createSkillStep("step-copy", 1, "Copy", "copywriting")]),
    createdBy: "helena",
  };

  await assert.rejects(
    () => caio.execute({ plan }),
    /planos criados pelo Arthur/,
  );
});

test("Caio falha imediatamente e de forma consolidada quando o plano exige capability sem Skill pronta, sem executar nenhuma etapa", async () => {
  const helena = new FakeHelena({ missingCapabilities: ["video_creation"] });
  const { caio, logger, events } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-strategy", 1, "Estratégia", "strategy"),
    createSkillStep("step-video", 2, "Vídeo", "video_creation", ["step-strategy"]),
  ]);

  const report = await caio.execute({ plan, dryRun: true });

  assert.equal(report.state, "FAILED");
  assert.ok(report.message.includes("video_creation"));
  assert.equal(helena.calls.length, 0);
  assert.deepEqual(report.steps.map((step) => step.state), ["PENDING", "PENDING"]);
  assert.ok(logger.list().some((entry) => entry.action === "WorkflowFailed" && Array.isArray(entry.metadata?.missingCapabilities) && entry.metadata.missingCapabilities.includes("video_creation")));
  assert.ok(events.list().some((event) => event.name === "ExecutionFinished" && event.payload?.missingCapabilities?.includes("video_creation")));
});

test("Caio consolida todas as capabilities faltantes do plano numa única falha, mesmo com mais de uma etapa sem Skill", async () => {
  const helena = new FakeHelena({ missingCapabilities: ["video_creation", "metrics_analysis"] });
  const { caio } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-video", 1, "Vídeo", "video_creation"),
    createSkillStep("step-metrics", 2, "Métricas", "metrics_analysis", ["step-video"]),
  ]);

  const report = await caio.execute({ plan, dryRun: true });

  assert.equal(report.state, "FAILED");
  assert.ok(report.message.includes("video_creation"));
  assert.ok(report.message.includes("metrics_analysis"));
});

test("Caio injeta publishingEnabled=true no workflowContext de cada etapa quando o plano inclui social_publishing", async () => {
  const helena = new FakeHelena();
  const { caio } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-strategy", 1, "Estratégia", "strategy"),
    createSkillStep("step-publish", 2, "Publicação", "social_publishing", ["step-strategy"]),
  ]);

  await caio.execute({ plan, dryRun: true });

  assert.equal(helena.calls.length, 2);
  for (const call of helena.calls) {
    assert.equal(call.input.workflowContext.publishingEnabled, true);
  }
});

test("Caio injeta publishingEnabled=false no workflowContext quando o plano não inclui social_publishing", async () => {
  const helena = new FakeHelena();
  const { caio } = createCaio(helena);
  const plan = createPlan([createSkillStep("step-strategy", 1, "Estratégia", "strategy")]);

  await caio.execute({ plan, dryRun: true });

  assert.equal(helena.calls[0].input.workflowContext.publishingEnabled, false);
});

test("Caio encadeia a saída real de uma etapa na entrada da próxima via inputBindings (substituição total, campo nomeado, sourcePath, pick e setter aninhado)", async () => {
  const helena = new FakeHelena({
    responsesByCapability: {
      strategy: (request) => ({
        skillId: "skill-strategy",
        state: "COMPLETED",
        response: {
          skillId: "skill-strategy",
          taskId: request.context.taskId,
          status: "completed",
          output: {
            mariaBriefing: { objective: "Testar encadeamento", channel: "instagram" },
            images: [
              { uri: "a", mimeType: "image/png", extra: "descartar" },
              { uri: "b", mimeType: "image/jpeg", extra: "descartar" },
            ],
          },
          artifacts: [],
          warnings: [],
        },
      }),
    },
  });
  const { caio } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-strategy", 1, "Estratégia", "strategy"),
    createSkillStep("step-copy", 2, "Copy", "copywriting", ["step-strategy"], [
      { targetField: null, fromStepId: "step-strategy", sourcePath: "mariaBriefing" },
    ]),
    createSkillStep("step-review", 3, "Revisão", "quality_review", ["step-strategy"], [
      { targetField: "images", fromStepId: "step-strategy", sourcePath: "images", pick: ["uri", "mimeType"] },
      { targetField: "mariaCopy.qualityScore", fromStepId: "step-strategy", sourcePath: "mariaBriefing.channel" },
    ]),
  ]);

  const report = await caio.execute({ plan, dryRun: true });

  assert.equal(report.state, "COMPLETED");
  const copyCall = helena.calls.find((call) => call.capability === "copywriting");
  assert.deepEqual(copyCall.input.objective, "Testar encadeamento");
  assert.deepEqual(copyCall.input.channel, "instagram");
  assert.equal(copyCall.input.step, undefined, "targetField null deve substituir o input inteiro, descartando o input genérico");
  assert.deepEqual(copyCall.input.workflowContext.upstreamSkillsReport, [
    { skillId: "skill-strategy", name: "Estratégia", state: "COMPLETED" },
  ]);

  const reviewCall = helena.calls.find((call) => call.capability === "quality_review");
  assert.deepEqual(reviewCall.input.images, [{ uri: "a", mimeType: "image/png" }, { uri: "b", mimeType: "image/jpeg" }]);
  assert.equal(reviewCall.input.step, "Revisão", "binding por campo nomeado não deve apagar o input genérico");
  assert.equal(reviewCall.input.mariaCopy.qualityScore, "instagram");
});

test("Caio ignora binding cuja etapa de origem ainda não concluiu, sem falhar o workflow", async () => {
  const helena = new FakeHelena();
  const { caio } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-a", 1, "A", "strategy"),
    createSkillStep("step-b", 2, "B", "copywriting", [], [
      { targetField: "fromA", fromStepId: "step-a", sourcePath: "nada" },
    ]),
  ]);

  const report = await caio.execute({ plan, dryRun: true });

  assert.equal(report.state, "COMPLETED");
  const callB = helena.calls.find((call) => call.capability === "copywriting");
  assert.equal(callB.input.fromA, undefined);
});

test("Caio.resume retoma workflow após aprovação humana e disponibiliza a decisão via binding humanApproval", async () => {
  const helena = new FakeHelena();
  const { caio, events } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-copy", 1, "Copy", "copywriting"),
    createHumanGateStep("step-approval", 2, ["step-copy"]),
    createSkillStep("step-publish", 3, "Publicação", "social_publishing", ["step-approval"], [
      { targetField: "humanApproval", fromStepId: "step-approval" },
    ]),
  ]);

  const waitingReport = await caio.execute({ plan, dryRun: true });
  assert.equal(waitingReport.state, "WAITING_HUMAN_APPROVAL");

  const resumedReport = await caio.resume(waitingReport.executionId, {
    confirmed: true,
    approvedBy: "qa@zuno.local",
    approvedAt: "2026-07-02T12:05:00.000Z",
  });

  assert.equal(resumedReport.state, "COMPLETED");
  assert.deepEqual(resumedReport.steps.map((step) => step.state), ["COMPLETED", "COMPLETED", "COMPLETED"]);
  const publishCall = helena.calls.find((call) => call.capability === "social_publishing");
  assert.deepEqual(publishCall.input.humanApproval, {
    confirmed: true,
    approvedBy: "qa@zuno.local",
    approvedAt: "2026-07-02T12:05:00.000Z",
  });
  assert.ok(events.list().some((event) => event.name === "WorkflowResumed"));
});

test("Caio.resume reprova e encerra o workflow quando a aprovação humana é negada", async () => {
  const helena = new FakeHelena();
  const { caio } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-copy", 1, "Copy", "copywriting"),
    createHumanGateStep("step-approval", 2, ["step-copy"]),
    createSkillStep("step-publish", 3, "Publicação", "social_publishing", ["step-approval"]),
  ]);

  const waitingReport = await caio.execute({ plan, dryRun: true });
  const rejectedReport = await caio.resume(waitingReport.executionId, { confirmed: false });

  assert.equal(rejectedReport.state, "FAILED");
  assert.equal(rejectedReport.steps[1].error.code, "HUMAN_APPROVAL_REJECTED");
  assert.equal(rejectedReport.steps[2].state, "PENDING");
  assert.equal(helena.calls.some((call) => call.capability === "social_publishing"), false);
});

function assistedGenerationResponse(request, status) {
  return {
    skillId: "pedro-image-generation",
    state: "COMPLETED",
    response: {
      skillId: "pedro-image-generation",
      taskId: request.context.taskId,
      status,
      output: status === "needs_assisted_generation"
        ? {
            mode: "developer_assisted",
            instruction: "Crie a imagem usando este prompt e salve neste caminho.",
            pendingImages: [{ index: 0, fileName: "slide-01.png", expectedRelativePath: "images/slide-01.png", mimeType: "image/png", width: 1080, height: 1080, prompt: "prompt de teste" }],
            resumeCommand: `npm run zuno -- --continue ${request.context.executionId}`,
          }
        : { generationMode: "developer_assisted", images: [{ index: 0 }] },
      artifacts: [],
      warnings: [],
    },
  };
}

test("Caio pausa em WAITING_ASSISTED_GENERATION quando uma Skill devolve needs_assisted_generation, sem executar etapas posteriores", async () => {
  const helena = new FakeHelena({
    responsesByCapability: {
      image_generation: (request) => assistedGenerationResponse(request, "needs_assisted_generation"),
    },
  });
  const { caio, logger, events } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-image", 1, "Geração de imagem", "image_generation"),
    createSkillStep("step-review", 2, "Revisão", "quality_review", ["step-image"]),
  ]);

  const report = await caio.execute({ plan, dryRun: true });

  assert.equal(report.state, "WAITING_ASSISTED_GENERATION");
  assert.equal(report.waitingForStepId, "step-image");
  assert.deepEqual(report.steps.map((step) => step.state), ["WAITING", "PENDING"]);
  assert.deepEqual(helena.calls.map((call) => call.capability), ["image_generation"]);
  assert.ok(logger.list().some((entry) => entry.action === "StepWaitingAssistedGeneration"));
  assert.ok(events.list().some((event) => event.name === "WorkflowPaused" && event.payload?.reason === "assisted_generation"));
});

test("Caio.resumeAssistedGeneration reexecuta a mesma etapa e completa o workflow quando a Skill agora completa", async () => {
  let callCount = 0;
  const helena = new FakeHelena({
    responsesByCapability: {
      image_generation: (request) => {
        callCount += 1;
        return assistedGenerationResponse(request, callCount === 1 ? "needs_assisted_generation" : "completed");
      },
    },
  });
  const { caio, events } = createCaio(helena);
  const plan = createPlan([createSkillStep("step-image", 1, "Geração de imagem", "image_generation")]);

  const waitingReport = await caio.execute({ plan, dryRun: true });
  assert.equal(waitingReport.state, "WAITING_ASSISTED_GENERATION");

  const report = await caio.resumeAssistedGeneration(waitingReport.executionId);

  assert.equal(report.state, "COMPLETED");
  assert.equal(report.steps[0].state, "COMPLETED");
  assert.equal(callCount, 2);
  assert.ok(events.list().some((event) => event.name === "WorkflowResumed" && event.payload?.reason === "assisted_generation"));
});

test("Caio.resumeAssistedGeneration pausa novamente com a mesma etapa quando o artefato ainda não existe (retomada idempotente)", async () => {
  const helena = new FakeHelena({
    responsesByCapability: {
      image_generation: (request) => assistedGenerationResponse(request, "needs_assisted_generation"),
    },
  });
  const { caio } = createCaio(helena);
  const plan = createPlan([createSkillStep("step-image", 1, "Geração de imagem", "image_generation")]);

  const waitingReport = await caio.execute({ plan, dryRun: true });
  const stillWaitingReport = await caio.resumeAssistedGeneration(waitingReport.executionId);

  assert.equal(stillWaitingReport.state, "WAITING_ASSISTED_GENERATION");
  assert.equal(stillWaitingReport.waitingForStepId, "step-image");
  assert.equal(helena.calls.length, 2);
});

test("Caio.resumeAssistedGeneration rejeita execução inexistente e workflow que não está aguardando geração assistida", async () => {
  const helena = new FakeHelena();
  const { caio } = createCaio(helena);

  await assert.rejects(() => caio.resumeAssistedGeneration("execucao-inexistente"), /não encontrada/);

  const plan = createPlan([createSkillStep("step-copy", 1, "Copy", "copywriting")]);
  const completedReport = await caio.execute({ plan, dryRun: true });
  assert.equal(completedReport.state, "COMPLETED");

  const idempotent = await caio.resumeAssistedGeneration(completedReport.executionId);
  assert.equal(idempotent.state, "COMPLETED");

  const humanGatePlan = createPlan([
    createSkillStep("step-copy", 1, "Copy", "copywriting"),
    createHumanGateStep("step-approval", 2, ["step-copy"]),
  ]);
  const waitingHumanReport = await caio.execute({ plan: humanGatePlan, dryRun: true });
  assert.equal(waitingHumanReport.state, "WAITING_HUMAN_APPROVAL");
  await assert.rejects(() => caio.resumeAssistedGeneration(waitingHumanReport.executionId), /não está aguardando geração assistida/);
});

test("Caio.resume rejeita execução inexistente e workflow que não está aguardando aprovação", async () => {
  const helena = new FakeHelena();
  const { caio } = createCaio(helena);

  await assert.rejects(() => caio.resume("execucao-inexistente", { confirmed: true }), /não encontrada/);

  const plan = createPlan([createSkillStep("step-copy", 1, "Copy", "copywriting")]);
  const completedReport = await caio.execute({ plan, dryRun: true });
  assert.equal(completedReport.state, "COMPLETED");

  const idempotent = await caio.resume(completedReport.executionId, { confirmed: true });
  assert.equal(idempotent.state, "COMPLETED");
});

test("Caio.hydrateExecution permite retomar um workflow pausado a partir de uma instância nova (persistência entre processos)", async () => {
  const helena = new FakeHelena();
  const { caio: firstCaio } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-copy", 1, "Copy", "copywriting"),
    createHumanGateStep("step-approval", 2, ["step-copy"]),
    createSkillStep("step-publish", 3, "Publicação", "social_publishing", ["step-approval"]),
  ]);

  const waitingReport = await firstCaio.execute({ plan, dryRun: true });
  const serialized = JSON.parse(JSON.stringify(waitingReport));

  const { caio: secondCaio } = createCaio(new FakeHelena());
  assert.equal(secondCaio.getExecution(waitingReport.executionId), undefined);

  secondCaio.hydrateExecution(serialized);
  const resumedReport = await secondCaio.resume(waitingReport.executionId, { confirmed: true });

  assert.equal(resumedReport.state, "COMPLETED");
});

test("Caio armazena execução e permite cancelar workflow pausado", async () => {
  const helena = new FakeHelena();
  const { caio, logger, events } = createCaio(helena);
  const plan = createPlan([
    createSkillStep("step-copy", 1, "Copy", "copywriting"),
    createHumanGateStep("step-approval", 2, ["step-copy"]),
    createSkillStep("step-publish", 3, "Publicação", "social_publishing", ["step-approval"]),
  ]);

  const waitingReport = await caio.execute({ plan, dryRun: true });
  assert.equal(caio.getExecution(waitingReport.executionId).state, "WAITING_HUMAN_APPROVAL");

  const cancelledReport = await caio.cancel(waitingReport.executionId, "Cancelado no teste.");

  assert.equal(cancelledReport.state, "CANCELLED");
  assert.equal(cancelledReport.steps[1].state, "SKIPPED");
  assert.equal(cancelledReport.steps[2].state, "SKIPPED");
  assert.ok(logger.list().some((entry) => entry.action === "WorkflowCancelled"));
  assert.ok(events.list().some((event) => event.name === "ExecutionCancelled"));
});
