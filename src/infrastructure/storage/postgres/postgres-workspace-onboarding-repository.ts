import type { Pool } from "pg";
import type {
  EnsureOnboardingStartedInput,
  UpdateWorkspaceOnboardingInput,
  WorkspaceOnboardingRepositoryPort,
} from "../../../application/ports/workspace-onboarding-repository.port.js";
import type { OnboardingGoal, OnboardingStatus, OnboardingStep, WorkspaceOnboarding } from "../../../domain/onboarding/onboarding.model.js";

const onboardingId = () => `onb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505");
}

type WorkspaceOnboardingRow = {
  id: string;
  tenant_id: string;
  workspace_id: string;
  status: string;
  current_step: string;
  completed_steps: string[];
  company_segment: string | null;
  company_size: string | null;
  primary_goal: string | null;
  started_at: Date;
  completed_at: Date | null;
  updated_at: Date;
};

function toDomain(row: WorkspaceOnboardingRow): WorkspaceOnboarding {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    status: row.status as OnboardingStatus,
    currentStep: row.current_step as OnboardingStep,
    completedSteps: (row.completed_steps ?? []) as OnboardingStep[],
    companySegment: row.company_segment ?? undefined,
    companySize: row.company_size ?? undefined,
    primaryGoal: (row.primary_goal ?? undefined) as OnboardingGoal | undefined,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at?.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Adapter Postgres do progresso de onboarding. `ensureStarted` segue EXATAMENTE o padrão já
 * comprovado de `ensureDefaultPipeline` (`pipeline-use-cases.ts`): tenta criar; se colidir com o
 * índice único (outra aba/requisição venceu a corrida), relê a linha já existente — nunca duas
 * linhas de progresso para o mesmo workspace, mesmo sob concorrência (seção 23 do pedido).
 */
export class PostgresWorkspaceOnboardingRepository implements WorkspaceOnboardingRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async ensureStarted(input: EnsureOnboardingStartedInput): Promise<WorkspaceOnboarding> {
    const existing = await this.getByWorkspace(input.workspaceId);
    if (existing) return existing;

    try {
      const result = await this.pool.query<WorkspaceOnboardingRow>(
        `insert into workspace_onboarding (id, tenant_id, workspace_id)
         values ($1, $2, $3)
         returning *`,
        [onboardingId(), input.tenantId, input.workspaceId],
      );
      return toDomain(result.rows[0]);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raceWinner = await this.getByWorkspace(input.workspaceId);
      if (!raceWinner) throw error;
      return raceWinner;
    }
  }

  async getByWorkspace(workspaceId: string): Promise<WorkspaceOnboarding | undefined> {
    const result = await this.pool.query<WorkspaceOnboardingRow>("select * from workspace_onboarding where workspace_id = $1", [workspaceId]);
    return result.rows[0] ? toDomain(result.rows[0]) : undefined;
  }

  async update(workspaceId: string, patch: UpdateWorkspaceOnboardingInput): Promise<WorkspaceOnboarding> {
    const sets: string[] = ["updated_at = now()"];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.status !== undefined) push("status", patch.status);
    if (patch.currentStep !== undefined) push("current_step", patch.currentStep);
    if (patch.completedSteps !== undefined) push("completed_steps", JSON.stringify(patch.completedSteps));
    if (patch.companySegment !== undefined) push("company_segment", patch.companySegment);
    if ("companySize" in patch) push("company_size", patch.companySize ?? null);
    if (patch.primaryGoal !== undefined) push("primary_goal", patch.primaryGoal);
    if ("completedAt" in patch) push("completed_at", patch.completedAt ?? null);

    params.push(workspaceId);
    const result = await this.pool.query<WorkspaceOnboardingRow>(
      `update workspace_onboarding set ${sets.join(", ")} where workspace_id = $${params.length} returning *`,
      params,
    );
    if (!result.rows[0]) throw new Error(`WORKSPACE_ONBOARDING_NOT_FOUND: progresso de onboarding do workspace "${workspaceId}" não existe.`);
    return toDomain(result.rows[0]);
  }
}
