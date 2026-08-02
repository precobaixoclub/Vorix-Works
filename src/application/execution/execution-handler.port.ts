import type { RuntimeTask } from "../../domain/runtime/runtime.model.js";
import type {
  ExecutionArtifactPayload,
  ExecutionAttempt,
  ExecutionMode,
  ExecutionFailure,
} from "../../domain/execution/execution.model.js";
import type { ExecutionCapability, TaskType } from "../../domain/planning/planning.model.js";

export type ExecutionTaskInputs = Record<string, readonly { artifactId: string; payload?: ExecutionArtifactPayload; checksum: string }[]>;

export type ExecutionTaskOutput = {
  outputs: readonly {
    outputPort: string;
    payload: ExecutionArtifactPayload;
  }[];
  warnings?: readonly string[];
};

export type ExecutionTaskHandlerRequest = {
  task: RuntimeTask;
  inputs: ExecutionTaskInputs;
  context: {
    executionRunId: string;
    tenantId: string;
    workspaceId: string;
    mode: ExecutionMode;
  };
  attempt: ExecutionAttempt;
};

export type ExecutionTaskHandlerResult =
  | { ok: true; value: ExecutionTaskOutput }
  | { ok: false; error: ExecutionFailure };

export type ExecutionTaskHandlerPort = {
  canHandle(capability: ExecutionCapability, taskType: TaskType): boolean;
  validateAvailability?(capability: ExecutionCapability, taskType: TaskType): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult>;
};
