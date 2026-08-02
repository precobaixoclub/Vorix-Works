import type { ExecutionTaskHandlerPort, ExecutionTaskHandlerRequest, ExecutionTaskHandlerResult } from "./execution-handler.port.js";
import type { ExecutionCapability, TaskType } from "../../domain/planning/planning.model.js";

const declaredOutputByTaskType: Partial<Record<TaskType, string>> = {
  research: "context",
  campaign_structure: "structure",
  copy_generation: "copy",
  visual_generation: "visual",
  publication: "manifest",
};

export class DeterministicExecutionTaskHandler implements ExecutionTaskHandlerPort {
  canHandle(capability: ExecutionCapability, taskType: TaskType): boolean {
    return capability !== "human_review" && taskType !== "approval";
  }

  async execute(request: ExecutionTaskHandlerRequest): Promise<ExecutionTaskHandlerResult> {
    const outputPort = declaredOutputByTaskType[request.task.type];
    if (!outputPort) {
      return {
        ok: false,
        error: { code: "HANDLER_OUTPUT_PORT_UNKNOWN", message: `Nenhuma porta determinística para ${request.task.type}.`, category: "policy_violation", retryable: false },
      };
    }

    return {
      ok: true,
      value: {
        outputs: [
          {
            outputPort,
            payload: {
              synthetic: true,
              taskType: request.task.type,
              capability: request.task.capability,
              inputPorts: Object.keys(request.inputs).sort(),
              dryRun: true,
            },
          },
        ],
      },
    };
  }
}

export class FakeExecutionTaskHandler extends DeterministicExecutionTaskHandler {}

export class FailingExecutionTaskHandler implements ExecutionTaskHandlerPort {
  constructor(private readonly options: { transient?: boolean; taskType?: TaskType } = {}) {}

  canHandle(_capability: ExecutionCapability, taskType: TaskType): boolean {
    return !this.options.taskType || this.options.taskType === taskType;
  }

  async execute(): Promise<ExecutionTaskHandlerResult> {
    const transient = this.options.transient ?? true;
    return {
      ok: false,
      error: {
        code: transient ? "DETERMINISTIC_TRANSIENT_FAILURE" : "DETERMINISTIC_PERMANENT_FAILURE",
        message: transient ? "Falha transitória determinística." : "Falha permanente determinística.",
        category: transient ? "provider_unavailable" : "internal",
        retryable: transient,
      },
    };
  }
}
