import type { Permission, TenantRole } from "../../domain/identity/identity.model.js";
import { hasPermission } from "../../domain/identity/identity.model.js";
import type { Credential, CredentialBinding, CredentialHealth } from "../../domain/credential/credential.model.js";
import type { PublicationProvider } from "../../domain/publication/publication.model.js";
import type { PublicationProviderEnvironmentPolicy, PublicationCanaryPolicy } from "../publication/publication-provider-policy.js";
import { canaryAllowsProvider, canaryAllowsScope } from "../publication/publication-provider-policy.js";

export type PublicationGovernancePolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: "rbac_denied" | "production_blocked" | "provider_mismatch" | "feature_disabled" | "tenant_not_allowed" | "workspace_not_allowed" | "credential_missing" | "credential_inactive" | "scope_mismatch" | "approval_required"; safeMessage: string };

export class PublicationGovernancePolicy {
  constructor(
    private readonly environmentPolicy: PublicationProviderEnvironmentPolicy,
    private readonly canaryPolicy: PublicationCanaryPolicy,
  ) {}

  decide(input: {
    tenantId: string;
    workspaceId: string;
    providerId: PublicationProvider;
    role: TenantRole;
    permission: Permission;
    credential?: Credential;
    binding?: CredentialBinding;
    health?: CredentialHealth;
    approvalPresent?: boolean;
    approvalRequired?: boolean;
  }): PublicationGovernancePolicyDecision {
    if (!hasPermission(input.role, input.permission)) return { allowed: false, reason: "rbac_denied", safeMessage: "RBAC negou a operação." };
    if (input.providerId === "dry_run" || input.providerId === "fake") return { allowed: true };
    if (this.environmentPolicy.environment === "production" && !this.environmentPolicy.productionEnabled) return { allowed: false, reason: "production_blocked", safeMessage: "Production permanece bloqueada para publicação externa." };
    if (!isSandboxExternalProvider(input.providerId) && !canaryAllowsProvider(this.canaryPolicy, input.providerId)) return { allowed: false, reason: "provider_mismatch", safeMessage: "Provider fora da governança canário configurada." };
    if (!this.canaryPolicy.enabled) return { allowed: false, reason: "feature_disabled", safeMessage: "Canário de provider externo desabilitado." };
    if (!canaryAllowsScope(this.canaryPolicy.tenantIds, input.tenantId)) return { allowed: false, reason: "tenant_not_allowed", safeMessage: "Tenant fora do canário." };
    if (!canaryAllowsScope(this.canaryPolicy.workspaceIds, input.workspaceId)) return { allowed: false, reason: "workspace_not_allowed", safeMessage: "Workspace fora do canário." };
    if (input.approvalRequired && !input.approvalPresent) return { allowed: false, reason: "approval_required", safeMessage: "Aprovação operacional obrigatória ausente." };
    if (!input.credential || !input.binding) return { allowed: false, reason: "credential_missing", safeMessage: "Credencial governada ausente." };
    if (input.credential.status !== "connected" && input.credential.status !== "expiring") return { allowed: false, reason: "credential_inactive", safeMessage: "Credencial não está conectada." };
    if (input.binding.status !== "active") return { allowed: false, reason: "credential_inactive", safeMessage: "Binding da credencial não está ativo." };
    if (this.environmentPolicy.environment === "sandbox" && !input.binding.canary) return { allowed: false, reason: "credential_inactive", safeMessage: "Binding da credencial não está ativo no canário." };
    if (input.health && (!input.health.tokenValid || input.health.missingScopes.length > 0 || input.health.expired)) return { allowed: false, reason: "scope_mismatch", safeMessage: "Credencial inválida, expirada ou com escopos insuficientes." };
    return { allowed: true };
  }
}

function isSandboxExternalProvider(providerId: PublicationProvider): boolean {
  return providerId === "meta_pages_sandbox" || providerId === "linkedin_sandbox" || providerId === "x_sandbox";
}
