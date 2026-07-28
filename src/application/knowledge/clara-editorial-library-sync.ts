import type { ClaraKnowledgePort } from "./clara-knowledge.port.js";
import type {
  ClaraKnowledgeRecord,
  EditorialLibraryContentEntry,
  EditorialLibraryContext,
  EditorialLibraryForbiddenSubject,
  EditorialLibraryHighlightedContent,
  EditorialLibraryLowPerformanceContent,
} from "./clara.types.js";
import type { WorkflowExecutionReport, WorkflowStepExecutionReport } from "../workflows/caio.types.js";
import { QUALITY_FEEDBACK_LOW_SCORE_THRESHOLD, type QualityFeedbackRecord } from "../quality-feedback/index.js";
import type { CampaignPlan } from "../campaign/index.js";

/**
 * Integração automática do Módulo 9 (Biblioteca Editorial) da Clara com Campaign Manager e Quality
 * Feedback. Mesma natureza arquitetural de `clara-learning-sync.ts` (lógica de aplicação, não uma
 * Skill, não uma nova camada) — acionada pelo mesmo chamador (`recordQualityFeedback` na CLI), logo
 * após o registro do feedback e a sincronização do Módulo 6 (Aprendizado), que continua intacta e
 * independente.
 *
 * A Biblioteca Editorial NUNCA substitui o Quality Feedback: ela não recalcula notas nem agrega
 * médias por conta própria (isso já é `QualityFeedbackReport`/`LearningContext`). Ela **interpreta**
 * o histórico acumulado de conteúdos + a avaliação recém-registrada e produz conhecimento editorial
 * derivado (o que já foi feito, o que funcionou, o que evitar repetir) — voltado a apoiar decisões
 * futuras de Eduardo (tema/formato), João (ângulo/CTA) e Maria (ganchos/storytelling/copy).
 *
 * Diferença deliberada em relação a `syncQualityFeedbackToClara`: aquela sincronização SUBSTITUI o
 * `LearningContext` inteiro a cada chamada (é sempre um retrato agregado e atual do Quality
 * Feedback). Esta sincronização é CUMULATIVA — cada chamada acrescenta uma entrada de conteúdo
 * produzido ao histórico já existente (`producedContent`), porque detectar repetição de tema exige
 * memória de tudo que já foi produzido, não só do relatório mais recente.
 */

const CHAMPION_SCORE_THRESHOLD = 8;
const REPEATED_SUBJECT_MIN_OCCURRENCES = 3;
const FORBIDDEN_SUBJECT_MIN_OCCURRENCES = 2;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;

export type EditorialSignals = {
  theme: string;
  format?: string;
  objective?: string;
  cta?: string;
  emojis: string[];
  hook?: string;
  storytellingFramework?: string;
};

function findStep(report: WorkflowExecutionReport, capability: string): WorkflowStepExecutionReport | undefined {
  return report.steps.find((step) => step.skillCapability === capability);
}

function readStringField(output: unknown, key: string): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const value = (output as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function extractEmojis(text: string | undefined): string[] {
  if (!text) return [];
  const matches = text.match(EMOJI_PATTERN);
  return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Lê os sinais editoriais direto dos passos já executados no `WorkflowExecutionReport` — mesma
 * técnica de acesso por nome de campo (duck typing) já usada por Caio em `caio.executor.ts`
 * (`extractArtifactSummary`), para não importar tipos de nenhuma Skill aqui (preserva ADR 0002).
 */
export function extractEditorialSignals(report: WorkflowExecutionReport): EditorialSignals {
  const editorialStep = findStep(report, "editorial_planning");
  const copyStep = findStep(report, "copywriting");
  const videoScriptStep = findStep(report, "video_script");

  const theme =
    readStringField(editorialStep?.response?.output, "campaignObjective") ??
    report.planSnapshot.intent.objective ??
    "desconhecido";
  const format = readStringField(editorialStep?.response?.output, "recommendedFormatLabel");
  const cta = readStringField(copyStep?.response?.output, "cta");
  const emojis = extractEmojis(readStringField(copyStep?.response?.output, "caption"));
  const hook = readStringField(videoScriptStep?.response?.output, "hook");
  const storytellingFramework = readStringField(videoScriptStep?.response?.output, "narrativeStructure");

  return { theme, format, objective: theme, cta, emojis, hook, storytellingFramework };
}

/**
 * Quando a campanha correspondente já é conhecida (`campaign.contents` tem um item cujo
 * `executionPlanId` bate com `report.planId`), o Campaign Manager é a fonte mais autoritativa para
 * tema (`topic`) e CTA planejado — sobrepõe (não descarta) os sinais já extraídos do report.
 */
function enrichWithCampaign(signals: EditorialSignals, report: WorkflowExecutionReport, campaign?: CampaignPlan): EditorialSignals {
  if (!campaign) return signals;
  const content = campaign.contents.find((item) => item.executionPlanId === report.planId);
  if (!content) return signals;
  return {
    ...signals,
    theme: content.topic,
    objective: content.role,
    cta: content.cta ?? signals.cta,
  };
}

function buildContentEntry(
  report: WorkflowExecutionReport,
  feedbackRecord: QualityFeedbackRecord,
  signals: EditorialSignals,
): EditorialLibraryContentEntry {
  return {
    executionId: report.executionId,
    campaignId: feedbackRecord.campaignId,
    theme: signals.theme,
    format: signals.format ?? feedbackRecord.format,
    objective: signals.objective,
    cta: signals.cta,
    emojis: signals.emojis.length > 0 ? signals.emojis : undefined,
    hook: signals.hook,
    storytellingFramework: signals.storytellingFramework,
    score: feedbackRecord.overallScore,
    producedAt: feedbackRecord.submittedAt,
  };
}

function mergeContentEntries(existing: EditorialLibraryContentEntry[], entry: EditorialLibraryContentEntry): EditorialLibraryContentEntry[] {
  const withoutDuplicate = existing.filter((item) => item.executionId !== entry.executionId);
  return [...withoutDuplicate, entry];
}

function recomputeChampionsAndLowPerformers(entries: EditorialLibraryContentEntry[]): {
  champions: EditorialLibraryHighlightedContent[];
  lowPerformers: EditorialLibraryLowPerformanceContent[];
} {
  const champions: EditorialLibraryHighlightedContent[] = [];
  const lowPerformers: EditorialLibraryLowPerformanceContent[] = [];
  for (const entry of entries) {
    if (entry.score === undefined) continue;
    const highlighted: EditorialLibraryHighlightedContent = {
      executionId: entry.executionId,
      theme: entry.theme,
      format: entry.format,
      score: entry.score,
    };
    if (entry.score >= CHAMPION_SCORE_THRESHOLD) {
      champions.push(highlighted);
    } else if (entry.score < QUALITY_FEEDBACK_LOW_SCORE_THRESHOLD) {
      lowPerformers.push({ ...highlighted, reasons: undefined });
    }
  }
  return { champions, lowPerformers };
}

function computeRepeatedSubjects(entries: EditorialLibraryContentEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.theme, (counts.get(entry.theme) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= REPEATED_SUBJECT_MIN_OCCURRENCES)
    .map(([theme]) => theme);
}

function computeTemporarilyForbiddenSubjects(entries: EditorialLibraryContentEntry[]): EditorialLibraryForbiddenSubject[] {
  const scoresByTheme = new Map<string, number[]>();
  for (const entry of entries) {
    if (entry.score === undefined) continue;
    const list = scoresByTheme.get(entry.theme) ?? [];
    list.push(entry.score);
    scoresByTheme.set(entry.theme, list);
  }

  const forbidden: EditorialLibraryForbiddenSubject[] = [];
  for (const [theme, scores] of scoresByTheme) {
    if (scores.length < FORBIDDEN_SUBJECT_MIN_OCCURRENCES) continue;
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    if (average < QUALITY_FEEDBACK_LOW_SCORE_THRESHOLD) {
      forbidden.push({
        subject: theme,
        reason: `Média de ${average.toFixed(1)} em ${scores.length} avaliações — evitar reutilizar este tema até revisar a abordagem.`,
      });
    }
  }
  return forbidden;
}

function derivePatterns(
  champions: EditorialLibraryHighlightedContent[],
  lowPerformers: EditorialLibraryLowPerformanceContent[],
): { workingPatterns: string[]; nonWorkingPatterns: string[] } {
  const workingPatterns: string[] = [];
  const nonWorkingPatterns: string[] = [];

  const championFormat = dominantFormat(champions);
  if (championFormat) {
    workingPatterns.push(`Formato "${championFormat}" concentra os conteúdos mais bem avaliados (nota >= ${CHAMPION_SCORE_THRESHOLD}).`);
  }

  const lowFormat = dominantFormat(lowPerformers);
  if (lowFormat) {
    nonWorkingPatterns.push(`Formato "${lowFormat}" concentra os conteúdos com pior avaliação (nota < ${QUALITY_FEEDBACK_LOW_SCORE_THRESHOLD}).`);
  }

  return { workingPatterns, nonWorkingPatterns };
}

function dominantFormat(entries: EditorialLibraryHighlightedContent[]): string | undefined {
  if (entries.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.format) continue;
    counts.set(entry.format, (counts.get(entry.format) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  return sorted[0]?.[0];
}

function deriveFutureRecommendations(
  repeatedSubjects: string[],
  temporarilyForbiddenSubjects: EditorialLibraryForbiddenSubject[],
  workingPatterns: string[],
): string[] {
  const recommendations: string[] = [];
  for (const subject of repeatedSubjects) {
    recommendations.push(`Tema "${subject}" já foi usado ${REPEATED_SUBJECT_MIN_OCCURRENCES}+ vezes — buscar um ângulo novo antes de reutilizá-lo.`);
  }
  for (const forbidden of temporarilyForbiddenSubjects) {
    recommendations.push(`Evitar o tema "${forbidden.subject}" nas próximas campanhas: ${forbidden.reason}`);
  }
  recommendations.push(...workingPatterns.map((pattern) => `Repetir o que funcionou: ${pattern}`));
  return recommendations;
}

export type SyncEditorialLibraryOptions = {
  clara: ClaraKnowledgePort;
  clientId: string;
  report: WorkflowExecutionReport;
  feedbackRecord: QualityFeedbackRecord;
  campaign?: CampaignPlan;
  now?: () => Date;
};

/**
 * Atualiza (ou cria, na primeira avaliação de um cliente) o registro de `EditorialLibraryContext`
 * do cliente com o conteúdo recém-avaliado, e reprocessa os campos derivados (campeões, baixa
 * performance, temas repetidos/proibidos, padrões, recomendações) a partir do histórico completo já
 * acumulado. Um registro por cliente, igual ao Módulo 6 (Aprendizado).
 */
export async function syncEditorialLibrary(options: SyncEditorialLibraryOptions): Promise<ClaraKnowledgeRecord<"EditorialLibraryContext">> {
  const { clara, clientId, report, feedbackRecord, campaign, now } = options;
  const timestamp = (now ?? (() => new Date()))().toISOString();

  const signals = enrichWithCampaign(extractEditorialSignals(report), report, campaign);
  const newEntry = buildContentEntry(report, feedbackRecord, signals);

  const existing = await clara.list({ clientId, module: "EditorialLibraryContext", status: "active" });
  const current = existing[0]?.payload as EditorialLibraryContext | undefined;

  const producedContent = mergeContentEntries(current?.producedContent ?? [], newEntry);
  const { champions, lowPerformers } = recomputeChampionsAndLowPerformers(producedContent);
  const repeatedSubjects = computeRepeatedSubjects(producedContent);
  const temporarilyForbiddenSubjects = computeTemporarilyForbiddenSubjects(producedContent);
  const { workingPatterns, nonWorkingPatterns } = derivePatterns(champions, lowPerformers);

  const payload: EditorialLibraryContext = {
    clientId,
    producedContent,
    usedThemes: Array.from(new Set(producedContent.map((entry) => entry.theme))),
    usedFormats: Array.from(new Set(producedContent.map((entry) => entry.format).filter((format): format is string => Boolean(format)))),
    campaigns: Array.from(new Set(producedContent.map((entry) => entry.campaignId).filter((id): id is string => Boolean(id)))),
    objectives: Array.from(new Set(producedContent.map((entry) => entry.objective).filter((value): value is string => Boolean(value)))),
    ctas: Array.from(new Set(producedContent.map((entry) => entry.cta).filter((value): value is string => Boolean(value)))),
    emojis: Array.from(new Set(producedContent.flatMap((entry) => entry.emojis ?? []))),
    hooks: Array.from(new Set(producedContent.map((entry) => entry.hook).filter((value): value is string => Boolean(value)))),
    storytellingPatterns: Array.from(
      new Set(producedContent.map((entry) => entry.storytellingFramework).filter((value): value is string => Boolean(value))),
    ),
    evaluations: [
      ...(current?.evaluations ?? []).filter((evaluation) => evaluation.executionId !== feedbackRecord.executionId),
      {
        executionId: feedbackRecord.executionId,
        score: feedbackRecord.overallScore,
        format: feedbackRecord.format,
        comment: feedbackRecord.comment,
      },
    ],
    workingPatterns,
    nonWorkingPatterns,
    repeatedSubjects,
    temporarilyForbiddenSubjects,
    championContent: champions,
    lowPerformanceContent: lowPerformers,
    futureRecommendations: deriveFutureRecommendations(repeatedSubjects, temporarilyForbiddenSubjects, workingPatterns),
    lastSyncedAt: timestamp,
  };

  const audit = {
    actor: { id: "editorial-library-sync", type: "system" as const, name: "Sincronização Biblioteca Editorial" },
    reason: `Sincronização automática do Módulo 9 (Biblioteca Editorial) a partir da avaliação de ${report.executionId}.`,
    correlationId: `editorial-library-sync-${clientId}`,
  };

  if (existing[0]) {
    return clara.update<"EditorialLibraryContext">({ id: existing[0].id, patch: payload, audit });
  }
  return clara.create<"EditorialLibraryContext">({
    module: "EditorialLibraryContext",
    title: `Biblioteca Editorial — ${clientId}`,
    payload,
    audit,
  });
}
