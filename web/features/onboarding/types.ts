/** Onboarding guiado — espelha `src/domain/onboarding/onboarding.model.ts` e
 * `src/application/onboarding/onboarding-use-cases.ts` do backend. */

export const ONBOARDING_STEPS = ["company", "channel", "team", "commercial", "brand", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_GOALS = ["content", "support", "sales", "all"] as const;
export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number];

export type OnboardingStatus = "in_progress" | "completed";

export type WorkspaceOnboarding = {
  id: string;
  tenantId: string;
  workspaceId: string;
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  companySegment?: string;
  companySize?: string;
  primaryGoal?: OnboardingGoal;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
};
