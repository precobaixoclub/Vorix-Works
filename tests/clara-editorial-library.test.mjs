import test from "node:test";
import assert from "node:assert/strict";
import {
  ClaraKnowledgeCenter,
  extractEditorialSignals,
  syncEditorialLibrary,
  syncQualityFeedbackToClara,
} from "../dist/application/knowledge/index.js";
import { InMemoryZunoEventRecorder, InMemoryClaraLogger } from "../dist/infrastructure/telemetry/index.js";
import { InMemoryClaraKnowledgeRepository } from "../dist/infrastructure/storage/index.js";
import { QualityFeedbackCenter } from "../dist/application/quality-feedback/index.js";
import { InMemoryQualityFeedbackRepository } from "../dist/infrastructure/storage/index.js";

const CLIENT_ID = "client-rumo";

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

function createClara() {
  const logger = new InMemoryClaraLogger();
  const events = new InMemoryZunoEventRecorder();
  const clara = new ClaraKnowledgeCenter({
    repository: new InMemoryClaraKnowledgeRepository(),
    logger,
    eventRecorder: events,
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-12T12:00:00.000Z"),
  });
  return { clara, logger, events };
}

function createQualityFeedback() {
  return new QualityFeedbackCenter({
    repository: new InMemoryQualityFeedbackRepository(),
    idGenerator: createDeterministicIdGenerator(),
    now: () => new Date("2026-07-12T12:00:00.000Z"),
  });
}

/** Constrói um WorkflowExecutionReport mínimo, só com os campos que a Biblioteca Editorial lê. */
function buildReport(overrides = {}) {
  const {
    executionId = "exec-0001",
    planId = "plan-0001",
    objective = "Tema padrão de teste",
    formatLabel = "Feed",
    cta = "Confira agora",
    caption = "Confira nossa lista de presentes 🎉 e a taxa zero 💍",
    hook,
    narrativeStructure,
  } = overrides;

  const steps = [
    {
      stepId: "step-editorial",
      order: 1,
      name: "Planejamento editorial",
      type: "skill",
      skillCapability: "editorial_planning",
      state: "COMPLETED",
      skillId: "eduardo-editorial-planning",
      response: { status: "completed", output: { campaignObjective: objective, recommendedFormatLabel: formatLabel } },
    },
    {
      stepId: "step-copy",
      order: 2,
      name: "Copywriting",
      type: "skill",
      skillCapability: "copywriting",
      state: "COMPLETED",
      skillId: "maria-copywriting",
      response: { status: "completed", output: { cta, caption } },
    },
  ];

  if (hook || narrativeStructure) {
    steps.push({
      stepId: "step-video-script",
      order: 3,
      name: "Roteiro de vídeo",
      type: "skill",
      skillCapability: "video_script",
      state: "COMPLETED",
      skillId: "bruno-video-script",
      response: { status: "completed", output: { hook, narrativeStructure } },
    });
  }

  return {
    executionId,
    planId,
    clientId: CLIENT_ID,
    state: "COMPLETED",
    startedAt: "2026-07-12T11:00:00.000Z",
    finishedAt: "2026-07-12T11:05:00.000Z",
    message: "Execução concluída.",
    steps,
    artifactSummary: {
      htmlPaths: [],
      imagePaths: [],
      videoPaths: [],
      captionPaths: [],
      publicationPaths: [],
      metadataPaths: [],
      zipPaths: [],
      hashtagsPaths: [],
      reportPaths: [],
    },
    planSnapshot: {
      id: planId,
      intent: { id: "intent-0001", objective },
      createdBy: "arthur",
      tenant: { clientId: CLIENT_ID },
      steps: [],
      acceptanceCriteria: [],
    },
    locale: "pt-BR",
    dryRun: false,
    mode: "local_production",
    correlationId: "corr-editorial-library",
  };
}

/** Constrói um QualityFeedbackRecord mínimo, só com os campos que a Biblioteca Editorial lê. */
function buildFeedback(overrides = {}) {
  const {
    executionId = "exec-0001",
    campaignId,
    format = "Feed",
    overallScore = 9,
    comment,
    submittedAt = "2026-07-12T11:10:00.000Z",
  } = overrides;
  return {
    id: `feedback-${executionId}`,
    executionId,
    clientId: CLIENT_ID,
    contentType: "imagem",
    format,
    skillsUsed: ["eduardo-editorial-planning", "maria-copywriting"],
    campaignId,
    overallScore,
    ratingInput: { kind: "score", value: overallScore },
    categoryScores: [],
    categoriesNeedingImprovement: [],
    comment,
    submittedAt,
  };
}

// ---------------------------------------------------------------------------------------------
// extractEditorialSignals — leitura pura dos sinais a partir do WorkflowExecutionReport
// ---------------------------------------------------------------------------------------------

test("extractEditorialSignals lê tema, formato e CTA dos passos já executados do report", () => {
  const report = buildReport({ objective: "Taxa zero no Rumo ao Altar", formatLabel: "Feed", cta: "Crie sua lista" });
  const signals = extractEditorialSignals(report);

  assert.equal(signals.theme, "Taxa zero no Rumo ao Altar");
  assert.equal(signals.format, "Feed");
  assert.equal(signals.cta, "Crie sua lista");
  assert.deepEqual(signals.emojis.sort(), ["🎉", "💍"].sort());
});

test("extractEditorialSignals usa planSnapshot.intent.objective como fallback quando Eduardo não define campaignObjective", () => {
  const report = buildReport({ objective: "Tema do intent" });
  report.steps[0].response.output = { recommendedFormatLabel: "Story" };
  const signals = extractEditorialSignals(report);

  assert.equal(signals.theme, "Tema do intent");
  assert.equal(signals.format, "Story");
});

test("extractEditorialSignals só preenche hook/storytelling quando o pipeline de vídeo (Bruno) participou da execução", () => {
  const withoutVideo = extractEditorialSignals(buildReport());
  assert.equal(withoutVideo.hook, undefined);
  assert.equal(withoutVideo.storytellingFramework, undefined);

  const withVideo = extractEditorialSignals(
    buildReport({ hook: "Você sabia que dá pra ter lista de presentes sem taxa?", narrativeStructure: "problema-solucao-cta" }),
  );
  assert.equal(withVideo.hook, "Você sabia que dá pra ter lista de presentes sem taxa?");
  assert.equal(withVideo.storytellingFramework, "problema-solucao-cta");
});

// ---------------------------------------------------------------------------------------------
// syncEditorialLibrary — criação, acumulação e derivações
// ---------------------------------------------------------------------------------------------

test("syncEditorialLibrary cria o registro na primeira sincronização de um cliente", async () => {
  const { clara } = createClara();
  const report = buildReport({ executionId: "exec-0001", objective: "Taxa zero no Rumo ao Altar" });
  const feedback = buildFeedback({ executionId: "exec-0001", overallScore: 9 });

  const record = await syncEditorialLibrary({
    clara,
    clientId: CLIENT_ID,
    report,
    feedbackRecord: feedback,
    now: () => new Date("2026-07-12T12:00:00.000Z"),
  });

  assert.equal(record.module, "EditorialLibraryContext");
  assert.equal(record.payload.producedContent.length, 1);
  assert.equal(record.payload.producedContent[0].executionId, "exec-0001");
  assert.equal(record.payload.producedContent[0].theme, "Taxa zero no Rumo ao Altar");
  assert.equal(record.payload.producedContent[0].score, 9);
  assert.equal(record.payload.lastSyncedAt, "2026-07-12T12:00:00.000Z");
});

test("syncEditorialLibrary acumula produções em sincronizações sucessivas, em vez de sobrescrever o histórico", async () => {
  const { clara } = createClara();

  await syncEditorialLibrary({
    clara,
    clientId: CLIENT_ID,
    report: buildReport({ executionId: "exec-0001", objective: "Taxa zero" }),
    feedbackRecord: buildFeedback({ executionId: "exec-0001", overallScore: 9 }),
  });
  const second = await syncEditorialLibrary({
    clara,
    clientId: CLIENT_ID,
    report: buildReport({ executionId: "exec-0002", objective: "RSVP sem complicação" }),
    feedbackRecord: buildFeedback({ executionId: "exec-0002", overallScore: 7 }),
  });

  assert.equal(second.payload.producedContent.length, 2);
  assert.deepEqual(
    second.payload.producedContent.map((entry) => entry.executionId).sort(),
    ["exec-0001", "exec-0002"],
  );
  // Mesmo registro (mesmo id) atualizado, nunca um segundo EditorialLibraryContext para o cliente.
  const all = await clara.list({ clientId: CLIENT_ID, module: "EditorialLibraryContext" });
  assert.equal(new Set(all.map((entry) => entry.id)).size, 1);
});

test("syncEditorialLibrary é idempotente para a mesma execução: resincronizar substitui a entrada, não duplica", async () => {
  const { clara } = createClara();
  const report = buildReport({ executionId: "exec-0001", objective: "Taxa zero" });

  await syncEditorialLibrary({ clara, clientId: CLIENT_ID, report, feedbackRecord: buildFeedback({ executionId: "exec-0001", overallScore: 5 }) });
  const resynced = await syncEditorialLibrary({
    clara,
    clientId: CLIENT_ID,
    report,
    feedbackRecord: buildFeedback({ executionId: "exec-0001", overallScore: 9 }),
  });

  assert.equal(resynced.payload.producedContent.length, 1);
  assert.equal(resynced.payload.producedContent[0].score, 9);
  assert.equal(resynced.payload.evaluations.length, 1);
  assert.equal(resynced.payload.evaluations[0].score, 9);
});

test("syncEditorialLibrary detecta tema repetido a partir de 3 ocorrências", async () => {
  const { clara } = createClara();
  for (const executionId of ["exec-0001", "exec-0002", "exec-0003"]) {
    await syncEditorialLibrary({
      clara,
      clientId: CLIENT_ID,
      report: buildReport({ executionId, objective: "Taxa zero" }),
      feedbackRecord: buildFeedback({ executionId, overallScore: 8 }),
    });
  }
  const record = (await clara.list({ clientId: CLIENT_ID, module: "EditorialLibraryContext" }))[0];

  assert.deepEqual(record.payload.repeatedSubjects, ["Taxa zero"]);
});

test("syncEditorialLibrary marca um tema como proibido temporariamente quando a média das avaliações fica abaixo do limiar de baixa performance", async () => {
  const { clara } = createClara();
  await syncEditorialLibrary({
    clara,
    clientId: CLIENT_ID,
    report: buildReport({ executionId: "exec-0001", objective: "Comparação de preços" }),
    feedbackRecord: buildFeedback({ executionId: "exec-0001", overallScore: 4 }),
  });
  const record = await syncEditorialLibrary({
    clara,
    clientId: CLIENT_ID,
    report: buildReport({ executionId: "exec-0002", objective: "Comparação de preços" }),
    feedbackRecord: buildFeedback({ executionId: "exec-0002", overallScore: 3 }),
  });

  assert.equal(record.payload.temporarilyForbiddenSubjects.length, 1);
  assert.equal(record.payload.temporarilyForbiddenSubjects[0].subject, "Comparação de preços");
  assert.match(record.payload.temporarilyForbiddenSubjects[0].reason, /Média de 3\.5 em 2 avaliações/);
});

test("syncEditorialLibrary classifica conteúdos campeões (nota >= 8) e de baixa performance (nota < 6) e deriva padrões de texto", async () => {
  const { clara } = createClara();
  await syncEditorialLibrary({
    clara,
    clientId: CLIENT_ID,
    report: buildReport({ executionId: "exec-champion", objective: "Taxa zero", formatLabel: "Feed" }),
    feedbackRecord: buildFeedback({ executionId: "exec-champion", overallScore: 9, format: "Feed" }),
  });
  const record = await syncEditorialLibrary({
    clara,
    clientId: CLIENT_ID,
    report: buildReport({ executionId: "exec-low", objective: "Assunto fraco", formatLabel: "Story" }),
    feedbackRecord: buildFeedback({ executionId: "exec-low", overallScore: 3, format: "Story" }),
  });

  assert.equal(record.payload.championContent.length, 1);
  assert.equal(record.payload.championContent[0].executionId, "exec-champion");
  assert.equal(record.payload.lowPerformanceContent.length, 1);
  assert.equal(record.payload.lowPerformanceContent[0].executionId, "exec-low");
  assert.ok(record.payload.workingPatterns.some((pattern) => pattern.includes("Feed")));
  assert.ok(record.payload.nonWorkingPatterns.some((pattern) => pattern.includes("Story")));
  assert.ok(record.payload.futureRecommendations.length > 0);
});

test("syncEditorialLibrary funciona sem Campaign Manager (sem campaignId/campanha conhecida) — fallback seguro usando só sinais do report", async () => {
  const { clara } = createClara();
  const record = await syncEditorialLibrary({
    clara,
    clientId: CLIENT_ID,
    report: buildReport({ executionId: "exec-0001", objective: "Taxa zero" }),
    feedbackRecord: buildFeedback({ executionId: "exec-0001", overallScore: 8, campaignId: undefined }),
    campaign: undefined,
  });

  assert.equal(record.payload.producedContent[0].theme, "Taxa zero");
  assert.equal(record.payload.producedContent[0].campaignId, undefined);
});

test("syncEditorialLibrary enriquece tema e CTA com o Campaign Manager quando a campanha correspondente é conhecida", async () => {
  const { clara } = createClara();
  const report = buildReport({ executionId: "exec-0001", planId: "plan-0001", objective: "Tema genérico do report" });
  const campaign = {
    id: "campaign-0001",
    clientId: CLIENT_ID,
    objective: "Divulgar taxa zero",
    objectiveType: "conversao_especifica",
    durationDays: 14,
    startDate: "2026-07-01",
    endDate: "2026-07-14",
    persona: "casal recém-noivo",
    channels: ["instagram"],
    frequency: { postsPerWeek: 3, label: "3x por semana" },
    calendar: [],
    contents: [
      {
        id: "content-0001",
        order: 1,
        role: "abertura",
        topic: "Taxa zero sobre presentes",
        channel: "instagram",
        recommendedFormat: "imagem_unica",
        priority: "alta",
        cta: "Crie sua lista sem taxa",
        scheduledDate: "2026-07-02",
        relatedContentIds: [],
        status: "published",
        statusHistory: [],
        executionCommand: "criar post sobre taxa zero",
        executionPlanId: "plan-0001",
      },
    ],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };

  const record = await syncEditorialLibrary({
    clara,
    clientId: CLIENT_ID,
    report,
    feedbackRecord: buildFeedback({ executionId: "exec-0001", overallScore: 8 }),
    campaign,
  });

  assert.equal(record.payload.producedContent[0].theme, "Taxa zero sobre presentes");
  assert.equal(record.payload.producedContent[0].cta, "Crie sua lista sem taxa");
  assert.equal(record.payload.producedContent[0].objective, "abertura");
});

// ---------------------------------------------------------------------------------------------
// Coexistência com o Módulo 6 (Aprendizado) e com o Quality Feedback
// ---------------------------------------------------------------------------------------------

test("Biblioteca Editorial nunca substitui LearningContext nem QualityFeedbackRecord: os três coexistem, cada um com seus próprios campos", async () => {
  const { clara } = createClara();
  const qualityFeedback = createQualityFeedback();

  const feedbackRecord = await qualityFeedback.record({
    executionId: "exec-0001",
    clientId: CLIENT_ID,
    contentType: "imagem",
    format: "Feed",
    skillsUsed: ["eduardo-editorial-planning", "maria-copywriting"],
    rating: { kind: "score", value: 9 },
    submittedBy: { id: "cli-user", type: "human" },
  });

  await syncQualityFeedbackToClara({ clara, qualityFeedback, clientId: CLIENT_ID });
  await syncEditorialLibrary({
    clara,
    clientId: CLIENT_ID,
    report: buildReport({ executionId: "exec-0001", objective: "Taxa zero" }),
    feedbackRecord,
  });

  const learning = (await clara.list({ clientId: CLIENT_ID, module: "LearningContext" }))[0];
  const editorialLibrary = (await clara.list({ clientId: CLIENT_ID, module: "EditorialLibraryContext" }))[0];

  assert.ok(learning, "LearningContext deveria continuar existindo, sem ser substituído.");
  assert.ok(editorialLibrary, "EditorialLibraryContext deveria ter sido criado.");
  assert.notEqual(learning.id, editorialLibrary.id);
  assert.ok(Array.isArray(learning.payload.bestRatedContent));
  assert.ok(Array.isArray(editorialLibrary.payload.producedContent));

  const feedbackReport = await qualityFeedback.getReport({ clientId: CLIENT_ID });
  assert.equal(feedbackReport.totalFeedbackCount, 1, "O registro original do Quality Feedback continua intocado.");
});
