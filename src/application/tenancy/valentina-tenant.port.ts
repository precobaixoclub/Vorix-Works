import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type {
  ChangeTenantPlanInput,
  CreateTenantInput,
  TenantActionInput,
  TenantClientContext,
  TenantConsumptionInput,
  TenantCreditsInput,
  TenantIntegrationInput,
  TenantLimitCheckRequest,
  TenantLimitCheckResult,
  TenantPlanCode,
  TenantPlanDefinition,
  TenantQuery,
  TenantRecord,
  UpdateTenantInput,
} from "./valentina.types.js";

export type ValentinaTenantPort = {
  createTenant(input: CreateTenantInput): Promise<TenantRecord>;
  updateTenant(input: UpdateTenantInput): Promise<TenantRecord>;
  activateTenant(input: TenantActionInput): Promise<TenantRecord>;
  suspendTenant(input: TenantActionInput): Promise<TenantRecord>;
  deleteTenant(input: TenantActionInput): Promise<TenantRecord>;
  changePlan(input: ChangeTenantPlanInput): Promise<TenantRecord>;
  addCredits(input: TenantCreditsInput): Promise<TenantRecord>;
  consumeCredits(input: TenantConsumptionInput): Promise<TenantRecord>;
  connectIntegration(input: TenantIntegrationInput): Promise<TenantRecord>;
  disconnectIntegration(input: TenantIntegrationInput): Promise<TenantRecord>;
  getTenant(query: TenantQuery): Promise<TenantRecord | undefined>;
  listTenants(query?: TenantQuery): Promise<TenantRecord[]>;
  getClientContext(tenantId: string): Promise<TenantClientContext>;
  canUseSpecialist(tenantId: string, capability: SkillCapability): Promise<boolean>;
  checkLimits(request: TenantLimitCheckRequest): Promise<TenantLimitCheckResult>;
  getPlan(code: TenantPlanCode): Promise<TenantPlanDefinition>;
};
