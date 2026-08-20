import type { ExecutionFailure, ExecutionMode, SideEffectPolicy } from "../../domain/execution/execution.model.js";
import type { ExecutionCapability } from "../../domain/planning/planning.model.js";
import type { ExecutionFeatureFlags } from "./feature-flags.js";
import type { ExecutionHandlerDescriptor } from "./handler-registry.js";

export const EXECUTION_ENVIRONMENTS = ["development", "test", "staging", "production"] as const;
export type ExecutionEnvironment = (typeof EXECUTION_ENVIRONMENTS)[number];

export type ExecutionEnvironmentPolicy = {
  environment: ExecutionEnvironment;
  allowedSideEffects: readonly SideEffectPolicy[];
  realExecutionAllowed: boolean;
  networkAllowed: boolean;
  publicationAllowed: boolean;
  allowedProviders: readonly string[];
};

export type SideEffectGuardInput = {
  executionMode: ExecutionMode;
  tenantId: string;
  workspaceId: string;
  capability: ExecutionCapability;
  descriptor: ExecutionHandlerDescriptor;
  featureFlags: ExecutionFeatureFlags;
};

export const DEFAULT_EXECUTION_ENVIRONMENT_POLICIES: Record<ExecutionEnvironment, ExecutionEnvironmentPolicy> = {
  development: {
    environment: "development",
    allowedSideEffects: ["none", "external_read", "external_write", "publication_preview"],
    realExecutionAllowed: true,
    networkAllowed: true,
    publicationAllowed: false,
    // "gpt-creative-engine" — migração "GPT como motor criativo único" (PR 6/9), provider dos
    // handlers do motor GPT (`gpt-creative-engine-execution-handlers.ts`), mesmo tratamento de
    // "helena" (único outro provider real permitido).
    allowedProviders: ["deterministic", "helena", "gpt-creative-engine", "fake"],
  },
  test: {
    environment: "test",
    allowedSideEffects: ["none"],
    realExecutionAllowed: false,
    networkAllowed: false,
    publicationAllowed: false,
    allowedProviders: ["deterministic", "fake"],
  },
  staging: {
    environment: "staging",
    allowedSideEffects: ["none", "external_read", "external_write", "publication_preview"],
    realExecutionAllowed: true,
    networkAllowed: true,
    publicationAllowed: false,
    allowedProviders: ["deterministic", "helena", "gpt-creative-engine", "fake"],
  },
  production: {
    environment: "production",
    allowedSideEffects: ["none", "external_read", "external_write", "publication_preview"],
    realExecutionAllowed: true,
    networkAllowed: true,
    publicationAllowed: false,
    allowedProviders: ["deterministic", "helena", "gpt-creative-engine"],
  },
};

export function createExecutionEnvironmentPolicy(environment: ExecutionEnvironment = "development"): ExecutionEnvironmentPolicy {
  return DEFAULT_EXECUTION_ENVIRONMENT_POLICIES[environment];
}

export class SideEffectGuard {
  constructor(private readonly policy: ExecutionEnvironmentPolicy = createExecutionEnvironmentPolicy()) {}

  assertAllowed(input: SideEffectGuardInput): { ok: true } | { ok: false; failure: ExecutionFailure } {
    const sideEffect = input.descriptor.sideEffectPolicy ?? "none";
    if (!input.tenantId || !input.workspaceId) return denied("SIDE_EFFECT_CONTEXT_INVALID", "Tenant e Workspace são obrigatórios para executar handler.");
    if (input.executionMode === "real" && !this.policy.realExecutionAllowed) return denied("REAL_EXECUTION_BLOCKED_BY_ENVIRONMENT", `Ambiente "${this.policy.environment}" não permite execução real.`);
    if (!this.policy.allowedProviders.includes(input.descriptor.provider)) return denied("PROVIDER_BLOCKED_BY_ENVIRONMENT", `Provider "${input.descriptor.provider}" não é permitido no ambiente "${this.policy.environment}".`);
    if (sideEffect === "publication") return denied("PUBLICATION_BLOCKED", "Publicação real permanece proibida nesta sprint.");
    if (!this.policy.allowedSideEffects.includes(sideEffect)) return denied("SIDE_EFFECT_BLOCKED", `Side effect "${sideEffect}" bloqueado pela política do ambiente "${this.policy.environment}".`);
    for (const flag of input.descriptor.requiredFeatureFlags ?? []) {
      if (!input.featureFlags[flag]) return denied("HANDLER_FEATURE_FLAG_DISABLED", `Feature flag "${flag}" está desligada.`);
    }
    return { ok: true };
  }
}

function denied(code: string, message: string): { ok: false; failure: ExecutionFailure } {
  return { ok: false, failure: { code, message, category: "policy_violation", retryable: false } };
}
