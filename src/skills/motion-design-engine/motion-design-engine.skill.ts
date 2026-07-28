import type { ZunoEventName, ZunoEventRecorderPort } from "../../application/events/zuno-event.contract.js";
import type { Skill, SkillRequest, SkillResponse } from "../../domain/skills/skill.contract.js";
import { buildMotionPlan } from "../../shared/utils/motion-design/motion-plan-builder.js";
import { MOTION_FORMATS } from "../../shared/utils/motion-design/motion-design.types.js";
import { motionDesignEngineManifest } from "./motion-design.manifest.js";
import type { MotionDesignLogAction, MotionDesignLoggerPort } from "./motion-design-log.contract.js";
import type { MotionDesignEngineRequestInput, MotionDesignEngineOutput } from "./motion-design-engine.types.js";

export type MotionDesignIdGenerator = {
  create(prefix: string): string;
};

export type MotionDesignEngineSkillDependencies = {
  logger?: MotionDesignLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: MotionDesignIdGenerator;
  now?: () => Date;
};

class SequentialMotionDesignIdGenerator implements MotionDesignIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopMotionDesignLogger implements MotionDesignLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopEventRecorder implements ZunoEventRecorderPort {
  async record(): Promise<void> {
    return undefined;
  }
}

/**
 * Motion Design Engine — Skill que transforma imagens já geradas em um Motion Plan. Toda a
 * decisão (preset, timeline, validação, metadados) vive em `buildMotionPlan`
 * (`shared/utils/motion-design/motion-plan-builder.ts`), pura e testável sem infraestrutura; esta
 * classe só aplica o contrato `Skill<Input,Output>` (validação de entrada, log, eventos,
 * artefato). Sem dependência de Clara/Valentina/Ícaro: identidade visual e ritmo chegam
 * diretamente na entrada, como o briefing da sprint pediu.
 */
export class MotionDesignEngineSkill implements Skill<MotionDesignEngineRequestInput, MotionDesignEngineOutput> {
  readonly manifest = motionDesignEngineManifest;

  private readonly logger: MotionDesignLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: MotionDesignIdGenerator;
  private readonly now: () => Date;

  constructor(dependencies: MotionDesignEngineSkillDependencies = {}) {
    this.logger = dependencies.logger ?? new NoopMotionDesignLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialMotionDesignIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: SkillRequest<MotionDesignEngineRequestInput>): Promise<SkillResponse<MotionDesignEngineOutput>> {
    const validationErrors = validateRequestInput(request.input);
    if (validationErrors.length > 0) {
      await this.log("ValidationFailed", "Solicitação de Motion Design inválida.", request, { errors: validationErrors });
      await this.emit("MotionDesignFailed", request, { reason: "INVALID_REQUEST", errors: validationErrors });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: validationErrors,
        error: {
          code: "INVALID_REQUEST",
          message: validationErrors.join("; "),
          recoverable: true,
        },
      };
    }

    try {
      return this.runMotionDesign(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado na Motion Design Engine.";
      await this.log("Error", `Erro inesperado na Motion Design Engine. ${message}`, request, { error: message });
      await this.emit("MotionDesignFailed", request, { reason: "UNEXPECTED_ERROR", error: message });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        artifacts: [],
        warnings: [],
        error: { code: "UNEXPECTED_ERROR", message, recoverable: true },
      };
    }
  }

  private async runMotionDesign(request: SkillRequest<MotionDesignEngineRequestInput>): Promise<SkillResponse<MotionDesignEngineOutput>> {
    await this.log("RequestReceived", "Solicitação de Motion Design recebida.", request, {
      imageCount: request.input.images.length,
      format: request.input.format,
      campaignDurationSeconds: request.input.campaignDurationSeconds,
    });
    await this.emit("MotionDesignStarted", request, {
      imageCount: request.input.images.length,
      format: request.input.format,
    });

    const motionPlan = buildMotionPlan(request.input, {
      idGenerator: () => this.idGenerator.create("motion-plan"),
      now: this.now,
    });

    await this.log("StrategyDecided", `Motion Preset decidido: ${motionPlan.strategy.presetId} (confiança ${motionPlan.strategy.confidence}).`, request, {
      presetId: motionPlan.strategy.presetId,
      confidence: motionPlan.strategy.confidence,
    });
    await this.log("TimelineBuilt", `Motion Timeline construída com ${motionPlan.scenes.length} cena(s).`, request, {
      totalScenes: motionPlan.scenes.length,
      totalDurationSeconds: motionPlan.totalDurationSeconds,
    });
    await this.log(
      "PlanValidated",
      motionPlan.validation.valid ? "Motion Plan validado sem erros." : "Motion Plan validado com erros.",
      request,
      { valid: motionPlan.validation.valid, issueCount: motionPlan.validation.issues.length },
    );

    if (!motionPlan.validation.valid) {
      const errorMessages = motionPlan.validation.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message);
      await this.emit("MotionDesignFailed", request, { reason: "PLAN_INVALID", errors: errorMessages });
      return {
        skillId: this.manifest.id,
        taskId: request.context.taskId,
        status: "failed",
        output: buildOutput(motionPlan),
        artifacts: [],
        warnings: motionPlan.validation.issues.map((issue) => issue.message),
        error: {
          code: "MOTION_PLAN_INVALID",
          message: errorMessages.join("; "),
          recoverable: true,
        },
      };
    }

    await this.log("PlanFinalized", "Motion Plan finalizado.", request, { planId: motionPlan.planId });
    await this.emit("MotionPlanGenerated", request, {
      planId: motionPlan.planId,
      presetId: motionPlan.strategy.presetId,
      totalScenes: motionPlan.scenes.length,
    });

    const output = buildOutput(motionPlan);

    return {
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      status: "completed",
      output,
      artifacts: [
        {
          id: this.idGenerator.create("artifact"),
          type: "plan",
          name: "Motion Plan estruturado",
          metadata: {
            planId: motionPlan.planId,
            presetId: motionPlan.strategy.presetId,
            totalScenes: motionPlan.scenes.length,
            format: motionPlan.format,
          },
        },
      ],
      warnings: motionPlan.validation.issues.map((issue) => issue.message),
    };
  }

  private async log(
    action: MotionDesignLogAction,
    message: string,
    request: SkillRequest<MotionDesignEngineRequestInput>,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("motion-design-log"),
      occurredAt: this.timestamp(),
      action,
      message,
      executionId: request.context.executionId,
      taskId: request.context.taskId,
      clientId: request.input.clientId,
      tenantId: request.input.tenantId,
      metadata,
    });
  }

  private async emit(name: ZunoEventName, request: SkillRequest<MotionDesignEngineRequestInput>, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId: this.manifest.id,
      taskId: request.context.taskId,
      payload: {
        source: "motion-design-engine",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function buildOutput(motionPlan: ReturnType<typeof buildMotionPlan>): MotionDesignEngineOutput {
  return {
    motionPlan,
    summary: {
      presetUsed: motionPlan.strategy.presetId,
      presetConfidence: motionPlan.strategy.confidence,
      totalScenes: motionPlan.scenes.length,
      totalDurationSeconds: motionPlan.totalDurationSeconds,
      valid: motionPlan.validation.valid,
      errorCount: motionPlan.validation.issues.filter((issue) => issue.severity === "error").length,
      warningCount: motionPlan.validation.issues.filter((issue) => issue.severity === "warning").length,
    },
  };
}

function validateRequestInput(input: MotionDesignEngineRequestInput): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== "object") return ["Solicitação de Motion Design é obrigatória."];
  if (!Array.isArray(input.images) || input.images.length === 0) errors.push("images é obrigatório e precisa conter ao menos uma imagem.");
  if (!(typeof input.campaignDurationSeconds === "number" && input.campaignDurationSeconds > 0)) {
    errors.push("campaignDurationSeconds é obrigatório e precisa ser maior que zero.");
  }
  if (!input.format || !(MOTION_FORMATS as readonly string[]).includes(input.format)) {
    errors.push(`format é obrigatório e precisa ser um de: ${MOTION_FORMATS.join(", ")}.`);
  }
  if (!Array.isArray(input.storyboard) || input.storyboard.length === 0) {
    errors.push("storyboard é obrigatório e precisa conter ao menos um beat.");
  }
  return errors;
}

export function createMotionDesignEngineSkill(dependencies: Partial<MotionDesignEngineSkillDependencies> = {}): MotionDesignEngineSkill {
  return new MotionDesignEngineSkill(dependencies);
}
