import type { CommercialMetricsReport } from "@/features/crm/types";
import type { InboxMetricsReport } from "@/features/inbox/types";
import type { SalesReports } from "@/features/sales/types";
import { formatBp } from "@/features/sales/presentation";
import { formatCurrencyCents } from "@/lib/format";
import type { ReportSectionContent, ReportSectionKey } from "./types";

/**
 * Cada seção do catálogo vira KPIs e/ou uma tabela a partir dos dados que o backend já calculou
 * (métricas comerciais, de atendimento e relatórios do Sales Engine). Nenhuma conta nova aqui —
 * só formatação. O mesmo conteúdo alimenta a tela, o CSV e a análise com IA.
 */
export type ReportSources = {
  commercial?: CommercialMetricsReport;
  inbox?: InboxMetricsReport;
  sales?: SalesReports;
  memberName: (userId: string) => string;
};

export const SECTION_SOURCE: Record<ReportSectionKey, "commercial" | "inbox" | "sales"> = {
  commercial_overview: "commercial",
  revenue_by_origin: "commercial",
  stage_aging: "commercial",
  loss_reasons: "commercial",
  sales_funnel: "sales",
  seller_conversion: "sales",
  top_products: "sales",
  proposals_performance: "sales",
  discounts_approvals: "sales",
  margin: "sales",
  attendance_overview: "inbox",
  agent_volume: "inbox",
  csat: "inbox",
  closing_reasons: "inbox",
};

const money = (cents: number | undefined) => (cents === undefined ? "—" : formatCurrencyCents(cents));
const count = (value: number | undefined) => (value === undefined ? "—" : value.toLocaleString("pt-BR"));
const rate = (fraction: number | undefined) => (fraction === undefined ? "—" : `${(fraction * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const days = (value: number | undefined) => (value === undefined ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`);
const hours = (value: number | undefined) => (value === undefined ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`);
function duration(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
}
const empty = (kpis: ReportSectionContent["kpis"], table?: ReportSectionContent["table"]): ReportSectionContent => ({ kpis, table, empty: kpis.length === 0 && (!table || table.rows.length === 0) });

export function buildSectionContent(key: ReportSectionKey, sources: ReportSources): ReportSectionContent | undefined {
  const { commercial: c, inbox: i, sales: s } = sources;
  switch (key) {
    case "commercial_overview":
      if (!c) return undefined;
      return empty([
        { label: "Oportunidades criadas", value: count(c.dealsCreatedCount) },
        { label: "Pipeline aberto", value: money(c.openPipelineValueCents) },
        { label: "Vendas ganhas", value: `${count(c.wonCount)} · ${money(c.wonValueCents)}` },
        { label: "Perdidas", value: count(c.lostCount) },
        { label: "Conversão", value: rate(c.conversionRate) },
        { label: "Ticket médio", value: money(c.avgTicketCents) },
        { label: "Ciclo médio de venda", value: days(c.avgCycleDays) },
        { label: "Sem próxima ação", value: count(c.dealsWithoutNextActionCount) },
      ]);
    case "revenue_by_origin":
      if (!c) return undefined;
      return empty([], { columns: ["Origem", "Vendas", "Receita"], rows: c.revenueByOrigin.map((row) => [row.origin || "Sem origem", count(row.wonCount), money(row.wonValueCents)]) });
    case "stage_aging":
      if (!c) return undefined;
      return empty([], { columns: ["Etapa", "Abertas", "Tempo médio na etapa"], rows: c.stageAging.map((row) => [row.stageName, count(row.openCount), days(row.avgDaysInStage)]) });
    case "loss_reasons":
      if (!c) return undefined;
      return empty([], { columns: ["Motivo", "Perdas"], rows: c.lossReasons.map((row) => [row.reason || "Sem motivo", count(row.count)]) });
    case "sales_funnel":
      if (!s) return undefined;
      return empty([], {
        columns: ["Etapa", "Entradas", "Avanço", "Tempo médio"],
        rows: s.funnel.flatMap((pipeline) => pipeline.stages.filter((stage) => !stage.isLost).map((stage) => [stage.name, count(stage.entered), formatBp(stage.advanceRateBp), days(stage.averageDays)])),
      });
    case "seller_conversion":
      if (!s) return undefined;
      return empty(
        [{ label: "Ganhas", value: count(s.conversion.won) }, { label: "Perdidas", value: count(s.conversion.lost) }, { label: "Conversão geral", value: formatBp(s.conversion.conversionBp) }],
        { columns: ["Vendedor", "Ganhas", "Perdidas", "Conversão", "Receita"], rows: s.conversion.bySeller.map((row) => [sources.memberName(row.id), count(row.won), count(row.lost), formatBp(row.conversionBp), money(row.wonValueCents)]) },
      );
    case "top_products":
      if (!s) return undefined;
      return empty([], {
        columns: ["Produto", "Qtd.", "Receita", "Ticket médio", "Margem"],
        rows: s.products.slice(0, 15).map((row) => [row.name, count(row.quantity), money(row.revenueCents), money(row.averageTicketCents), formatBp(row.grossMarginBp)]),
      });
    case "proposals_performance":
      if (!s) return undefined;
      return empty([
        { label: "Criadas", value: count(s.proposals.created) },
        { label: "Enviadas", value: count(s.proposals.sent) },
        { label: "Visualizadas", value: count(s.proposals.viewed) },
        { label: "Aceitas", value: count(s.proposals.accepted) },
        { label: "Recusadas", value: count(s.proposals.declined) },
        { label: "Enviada → aceita", value: formatBp(s.proposals.sentToAcceptedBp) },
        { label: "Tempo até visualizar", value: hours(s.proposals.averageHoursSentToViewed) },
        { label: "Tempo até aceitar", value: hours(s.proposals.averageHoursViewedToAccepted) },
      ]);
    case "discounts_approvals":
      if (!s) return undefined;
      return empty([
        { label: "Vendas com desconto", value: count(s.discounts.wonWithDiscount) },
        { label: "Desconto concedido", value: money(s.discounts.totalDiscountCents) },
        { label: "Desconto médio", value: formatBp(s.discounts.averageDiscountBp) },
        { label: "Aprovações pedidas", value: count(s.discounts.approvalsRequested) },
        { label: "Aprovadas", value: count(s.discounts.approvalsApproved) },
        { label: "Recusadas", value: count(s.discounts.approvalsRejected) },
      ]);
    case "margin":
      if (!s) return undefined;
      if (!s.margin) return { kpis: [], unavailableReason: "Margem visível só para quem pode ver custo." };
      return empty(
        [{ label: "Receita", value: money(s.margin.revenueCents) }, { label: "Custo", value: money(s.margin.costCents) }, { label: "Lucro bruto", value: money(s.margin.grossProfitCents) }, { label: "Margem", value: formatBp(s.margin.grossMarginBp) }],
        { columns: ["Vendedor", "Receita", "Lucro bruto", "Margem"], rows: s.margin.bySeller.map((row) => [sources.memberName(row.userId), money(row.revenueCents), money(row.grossProfitCents), formatBp(row.grossMarginBp)]) },
      );
    case "attendance_overview":
      if (!i) return undefined;
      return empty([
        { label: "Conversas recebidas", value: count(i.receivedCount) },
        { label: "Abertas", value: count(i.openCount) },
        { label: "Pendentes", value: count(i.pendingCount) },
        { label: "Resolvidas", value: count(i.resolvedCount) },
        { label: "Fila (backlog)", value: count(i.backlogCount) },
        { label: "1ª resposta média", value: duration(i.avgFirstResponseSeconds) },
        { label: "Tempo médio de atendimento", value: duration(i.avgHandleTimeSeconds) },
        { label: "Respostas IA × humano", value: `${count(i.aiResolvedMessageCount)} × ${count(i.humanResolvedMessageCount)}` },
      ]);
    case "agent_volume":
      if (!i) return undefined;
      return empty([], { columns: ["Atendente", "Mensagens"], rows: [...i.volumeByAgent].sort((a, b) => b.messageCount - a.messageCount).map((row) => [sources.memberName(row.userId), count(row.messageCount)]) });
    case "csat":
      if (!i) return undefined;
      return empty(
        [
          { label: "Nota média", value: i.csatAverage === undefined ? "—" : `${i.csatAverage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} / 5` },
          { label: "Respostas", value: count(i.csatResponses) },
          { label: "Pesquisas enviadas", value: count(i.csatRequested) },
        ].filter((kpi) => kpi.value !== "—" || i.csatRequested),
        { columns: ["Atendente", "Nota", "Respostas"], rows: (i.csatByAgent ?? []).map((row) => [sources.memberName(row.userId), row.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 }), count(row.responses)]) },
      );
    case "closing_reasons":
      if (!i) return undefined;
      return empty([], { columns: ["Motivo", "Conversas"], rows: (i.closingReasons ?? []).map((row) => [row.reason, count(row.count)]) });
  }
}

/** Linhas "Rótulo: valor" para a IA e para o CSV. */
export function sectionLines(content: ReportSectionContent): string[] {
  const lines = content.kpis.map((kpi) => `${kpi.label}: ${kpi.value}`);
  if (content.table) {
    const [first, ...rest] = content.table.columns;
    for (const row of content.table.rows.slice(0, 25)) {
      lines.push(`${first} ${row[0]} — ${rest.map((column, index) => `${column}: ${row[index + 1]}`).join(", ")}`);
    }
  }
  return lines;
}
