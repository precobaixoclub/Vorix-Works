import type { AddonDefinition, PlanVersion } from "../../domain/platform-billing/plan-version.model.js";
import type { PlatformPlanCode } from "../../domain/platform-billing/platform-plan-catalog.js";
import type { PlanCapabilityMap, PlanLimitMap } from "../../domain/platform-billing/plan-entitlements.model.js";

export type CreatePlanVersionInput = {
  planCode: PlatformPlanCode;
  name: string;
  tagline: string;
  monthlyPriceUsd: number;
  yearlyPriceUsd: number;
  currency?: string;
  capabilities: PlanCapabilityMap;
  limits: PlanLimitMap;
  allowedAddonCodes: readonly string[];
  trialDays: number | null;
};

export type PlanVersionRepositoryPort = {
  /** `version` é sempre `1 + max(version existente para este planCode)`, calculado pelo próprio
   * repositório — nunca informado pelo chamador, pra nunca haver corrida ou duplicata. */
  createNextVersion(input: CreatePlanVersionInput): Promise<PlanVersion>;
  getById(id: string): Promise<PlanVersion | undefined>;
  /** A versão `active` mais recente de um `planCode` — a única oferecida a NOVAS assinaturas. */
  getActiveVersion(planCode: PlatformPlanCode): Promise<PlanVersion | undefined>;
  listVersions(planCode: PlatformPlanCode): Promise<PlanVersion[]>;
  listActivePlans(): Promise<PlanVersion[]>;
  deactivate(id: string): Promise<void>;
};

export type AddonDefinitionRepositoryPort = {
  getByCode(code: string): Promise<AddonDefinition | undefined>;
  listActive(): Promise<AddonDefinition[]>;
};
