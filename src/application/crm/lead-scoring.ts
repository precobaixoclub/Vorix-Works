import type { Contact, Deal, LeadScore, LeadScoreFactor, LeadTemperature, Task } from "../../domain/crm/crm.model.js";

/**
 * Pontuação de lead — CRM/Comercial, Fase 5. DETERMINÍSTICA (nunca IA), calculada sob demanda a
 * partir de dados reais já existentes (nunca persistida — evita ficar desatualizada). Cada fator
 * é evidência concreta (interação recente, negócio aberto, proposta vista, tarefa atrasada...) —
 * nunca uma pontuação "porque sim". Auditoria, seção 12: "nunca apresentar como verdade absoluta".
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / MS_PER_DAY);
}

export function computeLeadScore(input: { contact: Contact; deals: readonly Deal[]; tasks: readonly Task[]; now?: Date }): LeadScore {
  const now = input.now ?? new Date();
  const factors: LeadScoreFactor[] = [];

  const sinceInteraction = daysSince(input.contact.lastInteractionAt, now);
  if (sinceInteraction !== undefined && sinceInteraction <= 7) {
    factors.push({ label: "Interação recente (últimos 7 dias)", points: 25 });
  } else if (sinceInteraction !== undefined && sinceInteraction > 30) {
    factors.push({ label: "Sem interação há mais de 30 dias", points: -20 });
  }

  const openDeals = input.deals.filter((deal) => !deal.wonAt && !deal.lostAt);
  if (openDeals.length > 0) {
    factors.push({ label: `${openDeals.length} negócio(s) aberto(s)`, points: 20 });
    const highestValue = Math.max(...openDeals.map((deal) => deal.valueCents));
    if (highestValue >= 100_000) factors.push({ label: "Negócio de alto valor (≥ R$ 1.000)", points: 10 });
  }

  const wonDeals = input.deals.filter((deal) => deal.wonAt);
  if (wonDeals.length > 0) factors.push({ label: "Já teve negócio ganho com este contato", points: 15 });

  const pendingTasks = input.tasks.filter((task) => task.status === "pending");
  const overdueTasks = pendingTasks.filter((task) => task.dueAt && new Date(task.dueAt) < now);
  if (overdueTasks.length > 0) {
    factors.push({ label: `${overdueTasks.length} tarefa(s) atrasada(s)`, points: -15 });
  } else if (pendingTasks.length > 0) {
    factors.push({ label: "Tem próximo passo agendado", points: 10 });
  }

  const rawScore = factors.reduce((sum, factor) => sum + factor.points, 0);
  const score = Math.max(0, Math.min(100, rawScore));
  const temperature: LeadTemperature = score >= 67 ? "quente" : score >= 34 ? "morno" : "frio";

  return { score, temperature, factors };
}
