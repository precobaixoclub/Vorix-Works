import type { Deal } from "../../domain/crm/crm.model.js";
import type { DealConversationReaderPort, DealInsightsGeneratorPort, DealInsightsMessage } from "../ports/deal-insights.port.js";
import type { ProposalRepositoryPort } from "../ports/proposal-repository.port.js";
import { getDealCommercialSummary, type DealCommercialSummary } from "./deal-commercial-use-cases.js";
import { getDealGoalImpact, getPerformance, type SalesPerformanceDeps } from "./sales-performance-use-cases.js";
import { loadCommercialSettings, mustDealInWorkspace, type SalesActor } from "./sales-context.js";

export type DealInsightsDeps = SalesPerformanceDeps & {
  proposalRepository: ProposalRepositoryPort;
  conversationReader?: DealConversationReaderPort;
  insightsGenerator?: DealInsightsGeneratorPort;
};

const money = (cents: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
const pct = (bp: number) => `${(bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export type DeterministicRisk = { code: string; title: string; evidence?: string };

/** Riscos SEM IA — só o que os dados mostram (nunca inventados). */
export function deterministicRisks(deal: Deal, summary: DealCommercialSummary, context: { proposalViewedWithoutAnswerDays?: number; competitorMention?: string }): DeterministicRisk[] {
  if (deal.status !== "open") return [];
  const risks: DeterministicRisk[] = [];
  if (summary.aging.daysWithoutActivity !== undefined && summary.aging.daysWithoutActivity >= 7) risks.push({ code: "no_activity", title: `Sem atividade há ${summary.aging.daysWithoutActivity} dias` });
  if (summary.aging.stale) risks.push({ code: "stale", title: `Parada na etapa há ${summary.aging.daysInStage} dias` });
  if (!summary.nextActivity) risks.push({ code: "no_next_action", title: "Sem próxima ação definida" });
  if (summary.aging.expectedCloseOverdue) risks.push({ code: "close_date_overdue", title: "Data prevista de fechamento vencida" });
  if (context.proposalViewedWithoutAnswerDays !== undefined) risks.push({ code: "proposal_no_answer", title: `Proposta aberta há ${context.proposalViewedWithoutAnswerDays} dias sem resposta` });
  if (summary.evaluation.health === "near_limit") risks.push({ code: "margin_near_limit", title: "Condição próxima do limite da política comercial" });
  if (summary.evaluation.health === "below_limit") risks.push({ code: "below_policy", title: "Condição abaixo da política — exige aprovação" });
  if (context.competitorMention) risks.push({ code: "competitor_mentioned", title: "Cliente mencionou concorrente", evidence: context.competitorMention });
  return risks;
}

function findCompetitorMention(messages: readonly DealInsightsMessage[], competitorNames: readonly string[]): string | undefined {
  const terms = ["concorrente", "concorrência", ...competitorNames.map((name) => name.toLowerCase())].filter((term) => term.length >= 3);
  const hit = [...messages].reverse().find((message) => message.direction === "inbound" && terms.some((term) => message.text.toLowerCase().includes(term)));
  return hit ? hit.text.slice(0, 200) : undefined;
}

/** Cockpit de IA da oportunidade — parte determinística (sempre disponível, sem custo de IA). */
export async function getDealInsights(deps: DealInsightsDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  const summary = await getDealCommercialSummary(deps, actor, { workspaceId: input.workspaceId, dealId: deal.id, now });
  const proposals = await deps.proposalRepository.listByWorkspace({ tenantId: actor.tenantId, workspaceId: input.workspaceId, dealId: deal.id, limit: 20 });
  const viewedOpen = proposals.find((proposal) => proposal.status === "viewed" && proposal.lastViewedAt);
  const viewedDays = viewedOpen ? Math.floor((now.getTime() - new Date(viewedOpen.lastViewedAt as string).getTime()) / 86_400_000) : undefined;
  const messages = deal.contactId && deps.conversationReader ? await deps.conversationReader.recentMessages({ tenantId: actor.tenantId, workspaceId: input.workspaceId, contactId: deal.contactId, limit: 30 }) : [];
  const competitors = await deps.salesConfigRepository.listCompetitors({ tenantId: actor.tenantId, workspaceId: input.workspaceId });
  const risks = deterministicRisks(deal, summary, { proposalViewedWithoutAnswerDays: viewedDays !== undefined && viewedDays >= 2 ? viewedDays : undefined, competitorMention: findCompetitorMention(messages, competitors.map((item) => item.name)) });

  // Explicações determinísticas (a IA, se usada, só reescreve — nunca muda números).
  const explanations: string[] = [];
  const totals = summary.totals;
  if (totals.negotiationRoomCents !== undefined && totals.negotiationRoomCents > 0) explanations.push(`Há até ${money(totals.negotiationRoomCents, summary.currency)} de espaço comercial antes do preço mínimo.`);
  if (totals.negotiationRoomCents !== undefined && totals.negotiationRoomCents < 0) explanations.push(`A condição atual está ${money(-totals.negotiationRoomCents, summary.currency)} abaixo do preço mínimo — exige aprovação.`);
  if (totals.grossMarginBp !== undefined) explanations.push(`Margem atual de ${pct(totals.grossMarginBp)}${summary.policy.minMarginBp !== undefined ? ` (mínima da política: ${pct(summary.policy.minMarginBp)})` : ""}.`);
  const impact = await getDealGoalImpact(deps, actor, { workspaceId: input.workspaceId, dealId: deal.id, now }).catch(() => ({ available: false as const }));
  if (impact.available) {
    explanations.push(`Esta oportunidade representa ${pct(impact.dealShareOfGoalBp)} da meta mensal. Se fechar, a meta vai de ${pct(impact.attainmentBp)} para ${pct(impact.afterCloseAttainmentBp)}.`);
    const performance = await getPerformance(deps, actor, { workspaceId: input.workspaceId, userId: impact.ownerUserId, now }).catch(() => undefined);
    if (performance && impact.targetCents > 0) {
      const withCommit = performance.forecast.wonCents + performance.forecast.commitCents;
      explanations.push(`Fechando as oportunidades em Commit, o realizado chegaria a ${pct(Math.round((withCommit * 10000) / impact.targetCents))} da meta.`);
    }
  }
  const settings = await loadCommercialSettings(deps, actor.tenantId, input.workspaceId);
  return {
    dealId: deal.id,
    risks,
    explanations,
    goalImpact: impact,
    nextActivity: summary.nextActivity,
    aiAvailable: Boolean(deps.insightsGenerator),
    hasConversation: messages.length > 0,
    marginVisible: resolveMarginVisible(actor, settings),
  };
}

function resolveMarginVisible(actor: SalesActor, settings: { sellersCanViewMargin: boolean }): boolean {
  return actor.role === "owner" || actor.role === "admin" || (actor.role === "editor" && settings.sellersCanViewMargin);
}

/** IA sob demanda: resumo, riscos e próximas ações com evidência literal (validada no gateway). */
export async function generateDealAiInsights(deps: DealInsightsDeps, actor: SalesActor, input: { workspaceId: string; dealId: string; now?: Date }) {
  if (!deps.insightsGenerator) throw new Error("DEAL_INSIGHTS_UNAVAILABLE: IA comercial não está configurada.");
  const now = input.now ?? new Date();
  const deal = await mustDealInWorkspace(deps, input.dealId, actor.tenantId, input.workspaceId);
  const deterministic = await getDealInsights(deps, actor, { ...input, now });
  const summary = await getDealCommercialSummary(deps, actor, { workspaceId: input.workspaceId, dealId: deal.id, now });
  const stages = await deps.pipelineStageRepository.listByPipeline(deal.pipelineId);
  const proposals = await deps.proposalRepository.listByWorkspace({ tenantId: actor.tenantId, workspaceId: input.workspaceId, dealId: deal.id, limit: 10 });
  const tasks = deps.taskRepository ? await deps.taskRepository.listByWorkspace({ tenantId: actor.tenantId, workspaceId: input.workspaceId, dealId: deal.id, status: "pending", limit: 20 }) : [];
  const messages = deal.contactId && deps.conversationReader ? await deps.conversationReader.recentMessages({ tenantId: actor.tenantId, workspaceId: input.workspaceId, contactId: deal.contactId, limit: 30 }) : [];
  const facts = [
    `Valor: ${money(deal.valueCents, deal.currency)} (${deal.valueMode === "calculated" ? "calculado pelos produtos" : "manual"})`,
    `Probabilidade: ${summary.probability.value}% · categoria de forecast: ${deal.forecastCategory}`,
    `Dias aberta: ${summary.aging.daysOpen} · dias na etapa: ${summary.aging.daysInStage}${summary.aging.daysWithoutActivity !== undefined ? ` · dias sem atividade: ${summary.aging.daysWithoutActivity}` : ""}`,
    ...(deal.expectedCloseDate ? [`Previsão de fechamento: ${deal.expectedCloseDate}${summary.aging.expectedCloseOverdue ? " (vencida)" : ""}`] : []),
    ...summary.items.map((item) => `Item: ${item.productNameSnapshot} × ${item.quantity} a ${money(item.proposedUnitPriceCents, deal.currency)} (tabela ${money(item.listPriceCentsSnapshot, deal.currency)})`),
    // Margem/custo só entram no texto da IA se o usuário pode vê-los.
    ...deterministic.explanations.filter((text) => deterministic.marginVisible || !text.startsWith("Margem")),
  ];
  const result = await deps.insightsGenerator.generate({
    tenantId: actor.tenantId,
    workspaceId: input.workspaceId,
    dealTitle: deal.title,
    stageName: stages.find((stage) => stage.id === deal.stageId)?.name ?? "",
    status: deal.status,
    facts,
    proposals: proposals.map((proposal) => `${proposal.number ?? "Proposta"} v${proposal.version}: ${proposal.status}, ${money(proposal.totalCents, proposal.currency)}, ${proposal.viewCount} visualização(ões)${proposal.rejectionReason ? `, recusada por "${proposal.rejectionReason}"` : ""}`),
    pendingTasks: tasks.map((task) => `${task.title}${task.dueAt ? ` (prazo ${task.dueAt.slice(0, 10)})` : ""}`),
    messages: messages.map((message) => ({ ...message, text: message.text.slice(0, 400) })),
  });
  if (!result.ok) throw new Error(`DEAL_INSIGHTS_FAILED: ${result.message}`);
  await deps.timelineEventRepository.record({ tenantId: deal.tenantId, workspaceId: deal.workspaceId, entityType: "deal", entityId: deal.id, eventType: "deal_ai_insights_generated", actorType: "user", actorId: actor.userId, payload: { traceId: result.traceId, risks: result.risks.length, actions: result.nextActions.length } });
  return { generatedAt: now.toISOString(), summary: result.summary, summaryEvidence: result.summaryEvidence, risks: result.risks, nextActions: result.nextActions, traceId: result.traceId };
}
