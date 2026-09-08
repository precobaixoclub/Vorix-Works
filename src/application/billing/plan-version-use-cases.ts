import type { AddonDefinitionRepositoryPort, CreatePlanVersionInput, PlanVersionRepositoryPort } from "../ports/plan-version-repository.port.js";
import type { AddonDefinition, PlanVersion } from "../../domain/platform-billing/plan-version.model.js";
import type { PlatformPlanCode } from "../../domain/platform-billing/platform-plan-catalog.js";

export type PlanVersionUseCaseDeps = {
  planVersionRepository: PlanVersionRepositoryPort;
  addonDefinitionRepository: AddonDefinitionRepositoryPort;
};

/**
 * Publica uma NOVA versão de um plano — nunca sobrescreve a anterior (auditoria não-negociável:
 * "não sobrescrever silenciosamente benefícios de assinaturas antigas"). Quem já assina a versão
 * antiga continua nela até fazer upgrade/renovar sob a política nova; só assinaturas NOVAS (ou
 * tenants sem assinatura real ainda, via a resolução "virtual" de `entitlement-use-cases.ts`)
 * enxergam a versão recém-publicada, porque `getActiveVersion` sempre pega a de maior `version`.
 */
export async function publishPlanVersion(deps: PlanVersionUseCaseDeps, input: CreatePlanVersionInput): Promise<PlanVersion> {
  return deps.planVersionRepository.createNextVersion(input);
}

export async function getActivePlanVersion(deps: PlanVersionUseCaseDeps, planCode: PlatformPlanCode): Promise<PlanVersion | undefined> {
  return deps.planVersionRepository.getActiveVersion(planCode);
}

export async function listActivePlanVersions(deps: PlanVersionUseCaseDeps): Promise<PlanVersion[]> {
  return deps.planVersionRepository.listActivePlans();
}

export async function listPlanVersionHistory(deps: PlanVersionUseCaseDeps, planCode: PlatformPlanCode): Promise<PlanVersion[]> {
  return deps.planVersionRepository.listVersions(planCode);
}

export async function deactivatePlanVersion(deps: PlanVersionUseCaseDeps, id: string): Promise<void> {
  await deps.planVersionRepository.deactivate(id);
}

export async function listActiveAddons(deps: PlanVersionUseCaseDeps): Promise<AddonDefinition[]> {
  return deps.addonDefinitionRepository.listActive();
}
