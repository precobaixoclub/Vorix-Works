/**
 * Onboarding guiado — SaaS Commercialization. Progresso por WORKSPACE (não por tenant/usuário):
 * um tenant com dois workspaces tem dois onboardings independentes, cada um no seu próprio estado
 * (ver auditoria — nenhuma estrutura equivalente existia antes). Vocabulário fechado de etapas —
 * nunca uma string livre, pra nunca haver ambiguidade entre "etapa desconhecida" e "concluída".
 */

export const ONBOARDING_STEPS = ["company", "channel", "team", "commercial", "brand", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_GOALS = ["content", "support", "sales", "all"] as const;
export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number];

export const ONBOARDING_STATUSES = ["in_progress", "completed"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export type WorkspaceOnboarding = {
  id: string;
  tenantId: string;
  workspaceId: string;
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  /** Etapas EFETIVAMENTE concluídas (não inclui as puladas) — o checklist de ativação da Home lê
   * isto para saber o que ainda falta, distinto de "o usuário decidiu pular por enquanto". */
  completedSteps: OnboardingStep[];
  companySegment?: string;
  companySize?: string;
  primaryGoal?: OnboardingGoal;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
};

/**
 * Etapas que o wizard percorre HOJE — o onboarding atual é exclusivamente do Vorix Conversas.
 * `"brand"` (identidade/marca) pertence ao Vorix Marketing e saiu da sequência: continua no
 * vocabulário acima porque existe em linhas já gravadas (e na constraint do banco), e volta como
 * onboarding COMPLEMENTAR quando o Marketing for contratável — na mesma conta, sem refazer este.
 */
export const ONBOARDING_WIZARD_STEPS: readonly OnboardingStep[] = ["company", "channel", "team", "commercial", "done"];

/** Próxima etapa na sequência do wizard — `"done"` não tem próxima (idempotente, fica nela). Uma
 * linha antiga parada em `"brand"` segue direto para `"done"`. */
export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_WIZARD_STEPS.indexOf(step);
  if (index < 0) return "done";
  return ONBOARDING_WIZARD_STEPS[index + 1] ?? "done";
}
