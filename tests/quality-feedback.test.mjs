import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QualityFeedbackCenter,
  QUALITY_FEEDBACK_LOW_SCORE_THRESHOLD,
} from "../dist/application/quality-feedback/index.js";
import {
  InMemoryQualityFeedbackRepository,
  LocalJsonQualityFeedbackRepository,
} from "../dist/infrastructure/storage/index.js";

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

class InMemoryQualityFeedbackLogger {
  constructor() {
    this.entries = [];
  }

  async record(entry) {
    this.entries.push(entry);
  }

  list() {
    return [...this.entries];
  }
}

function createCenter(overrides = {}) {
  return new QualityFeedbackCenter({
    repository: overrides.repository ?? new InMemoryQualityFeedbackRepository(),
    logger: overrides.logger,
    eventRecorder: overrides.eventRecorder,
    idGenerator: overrides.idGenerator ?? createDeterministicIdGenerator(),
    now: overrides.now ?? (() => new Date("2026-07-10T12:00:00.000Z")),
  });
}

function baseSubmission(overrides = {}) {
  return {
    executionId: "workflow-execution-0001",
    clientId: CLIENT_ID,
    contentType: "imagem",
    format: "carrossel",
    skillsUsed: ["eduardo-editorial-planning", "joao-marketing-strategy", "pedro-image-generation"],
    rating: { kind: "score", value: 8 },
    ...overrides,
  };
}

// --- Gravação do feedback ---------------------------------------------------------------------

test("Quality Feedback grava avaliação com nota (1-10), categorias e comentário, preenchendo data e id", async () => {
  const center = createCenter();

  const record = await center.record(baseSubmission({
    categoryScores: [{ category: "cta", score: 5 }],
    categoriesNeedingImprovement: ["cta", "hashtags"],
    comment: "Legenda ficou boa, mas o CTA podia ser mais direto.",
  }));

  assert.equal(record.id, "quality-feedback-0001");
  assert.equal(record.executionId, "workflow-execution-0001");
  assert.equal(record.clientId, CLIENT_ID);
  assert.equal(record.contentType, "imagem");
  assert.equal(record.format, "carrossel");
  assert.deepEqual(record.skillsUsed, ["eduardo-editorial-planning", "joao-marketing-strategy", "pedro-image-generation"]);
  assert.equal(record.overallScore, 8);
  assert.deepEqual(record.categoryScores, [{ category: "cta", score: 5 }]);
  assert.deepEqual(record.categoriesNeedingImprovement, ["cta", "hashtags"]);
  assert.equal(record.comment, "Legenda ficou boa, mas o CTA podia ser mais direto.");
  assert.equal(record.submittedAt, "2026-07-10T12:00:00.000Z");
});

test("Quality Feedback normaliza estrelas (1-5) para nota de 1 a 10 (stars * 2)", async () => {
  const center = createCenter();

  const record = await center.record(baseSubmission({ rating: { kind: "stars", value: 5 } }));
  assert.equal(record.overallScore, 10);
  assert.deepEqual(record.ratingInput, { kind: "stars", value: 5 });

  const record2 = await center.record(baseSubmission({ executionId: "workflow-execution-0002", rating: { kind: "stars", value: 3 } }));
  assert.equal(record2.overallScore, 6);
});

test("Quality Feedback deduplica categoriesNeedingImprovement repetidas", async () => {
  const center = createCenter();

  const record = await center.record(baseSubmission({ categoriesNeedingImprovement: ["cta", "cta", "hashtags"] }));
  assert.deepEqual(record.categoriesNeedingImprovement.sort(), ["cta", "hashtags"]);
});

// --- Regressão / validação ---------------------------------------------------------------------

test("Quality Feedback rejeita avaliação sem campos obrigatórios", async () => {
  const center = createCenter();

  await assert.rejects(() => center.record(baseSubmission({ executionId: "" })), /executionId/);
  await assert.rejects(() => center.record(baseSubmission({ clientId: "" })), /clientId/);
  await assert.rejects(() => center.record(baseSubmission({ skillsUsed: [] })), /skillsUsed/);
});

test("Quality Feedback rejeita nota fora do intervalo permitido para cada tipo de rating", async () => {
  const center = createCenter();

  await assert.rejects(() => center.record(baseSubmission({ rating: { kind: "stars", value: 6 } })), /stars/);
  await assert.rejects(() => center.record(baseSubmission({ rating: { kind: "score", value: 11 } })), /score/);
  await assert.rejects(() => center.record(baseSubmission({ rating: { kind: "score", value: 0 } })), /score/);
});

test("Quality Feedback rejeita categoria inválida em categoryScores e em categoriesNeedingImprovement", async () => {
  const center = createCenter();

  await assert.rejects(
    () => center.record(baseSubmission({ categoryScores: [{ category: "inexistente", score: 5 }] })),
    /categoria inválida/,
  );
  await assert.rejects(
    () => center.record(baseSubmission({ categoriesNeedingImprovement: ["inexistente"] })),
    /categoria inválida/,
  );
});

test("Quality Feedback nunca falha ao listar ou gerar relatório sem nenhum registro (estado vazio seguro)", async () => {
  const center = createCenter();

  const list = await center.list({ clientId: CLIENT_ID });
  assert.deepEqual(list, []);

  const report = await center.getReport({ clientId: CLIENT_ID });
  assert.equal(report.totalFeedbackCount, 0);
  assert.equal(report.overallAverageScore, undefined);
  assert.deepEqual(report.averageByFormat, []);
  assert.deepEqual(report.bestRatedContent, []);
  assert.deepEqual(report.topRecurringComplaints, []);

  const insights = await center.getInsightsForClient(CLIENT_ID);
  assert.equal(insights.sampleSize, 0);
  assert.deepEqual(insights.lowScoringCategories, []);
  assert.deepEqual(insights.formatPerformance, []);
});

// --- Leitura do histórico ------------------------------------------------------------------------

test("Quality Feedback lista o histórico filtrando por clientId, format, skillId, campaignId e since", async () => {
  const center = createCenter();
  await center.record(baseSubmission({ executionId: "exec-1", format: "carrossel", campaignId: "campanha-a" }));
  await center.record(baseSubmission({ executionId: "exec-2", format: "reels", skillsUsed: ["rafa-video-rendering"], campaignId: "campanha-b" }));
  await center.record(baseSubmission({ executionId: "exec-3", clientId: "outro-cliente" }));

  const byClient = await center.list({ clientId: CLIENT_ID });
  assert.equal(byClient.length, 2);

  const byFormat = await center.list({ clientId: CLIENT_ID, format: "reels" });
  assert.deepEqual(byFormat.map((record) => record.executionId), ["exec-2"]);

  const bySkill = await center.list({ skillId: "rafa-video-rendering" });
  assert.deepEqual(bySkill.map((record) => record.executionId), ["exec-2"]);

  const byCampaign = await center.list({ campaignId: "campanha-a" });
  assert.deepEqual(byCampaign.map((record) => record.executionId), ["exec-1"]);

  const limited = await center.list({ clientId: CLIENT_ID, limit: 1 });
  assert.equal(limited.length, 1);
});

test("Quality Feedback persiste em armazenamento local JSON e recarrega em uma nova instância", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "zuno-quality-feedback-"));
  try {
    const filePath = join(rootDir, "quality-feedback.json");
    const firstCenter = createCenter({ repository: new LocalJsonQualityFeedbackRepository(filePath) });
    await firstCenter.record(baseSubmission({ executionId: "exec-persisted" }));

    const secondCenter = createCenter({ repository: new LocalJsonQualityFeedbackRepository(filePath) });
    const records = await secondCenter.list({ clientId: CLIENT_ID });
    assert.equal(records.length, 1);
    assert.equal(records[0].executionId, "exec-persisted");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// --- Estatísticas / relatório --------------------------------------------------------------------

test("Quality Feedback calcula média geral, por formato, por Skill e por campanha", async () => {
  const center = createCenter();
  await center.record(baseSubmission({ executionId: "exec-1", format: "carrossel", campaignId: "campanha-a", rating: { kind: "score", value: 8 }, skillsUsed: ["joao-marketing-strategy", "pedro-image-generation"] }));
  await center.record(baseSubmission({ executionId: "exec-2", format: "carrossel", campaignId: "campanha-a", rating: { kind: "score", value: 6 }, skillsUsed: ["joao-marketing-strategy", "pedro-image-generation"] }));
  await center.record(baseSubmission({ executionId: "exec-3", format: "reels", campaignId: "campanha-b", rating: { kind: "score", value: 9 }, skillsUsed: ["rafa-video-rendering"] }));

  const report = await center.getReport({ clientId: CLIENT_ID });
  assert.equal(report.totalFeedbackCount, 3);
  assert.equal(report.overallAverageScore, roundToOneDecimal((8 + 6 + 9) / 3));

  const carrosselBucket = report.averageByFormat.find((bucket) => bucket.key === "carrossel");
  assert.equal(carrosselBucket.averageScore, 7);
  assert.equal(carrosselBucket.count, 2);

  const joaoBucket = report.averageBySkill.find((bucket) => bucket.key === "joao-marketing-strategy");
  assert.equal(joaoBucket.averageScore, 7);
  assert.equal(joaoBucket.count, 2);

  const campanhaABucket = report.averageByCampaign.find((bucket) => bucket.key === "campanha-a");
  assert.equal(campanhaABucket.averageScore, 7);
});

test("Quality Feedback identifica conteúdos mais e menos bem avaliados", async () => {
  const center = createCenter();
  await center.record(baseSubmission({ executionId: "exec-pior", rating: { kind: "score", value: 3 } }));
  await center.record(baseSubmission({ executionId: "exec-melhor", rating: { kind: "score", value: 10 } }));
  await center.record(baseSubmission({ executionId: "exec-meio", rating: { kind: "score", value: 6 } }));

  const report = await center.getReport({ clientId: CLIENT_ID });
  assert.equal(report.bestRatedContent[0].executionId, "exec-melhor");
  assert.equal(report.worstRatedContent[0].executionId, "exec-pior");
});

test("Quality Feedback calcula evolução da qualidade ao longo do tempo (por mês) e reclamações recorrentes", async () => {
  const repository = new InMemoryQualityFeedbackRepository();
  const idGenerator = createDeterministicIdGenerator();
  const mayCenter = createCenter({ repository, idGenerator, now: () => new Date("2026-05-15T00:00:00.000Z") });
  const juneCenter = createCenter({ repository, idGenerator, now: () => new Date("2026-06-15T00:00:00.000Z") });

  await mayCenter.record(baseSubmission({ executionId: "exec-maio-1", rating: { kind: "score", value: 5 }, categoriesNeedingImprovement: ["cta"] }));
  await mayCenter.record(baseSubmission({ executionId: "exec-maio-2", rating: { kind: "score", value: 7 }, categoriesNeedingImprovement: ["cta"] }));
  await juneCenter.record(baseSubmission({ executionId: "exec-junho-1", rating: { kind: "score", value: 9 } }));

  const report = await mayCenter.getReport({ clientId: CLIENT_ID });
  assert.deepEqual(report.qualityOverTime.map((point) => point.period), ["2026-05", "2026-06"]);
  assert.equal(report.qualityOverTime[0].averageScore, 6);
  assert.equal(report.qualityOverTime[1].averageScore, 9);

  assert.equal(report.topRecurringComplaints[0].category, "cta");
  assert.equal(report.topRecurringComplaints[0].count, 2);
});

// --- Consulta pelo Eduardo (getInsightsForClient) -------------------------------------------------

test("Quality Feedback entrega categorias com nota baixa (abaixo do limiar) para o Eduardo consultar", async () => {
  const center = createCenter();
  await center.record(baseSubmission({ executionId: "exec-1", categoryScores: [{ category: "cta", score: 4 }, { category: "hashtags", score: 8 }] }));
  await center.record(baseSubmission({ executionId: "exec-2", categoryScores: [{ category: "cta", score: 5 }, { category: "hashtags", score: 9 }] }));

  const insights = await center.getInsightsForClient(CLIENT_ID);
  assert.equal(insights.sampleSize, 2);
  assert.ok(insights.lowScoringCategories.includes("cta"));
  assert.equal(insights.lowScoringCategories.includes("hashtags"), false);
  assert.ok((4 + 5) / 2 < QUALITY_FEEDBACK_LOW_SCORE_THRESHOLD);
});

test("Quality Feedback entrega reclamações recorrentes (marcadas mais de uma vez) para o Eduardo", async () => {
  const center = createCenter();
  await center.record(baseSubmission({ executionId: "exec-1", categoriesNeedingImprovement: ["hashtags"] }));
  await center.record(baseSubmission({ executionId: "exec-2", categoriesNeedingImprovement: ["hashtags"] }));
  await center.record(baseSubmission({ executionId: "exec-3", categoriesNeedingImprovement: ["layout"] }));

  const insights = await center.getInsightsForClient(CLIENT_ID);
  assert.ok(insights.recurringComplaints.includes("hashtags"));
  assert.equal(insights.recurringComplaints.includes("layout"), false);
});

test("Quality Feedback compara desempenho por formato (ex.: vídeo vs. carrossel) para o Eduardo consultar", async () => {
  const center = createCenter();
  await center.record(baseSubmission({ executionId: "exec-1", format: "carrossel", rating: { kind: "score", value: 6 } }));
  await center.record(baseSubmission({ executionId: "exec-2", format: "reels", rating: { kind: "score", value: 9 }, contentType: "video", skillsUsed: ["rafa-video-rendering"] }));

  const insights = await center.getInsightsForClient(CLIENT_ID);
  assert.equal(insights.formatPerformance[0].format, "reels");
  assert.equal(insights.formatPerformance[0].averageScore, 9);
  assert.equal(insights.formatPerformance[1].format, "carrossel");
});

test("Quality Feedback restringe insights aos últimos N registros do cliente (limit)", async () => {
  const center = createCenter();
  for (let index = 1; index <= 12; index += 1) {
    await center.record(baseSubmission({ executionId: `exec-${index}`, rating: { kind: "score", value: index <= 10 ? 9 : 3 } }));
  }

  const insights = await center.getInsightsForClient(CLIENT_ID, 10);
  assert.equal(insights.sampleSize, 10);
});

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}
