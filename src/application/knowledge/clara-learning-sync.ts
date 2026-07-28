import type { ClaraKnowledgePort } from "./clara-knowledge.port.js";
import type { ClaraKnowledgeRecord, LearningContext } from "./clara.types.js";
import type { QualityFeedbackPort, QualityFeedbackReport } from "../quality-feedback/index.js";

/**
 * Integração automática do Módulo 6 (Aprendizado) da Clara com o Quality Feedback — os dois
 * sistemas eram inteiramente independentes antes desta evolução (Quality Feedback nunca escrevia
 * na Clara, Clara nunca lia o Quality Feedback). Não é uma Skill nem uma nova camada
 * arquitetural: é lógica de aplicação no mesmo nível de `ClaraKnowledgeCenter`/
 * `QualityFeedbackCenter`, acionada explicitamente por quem já orquestra os dois (hoje, a CLI em
 * `recordQualityFeedback`) — nenhuma Skill precisa saber que esta sincronização existe.
 *
 * Grava sempre em `LearningContext`, nunca em outro módulo — e nunca decide nada por conta
 * própria: apenas espelha, em formato estruturado, o que o Quality Feedback já calculou
 * (`bestRatedContent`, `worstRatedContent`, `topRecurringComplaints`, `qualityOverTime`).
 */

/** Constrói o payload de `LearningContext` a partir de um `QualityFeedbackReport` já calculado — função pura, sem I/O. */
export function buildLearningContextPayload(
  clientId: string,
  report: QualityFeedbackReport,
  now: () => Date = () => new Date(),
): LearningContext {
  return {
    clientId,
    bestRatedContent: report.bestRatedContent.map((content) => ({
      executionId: content.executionId,
      format: content.format,
      score: content.overallScore,
    })),
    rejectedContent: report.worstRatedContent.map((content) => ({
      executionId: content.executionId,
      format: content.format,
      score: content.overallScore,
      reasons: content.comment ? [content.comment] : undefined,
    })),
    recurringPatterns: report.topRecurringComplaints.map(
      (complaint) => `${complaint.category}: ${complaint.count} ocorrência(s) (${Math.round(complaint.ratio * 100)}% das avaliações).`,
    ),
    qualityEvolution: report.qualityOverTime.map((point) => ({ period: point.period, averageScore: point.averageScore })),
    futureRecommendations: buildFutureRecommendations(report),
    lastSyncedAt: now().toISOString(),
  };
}

function buildFutureRecommendations(report: QualityFeedbackReport): string[] {
  const recommendations: string[] = [];
  for (const complaint of report.topRecurringComplaints.slice(0, 3)) {
    recommendations.push(`Priorizar melhorias em "${complaint.category}" — presente em ${Math.round(complaint.ratio * 100)}% das avaliações.`);
  }
  const worstFormat = [...report.averageByFormat].sort((left, right) => left.averageScore - right.averageScore)[0];
  if (worstFormat && report.averageByFormat.length > 1) {
    recommendations.push(`Formato "${worstFormat.key}" tem a média mais baixa (${worstFormat.averageScore}) — revisar critérios específicos desse formato.`);
  }
  return recommendations;
}

export type SyncQualityFeedbackToClaraOptions = {
  clara: ClaraKnowledgePort;
  qualityFeedback: QualityFeedbackPort;
  clientId: string;
  now?: () => Date;
};

/**
 * Lê o relatório de Quality Feedback do cliente e grava/atualiza o `LearningContext`
 * correspondente na Clara (um registro por cliente — cria na primeira sincronização, atualiza
 * nas seguintes, preservando o histórico de versões já genérico de qualquer registro da Clara).
 */
export async function syncQualityFeedbackToClara(
  options: SyncQualityFeedbackToClaraOptions,
): Promise<ClaraKnowledgeRecord<"LearningContext">> {
  const { clara, qualityFeedback, clientId, now } = options;
  const report = await qualityFeedback.getReport({ clientId });
  const payload = buildLearningContextPayload(clientId, report, now);

  const audit = {
    actor: { id: "quality-feedback-sync", type: "system" as const, name: "Sincronização Quality Feedback -> Clara" },
    reason: "Sincronização automática do Módulo 6 (Aprendizado) a partir do Quality Feedback.",
    correlationId: `learning-sync-${clientId}`,
  };

  const existing = await clara.list({ clientId, module: "LearningContext", status: "active" });
  if (existing[0]) {
    return clara.update<"LearningContext">({ id: existing[0].id, patch: payload, audit });
  }
  return clara.create<"LearningContext">({
    module: "LearningContext",
    title: `Aprendizado — ${clientId}`,
    payload,
    audit,
  });
}
