import type { BillingType } from "@/features/crm/types";
import type { ApprovalReason, GoalMetric, NegotiationHealth, ParticipantRole, ProposalEventType } from "./types";

/** Basis points → "57,9%". `—` quando ausente (nunca 0% inventado). */
export function formatBp(bp: number | undefined, digits = 1): string {
  if (bp === undefined || bp === null || Number.isNaN(bp)) return "—";
  return `${(bp / 100).toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`;
}

export const BILLING_TYPE_LABEL: Record<BillingType, string> = {
  one_time: "Pagamento único",
  monthly: "Mensal",
  quarterly: "Trimestral",
  annual: "Anual",
  per_unit: "Por unidade",
  per_hour: "Por hora",
  custom: "Personalizado",
};

export const BILLING_SUFFIX: Partial<Record<BillingType, string>> = { monthly: "/mês", quarterly: "/trimestre", annual: "/ano", per_hour: "/h", per_unit: "/un." };

export const HEALTH_LABEL: Record<NegotiationHealth, string> = { healthy: "Saudável", near_limit: "Próxima do limite", below_limit: "Abaixo do limite" };
export const HEALTH_CLASS: Record<NegotiationHealth, string> = {
  healthy: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  near_limit: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  below_limit: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
};

export const APPROVAL_REASON_LABEL: Record<ApprovalReason, string> = {
  below_minimum_price: "Preço abaixo do mínimo",
  margin_below_policy: "Margem abaixo da política",
  discount_above_autonomy: "Desconto acima da sua autonomia",
};

export const FORECAST_LABEL: Record<string, string> = { pipeline: "Pipeline", best_case: "Best case", commit: "Commit", closed: "Fechada", omitted: "Fora do forecast" };

export const GOAL_METRIC_LABEL: Record<GoalMetric, string> = {
  sales_revenue: "Receita vendida",
  gross_margin: "Lucro bruto",
  won_opportunities: "Negócios ganhos",
  mrr: "MRR (recorrência)",
};

export const PARTICIPANT_ROLE_LABEL: Record<ParticipantRole, string> = {
  decision_maker: "Decisor",
  influencer: "Influenciador",
  user: "Usuário",
  financial: "Financeiro",
  other: "Outro",
};

export const PROPOSAL_EVENT_LABEL: Record<ProposalEventType, string> = {
  created: "Proposta criada",
  approval_requested: "Aprovação solicitada",
  approved: "Aprovada internamente",
  rejected_internally: "Recusada internamente",
  sent: "Enviada",
  delivered: "WhatsApp: entregue",
  whatsapp_read: "WhatsApp: mensagem lida",
  whatsapp_failed: "WhatsApp: falha no envio",
  viewed: "Proposta aberta pelo cliente",
  downloaded: "Cliente salvou/imprimiu",
  accepted: "Aceita pelo cliente",
  declined: "Recusada pelo cliente",
  expired: "Expirou",
  superseded: "Substituída por nova versão",
  cancelled: "Cancelada",
  reminder_sent: "Lembrete enviado",
  follow_up_task_created: "Tarefa de follow-up criada",
};

export function proposalLabel(proposal: { number?: string; version?: number; title: string }): string {
  return `${proposal.number ?? "Proposta"}${proposal.version && proposal.version > 1 ? ` v${proposal.version}` : ""}`;
}

/** Entrada de % (ex.: "12,5") → basis points. */
export function bpFromPercentInput(value: string): number | undefined {
  const normalized = value.replace(/\s|%/g, "").replace(",", ".");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : undefined;
}

export function percentInputFromBp(bp: number | undefined): string {
  return bp === undefined ? "" : String(bp / 100).replace(".", ",");
}
