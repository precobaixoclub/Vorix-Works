import type { ZunoEventName, ZunoEventRecorderPort } from "../events/zuno-event.contract.js";
import type { QualityFeedbackPort, QualityFeedbackRejectionSignals } from "./quality-feedback.port.js";
import type { QualityFeedbackLoggerPort } from "./quality-feedback-log.contract.js";
import type { QualityFeedbackRepositoryPort } from "./quality-feedback-repository.port.js";
import {
  QUALITY_FEEDBACK_CATEGORIES,
  type QualityFeedbackAverageBucket,
  type QualityFeedbackCategory,
  type QualityFeedbackComplaint,
  type QualityFeedbackFormatPerformance,
  type QualityFeedbackHighlightedContent,
  type QualityFeedbackIdGenerator,
  type QualityFeedbackInsights,
  type QualityFeedbackQuery,
  type QualityFeedbackRatingInput,
  type QualityFeedbackRecord,
  type QualityFeedbackReport,
  type QualityFeedbackSubmissionInput,
  type QualityFeedbackTimelinePoint,
} from "./quality-feedback.types.js";

export const QUALITY_FEEDBACK_LOW_SCORE_THRESHOLD = 6;
const DEFAULT_INSIGHTS_LIMIT = 10;
const DEFAULT_HIGHLIGHT_COUNT = 5;
const DEFAULT_COMPLAINTS_COUNT = 5;

export type QualityFeedbackCenterDependencies = {
  repository: QualityFeedbackRepositoryPort;
  logger?: QualityFeedbackLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: QualityFeedbackIdGenerator;
  now?: () => Date;
};

class SequentialQualityFeedbackIdGenerator implements QualityFeedbackIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopQualityFeedbackLogger implements QualityFeedbackLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopEventRecorder implements ZunoEventRecorderPort {
  async record(): Promise<void> {
    return undefined;
  }
}

export class QualityFeedbackCenter implements QualityFeedbackPort {
  private readonly repository: QualityFeedbackRepositoryPort;
  private readonly logger: QualityFeedbackLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: QualityFeedbackIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: QualityFeedbackCenterDependencies) {
    this.repository = dependencies.repository;
    this.logger = dependencies.logger ?? new NoopQualityFeedbackLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialQualityFeedbackIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async record(input: QualityFeedbackSubmissionInput): Promise<QualityFeedbackRecord> {
    const errors = validateSubmission(input);
    if (errors.length > 0) {
      await this.log("FeedbackValidationFailed", "Avaliação inválida recebida pelo Quality Feedback.", input.executionId, input.clientId, { errors });
      throw new Error(errors.join("; "));
    }

    const record: QualityFeedbackRecord = {
      id: this.idGenerator.create("quality-feedback"),
      executionId: input.executionId,
      clientId: input.clientId,
      contentType: input.contentType,
      format: input.format,
      skillsUsed: [...input.skillsUsed],
      campaignId: input.campaignId,
      overallScore: normalizeRating(input.rating),
      ratingInput: input.rating,
      categoryScores: input.categoryScores ? [...input.categoryScores] : [],
      categoriesNeedingImprovement: input.categoriesNeedingImprovement ? [...new Set(input.categoriesNeedingImprovement)] : [],
      comment: input.comment?.trim() || undefined,
      submittedBy: input.submittedBy,
      submittedAt: this.timestamp(),
    };

    await this.repository.save(record);
    await this.log("FeedbackRecorded", `Avaliação registrada para a execução ${record.executionId}.`, record.executionId, record.clientId, {
      overallScore: record.overallScore,
      format: record.format,
    });
    await this.emit("QualityFeedbackRecorded", record, { overallScore: record.overallScore, format: record.format });
    return clone(record);
  }

  async list(query: QualityFeedbackQuery = {}): Promise<QualityFeedbackRecord[]> {
    const records = await this.repository.list();
    await this.log("FeedbackListed", "Histórico de avaliações consultado.", query.executionId, query.clientId, { query });
    return applyQuery(records, query);
  }

  async getReport(query: QualityFeedbackQuery = {}): Promise<QualityFeedbackReport> {
    const records = await this.list(query);
    const report: QualityFeedbackReport = {
      generatedAt: this.timestamp(),
      totalFeedbackCount: records.length,
      overallAverageScore: average(records.map((record) => record.overallScore)),
      averageByFormat: bucketAverage(records, (record) => record.format),
      averageBySkill: bucketAverageMulti(records, (record) => record.skillsUsed),
      averageByCampaign: bucketAverage(
        records.filter((record) => Boolean(record.campaignId)),
        (record) => record.campaignId as string,
      ),
      qualityOverTime: buildTimeline(records),
      bestRatedContent: highlightContent(records, "best"),
      worstRatedContent: highlightContent(records, "worst"),
      topRecurringComplaints: buildComplaints(records),
    };

    await this.log("ReportGenerated", "Relatório de qualidade gerado.", undefined, query.clientId, { totalFeedbackCount: report.totalFeedbackCount });
    await this.emit("QualityFeedbackReportGenerated", undefined, { totalFeedbackCount: report.totalFeedbackCount, clientId: query.clientId });
    return report;
  }

  async getInsightsForClient(clientId: string, limit = DEFAULT_INSIGHTS_LIMIT): Promise<QualityFeedbackInsights> {
    if (!clientId?.trim()) throw new Error("clientId é obrigatório para consultar insights de qualidade.");

    await this.log("InsightsRequested", `Eduardo solicitou insights de qualidade para ${clientId}.`, undefined, clientId, { limit });

    const allRecords = await this.repository.list();
    const recent = allRecords
      .filter((record) => record.clientId === clientId)
      .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
      .slice(0, Math.max(1, limit));

    const insights: QualityFeedbackInsights = {
      clientId,
      sampleSize: recent.length,
      overallAverageScore: average(recent.map((record) => record.overallScore)),
      lowScoringCategories: buildLowScoringCategories(recent),
      recurringComplaints: buildComplaints(recent)
        .filter((complaint) => complaint.count > 1)
        .map((complaint) => complaint.category),
      formatPerformance: buildFormatPerformance(recent),
    };

    await this.log("InsightsDelivered", `Insights de qualidade entregues para ${clientId}.`, undefined, clientId, {
      sampleSize: insights.sampleSize,
      lowScoringCategories: insights.lowScoringCategories,
    });
    await this.emit("QualityFeedbackInsightsDelivered", undefined, {
      clientId,
      sampleSize: insights.sampleSize,
      lowScoringCategories: insights.lowScoringCategories,
    });
    return clone(insights);
  }

  /**
   * Sinais de rejeição recentes de um workspace (motivos marcados em `categoriesNeedingImprovement`,
   * ex.: pelo endpoint de rejeição estruturada da tela de Revisão), consumidos pelo pipeline real
   * de Produção para compor `structure.editorialMemory.recentRejectionReasons` — texto aditivo
   * injetado no prompt de João/Maria/Sofia (`avoidRepeating`), nunca uma decisão automática.
   */
  async getRecentRejectionSignalsForWorkspace(clientId: string, limit = DEFAULT_INSIGHTS_LIMIT): Promise<QualityFeedbackRejectionSignals> {
    if (!clientId?.trim()) throw new Error("clientId é obrigatório para consultar sinais de rejeição.");

    const allRecords = await this.repository.list();
    const recent = allRecords
      .filter((record) => record.clientId === clientId && record.categoriesNeedingImprovement.length > 0)
      .sort((left, right) => Date.parse(right.submittedAt) - Date.parse(left.submittedAt))
      .slice(0, Math.max(1, limit));

    const recurringReasons = buildComplaints(recent).map((complaint) => complaint.category);
    const comments = recent.map((record) => record.comment).filter((comment): comment is string => Boolean(comment));

    return { recurringReasons, comments };
  }

  private async log(
    action: Parameters<QualityFeedbackLoggerPort["record"]>[0]["action"],
    message: string,
    executionId: string | undefined,
    clientId: string | undefined,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("quality-feedback-log"),
      occurredAt: this.timestamp(),
      action,
      message,
      executionId,
      clientId,
      metadata,
    });
  }

  private async emit(name: ZunoEventName, record?: QualityFeedbackRecord, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: record?.executionId,
      payload: {
        source: "quality-feedback",
        clientId: record?.clientId,
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateSubmission(input: QualityFeedbackSubmissionInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Avaliação é obrigatória."];
  if (!input.executionId?.trim()) errors.push("executionId é obrigatório.");
  if (!input.clientId?.trim()) errors.push("clientId é obrigatório.");
  if (!input.contentType?.trim()) errors.push("contentType é obrigatório.");
  if (!input.format?.trim()) errors.push("format é obrigatório.");
  if (!Array.isArray(input.skillsUsed) || input.skillsUsed.length === 0) errors.push("skillsUsed é obrigatório e deve conter ao menos uma Skill.");
  errors.push(...validateRating(input.rating));

  for (const categoryScore of input.categoryScores ?? []) {
    if (!isValidCategory(categoryScore.category)) errors.push(`categoryScores possui categoria inválida: ${String(categoryScore.category)}.`);
    if (!Number.isFinite(categoryScore.score) || categoryScore.score < 1 || categoryScore.score > 10) {
      errors.push(`categoryScores.${categoryScore.category} deve ser um número entre 1 e 10.`);
    }
  }

  for (const category of input.categoriesNeedingImprovement ?? []) {
    if (!isValidCategory(category)) errors.push(`categoriesNeedingImprovement possui categoria inválida: ${String(category)}.`);
  }

  return errors;
}

function validateRating(rating: QualityFeedbackRatingInput): string[] {
  if (!rating || (rating.kind !== "stars" && rating.kind !== "score")) {
    return ["rating é obrigatório e deve ser do tipo stars ou score."];
  }
  if (!Number.isFinite(rating.value)) return ["rating.value deve ser um número."];
  if (rating.kind === "stars" && (rating.value < 1 || rating.value > 5)) {
    return ["rating.value para stars deve estar entre 1 e 5."];
  }
  if (rating.kind === "score" && (rating.value < 1 || rating.value > 10)) {
    return ["rating.value para score deve estar entre 1 e 10."];
  }
  return [];
}

function isValidCategory(category: unknown): category is QualityFeedbackCategory {
  return typeof category === "string" && (QUALITY_FEEDBACK_CATEGORIES as readonly string[]).includes(category);
}

/** Estrelas (1-5) viram nota de 1 a 10 (`stars * 2`); nota (1-10) permanece como está. */
function normalizeRating(rating: QualityFeedbackRatingInput): number {
  const raw = rating.kind === "stars" ? rating.value * 2 : rating.value;
  return Math.min(10, Math.max(1, raw));
}

function applyQuery(records: QualityFeedbackRecord[], query: QualityFeedbackQuery): QualityFeedbackRecord[] {
  const filtered = records.filter((record) => {
    if (query.clientId && record.clientId !== query.clientId) return false;
    if (query.executionId && record.executionId !== query.executionId) return false;
    if (query.format && record.format !== query.format) return false;
    if (query.skillId && !record.skillsUsed.includes(query.skillId)) return false;
    if (query.campaignId && record.campaignId !== query.campaignId) return false;
    if (query.since && Date.parse(record.submittedAt) < Date.parse(query.since)) return false;
    return true;
  });
  return typeof query.limit === "number" ? filtered.slice(0, query.limit) : filtered;
}

function average(scores: number[]): number | undefined {
  if (scores.length === 0) return undefined;
  const total = scores.reduce((sum, score) => sum + score, 0);
  return roundToOneDecimal(total / scores.length);
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function bucketAverage(records: QualityFeedbackRecord[], keyFn: (record: QualityFeedbackRecord) => string): QualityFeedbackAverageBucket[] {
  const buckets = new Map<string, number[]>();
  for (const record of records) {
    const key = keyFn(record);
    const scores = buckets.get(key) ?? [];
    scores.push(record.overallScore);
    buckets.set(key, scores);
  }
  return sortBuckets(
    Array.from(buckets.entries()).map(([key, scores]) => ({ key, averageScore: average(scores) ?? 0, count: scores.length })),
  );
}

function bucketAverageMulti(records: QualityFeedbackRecord[], keysFn: (record: QualityFeedbackRecord) => string[]): QualityFeedbackAverageBucket[] {
  const buckets = new Map<string, number[]>();
  for (const record of records) {
    for (const key of keysFn(record)) {
      const scores = buckets.get(key) ?? [];
      scores.push(record.overallScore);
      buckets.set(key, scores);
    }
  }
  return sortBuckets(
    Array.from(buckets.entries()).map(([key, scores]) => ({ key, averageScore: average(scores) ?? 0, count: scores.length })),
  );
}

function sortBuckets(buckets: QualityFeedbackAverageBucket[]): QualityFeedbackAverageBucket[] {
  return buckets.sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function buildTimeline(records: QualityFeedbackRecord[]): QualityFeedbackTimelinePoint[] {
  const buckets = new Map<string, number[]>();
  for (const record of records) {
    const period = record.submittedAt.slice(0, 7); // YYYY-MM
    const scores = buckets.get(period) ?? [];
    scores.push(record.overallScore);
    buckets.set(period, scores);
  }
  return Array.from(buckets.entries())
    .map(([period, scores]) => ({ period, averageScore: average(scores) ?? 0, count: scores.length }))
    .sort((left, right) => left.period.localeCompare(right.period));
}

function highlightContent(records: QualityFeedbackRecord[], direction: "best" | "worst"): QualityFeedbackHighlightedContent[] {
  const sorted = [...records].sort((left, right) => {
    const diff = direction === "best" ? right.overallScore - left.overallScore : left.overallScore - right.overallScore;
    if (diff !== 0) return diff;
    return Date.parse(right.submittedAt) - Date.parse(left.submittedAt);
  });
  return sorted.slice(0, DEFAULT_HIGHLIGHT_COUNT).map((record) => ({
    executionId: record.executionId,
    clientId: record.clientId,
    format: record.format,
    overallScore: record.overallScore,
    submittedAt: record.submittedAt,
    comment: record.comment,
  }));
}

function buildComplaints(records: QualityFeedbackRecord[]): QualityFeedbackComplaint[] {
  const counts = new Map<QualityFeedbackCategory, number>();
  for (const record of records) {
    for (const category of record.categoriesNeedingImprovement) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  const total = records.length || 1;
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count, ratio: roundToOneDecimal(count / total) }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category))
    .slice(0, DEFAULT_COMPLAINTS_COUNT);
}

function buildLowScoringCategories(records: QualityFeedbackRecord[]): QualityFeedbackCategory[] {
  const buckets = new Map<QualityFeedbackCategory, number[]>();
  for (const record of records) {
    for (const categoryScore of record.categoryScores) {
      const scores = buckets.get(categoryScore.category) ?? [];
      scores.push(categoryScore.score);
      buckets.set(categoryScore.category, scores);
    }
  }
  return Array.from(buckets.entries())
    .map(([category, scores]) => ({ category, averageScore: average(scores) ?? 0 }))
    .filter((entry) => entry.averageScore < QUALITY_FEEDBACK_LOW_SCORE_THRESHOLD)
    .sort((left, right) => left.averageScore - right.averageScore)
    .map((entry) => entry.category);
}

function buildFormatPerformance(records: QualityFeedbackRecord[]): QualityFeedbackFormatPerformance[] {
  const buckets = new Map<string, number[]>();
  for (const record of records) {
    const scores = buckets.get(record.format) ?? [];
    scores.push(record.overallScore);
    buckets.set(record.format, scores);
  }
  return Array.from(buckets.entries())
    .map(([format, scores]) => ({ format, averageScore: average(scores) ?? 0, count: scores.length }))
    .sort((left, right) => right.averageScore - left.averageScore);
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}

export function createQualityFeedbackCenter(dependencies: QualityFeedbackCenterDependencies): QualityFeedbackCenter {
  return new QualityFeedbackCenter(dependencies);
}
