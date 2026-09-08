import type { OnboardingGoal, OnboardingStatus, OnboardingStep, WorkspaceOnboarding } from "../../domain/onboarding/onboarding.model.js";

export type EnsureOnboardingStartedInput = { tenantId: string; workspaceId: string };

export type UpdateWorkspaceOnboardingInput = Partial<{
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  companySegment: string;
  companySize: string | null;
  primaryGoal: OnboardingGoal;
  completedAt: string | null;
}>;

export type WorkspaceOnboardingRepositoryPort = {
  /** Cria (ou devolve) a linha de progresso do workspace — idempotente. No máximo UMA por
   * workspace (índice único), mesmo padrão de `ensureDefaultPipeline`. */
  ensureStarted(input: EnsureOnboardingStartedInput): Promise<WorkspaceOnboarding>;
  getByWorkspace(workspaceId: string): Promise<WorkspaceOnboarding | undefined>;
  update(workspaceId: string, patch: UpdateWorkspaceOnboardingInput): Promise<WorkspaceOnboarding>;
};
