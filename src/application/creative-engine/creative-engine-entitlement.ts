import type { ExecutionFeatureFlags } from "../execution/feature-flags.js";
import type { CreativeEngineEntitlementRepositoryPort } from "../ports/creative-engine-entitlement-repository.port.js";
import type { WorkspaceRepositoryPort } from "../ports/workspace-repository.port.js";
import { hasPermission, type Permission, type TenantRole } from "../../domain/identity/identity.model.js";

export type CreativeEngineAuthorizationDecision =
  | { ok: true; reason: "allowed" | "qa_allowed"; globalEnabled: boolean; entitlementEnabled: boolean }
  | { ok: false; code: string; message: string; httpStatus: 403 | 404 | 503 };

export type CreativeEngineAuthorizationDeps = {
  workspaceRepository: WorkspaceRepositoryPort;
  entitlementRepository?: CreativeEngineEntitlementRepositoryPort;
  featureFlags?: Pick<ExecutionFeatureFlags, "creativeEngineGptEnabled">;
};

export type CreativeEngineAuthorizationInput = {
  tenantId: string;
  workspaceId: string;
  actor?: { userId: string; role: TenantRole };
  requiredPermission?: Permission;
  qaBypassAllowed?: boolean;
};

export async function canUseCreativeEngine(
  deps: CreativeEngineAuthorizationDeps,
  input: CreativeEngineAuthorizationInput,
): Promise<CreativeEngineAuthorizationDecision> {
  if (deps.featureFlags?.creativeEngineGptEnabled !== true) {
    return {
      ok: false,
      code: "CREATIVE_ENGINE_TECHNICAL_FEATURE_DISABLED",
      message: "Geracao visual indisponivel neste ambiente.",
      httpStatus: 403,
    };
  }

  const workspace = await deps.workspaceRepository.getById(input.workspaceId);
  if (!workspace || workspace.tenantId !== input.tenantId) {
    return {
      ok: false,
      code: "CREATIVE_ENGINE_WORKSPACE_NOT_FOUND",
      message: "Workspace nao encontrado.",
      httpStatus: 404,
    };
  }

  if (input.actor && input.requiredPermission && !hasPermission(input.actor.role, input.requiredPermission)) {
    return {
      ok: false,
      code: "CREATIVE_ENGINE_ACTOR_FORBIDDEN",
      message: "Usuario sem permissao para gerar conteudo visual.",
      httpStatus: 403,
    };
  }

  if (input.qaBypassAllowed === true) {
    return { ok: true, reason: "qa_allowed", globalEnabled: true, entitlementEnabled: false };
  }

  if (!deps.entitlementRepository) {
    return {
      ok: false,
      code: "CREATIVE_ENGINE_ENTITLEMENT_UNAVAILABLE",
      message: "Geracao visual indisponivel para este workspace.",
      httpStatus: 503,
    };
  }

  let globalEnabled: boolean;
  let entitlementEnabled = false;
  try {
    const globalSettings = await deps.entitlementRepository.getGlobalSettings();
    globalEnabled = globalSettings.enabled;
    const entitlement = await deps.entitlementRepository.getWorkspaceEntitlement({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
    });
    entitlementEnabled = entitlement?.enabled === true;
  } catch {
    return {
      ok: false,
      code: "CREATIVE_ENGINE_ENTITLEMENT_UNAVAILABLE",
      message: "Geracao visual indisponivel para este workspace.",
      httpStatus: 503,
    };
  }

  if (!globalEnabled) {
    return {
      ok: false,
      code: "CREATIVE_ENGINE_GLOBAL_DISABLED",
      message: "Geracao visual indisponivel no momento.",
      httpStatus: 403,
    };
  }

  if (!entitlementEnabled) {
    return {
      ok: false,
      code: "CREATIVE_ENGINE_ENTITLEMENT_DENIED",
      message: "Geracao visual nao esta habilitada para este workspace.",
      httpStatus: 403,
    };
  }

  return { ok: true, reason: "allowed", globalEnabled, entitlementEnabled };
}

export async function assertCanUseCreativeEngine(
  deps: CreativeEngineAuthorizationDeps,
  input: CreativeEngineAuthorizationInput,
): Promise<Extract<CreativeEngineAuthorizationDecision, { ok: true }>> {
  const decision = await canUseCreativeEngine(deps, input);
  if (!decision.ok) {
    throw new Error(`${decision.code}: ${decision.message}`);
  }
  return decision;
}
