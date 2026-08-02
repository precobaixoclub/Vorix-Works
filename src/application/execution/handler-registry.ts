import type { ExecutionMode, HandlerFallbackPolicy, HandlerRetryPolicy, SideEffectPolicy } from "../../domain/execution/execution.model.js";
import type { ExecutionCapability, TaskType } from "../../domain/planning/planning.model.js";
import type { ExecutionTaskHandlerPort } from "./execution-handler.port.js";
import type { ExecutionFeatureFlags } from "./feature-flags.js";

export type ExecutionHandlerDescriptor = {
  id: string;
  provider: string;
  version: string;
  priority: number;
  handler: ExecutionTaskHandlerPort;
  executionModes: readonly ExecutionMode[];
  enabled: boolean;
  supportedCapabilities: readonly ExecutionCapability[];
  fallbackPolicy: HandlerFallbackPolicy;
  sideEffectPolicy?: SideEffectPolicy;
  retryPolicy?: HandlerRetryPolicy;
  executionTimeoutMs?: number;
  requiredFeatureFlags?: readonly (keyof ExecutionFeatureFlags)[];
};

export class ExecutionHandlerRegistry {
  private readonly descriptors: ExecutionHandlerDescriptor[] = [];

  register(descriptor: ExecutionHandlerDescriptor): void {
    if (this.descriptors.some((candidate) => candidate.id === descriptor.id)) {
      throw new Error(`EXECUTION_HANDLER_DUPLICATE: handler "${descriptor.id}" já registrado.`);
    }
    this.descriptors.push(descriptor);
  }

  list(): readonly ExecutionHandlerDescriptor[] {
    return [...this.descriptors].sort((left, right) => right.priority - left.priority);
  }

  findCandidates(input: { capability: ExecutionCapability; taskType: TaskType; executionMode: ExecutionMode; featureFlags: ExecutionFeatureFlags }): readonly ExecutionHandlerDescriptor[] {
    return this.list()
      .filter((descriptor) => descriptor.enabled)
      .filter((descriptor) => descriptor.executionModes.includes(input.executionMode))
      .filter((descriptor) => descriptor.supportedCapabilities.includes(input.capability))
      .filter((descriptor) => descriptor.handler.canHandle(input.capability, input.taskType))
      .filter((descriptor) => (descriptor.requiredFeatureFlags ?? []).every((flag) => input.featureFlags[flag]));
  }

  validateAvailability(input: { capability: ExecutionCapability; taskType: TaskType; executionMode: ExecutionMode; featureFlags: ExecutionFeatureFlags }): boolean {
    return this.findCandidates(input).length > 0;
  }
}
