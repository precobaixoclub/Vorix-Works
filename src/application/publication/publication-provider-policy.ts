import type { PublicationProvider } from "../../domain/publication/publication.model.js";

export type PublicationProviderEnvironment = "sandbox" | "production";

export type PublicationCanaryPolicy = {
  enabled: boolean;
  providerId: PublicationProvider;
  tenantIds: readonly string[];
  workspaceIds: readonly string[];
};

export type PublicationProviderEnvironmentPolicy = {
  environment: PublicationProviderEnvironment;
  productionEnabled: boolean;
};

export type PublicationProviderPolicyDecision =
  | { allowed: true; environment: PublicationProviderEnvironment }
  | { allowed: false; reason: "provider_mismatch" | "feature_disabled" | "tenant_not_allowed" | "workspace_not_allowed" | "production_blocked"; safeMessage: string };

export class PublicationProviderPolicy {
  constructor(
    private readonly environmentPolicy: PublicationProviderEnvironmentPolicy,
    private readonly canaryPolicy: PublicationCanaryPolicy,
  ) {}

  decide(input: { tenantId: string; workspaceId: string; providerId: PublicationProvider }): PublicationProviderPolicyDecision {
    if (input.providerId === "dry_run" || input.providerId === "fake") return { allowed: true, environment: "sandbox" };
    if (this.environmentPolicy.environment === "production" && !this.environmentPolicy.productionEnabled) {
      return { allowed: false, reason: "production_blocked", safeMessage: "Publication provider real bloqueado em production nesta sprint." };
    }
    if (!isSandboxExternalProvider(input.providerId) && input.providerId !== this.canaryPolicy.providerId) {
      return { allowed: false, reason: "provider_mismatch", safeMessage: "Provider externo fora do canary multi-provider." };
    }
    if (!this.canaryPolicy.enabled) {
      return { allowed: false, reason: "feature_disabled", safeMessage: "Canary de Publication provider real desabilitado." };
    }
    if (!this.canaryPolicy.tenantIds.includes(input.tenantId)) {
      return { allowed: false, reason: "tenant_not_allowed", safeMessage: "Tenant fora do canary de Publication." };
    }
    if (!this.canaryPolicy.workspaceIds.includes(input.workspaceId)) {
      return { allowed: false, reason: "workspace_not_allowed", safeMessage: "Workspace fora do canary de Publication." };
    }
    return { allowed: true, environment: this.environmentPolicy.environment };
  }

  shouldFallbackToDryRun(input: { tenantId: string; workspaceId: string; providerId?: PublicationProvider }): boolean {
    if (!input.providerId || input.providerId === "dry_run" || input.providerId === "fake") return false;
    return !this.decide({ tenantId: input.tenantId, workspaceId: input.workspaceId, providerId: input.providerId }).allowed;
  }
}

function isSandboxExternalProvider(providerId: PublicationProvider): boolean {
  return providerId === "meta_pages_sandbox" || providerId === "linkedin_sandbox" || providerId === "x_sandbox";
}
