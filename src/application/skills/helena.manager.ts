import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { SkillResponse } from "../../domain/skills/skill.contract.js";
import type { SkillState } from "../../domain/skills/skill-state.contract.js";
import type { ZunoEventRecorderPort } from "../events/zuno-event.contract.js";
import type { HelenaSkillManagerPort } from "./helena.contract.js";
import type { HelenaLoggerPort } from "./helena-log.contract.js";
import type { SkillDiscoveryPort, SkillManifestValidatorPort, SkillModuleLoaderPort, SkillRegistryPort } from "./helena.ports.js";
import type { HelenaSkillExecutionRequest, HelenaSkillExecutionResult, RegisteredSkillRecord } from "./helena.types.js";

export type HelenaIdGenerator = {
  create(prefix: string): string;
};

export type HelenaSkillManagerDependencies = {
  discovery: SkillDiscoveryPort;
  loader: SkillModuleLoaderPort;
  validator: SkillManifestValidatorPort;
  registry: SkillRegistryPort;
  logger?: HelenaLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: HelenaIdGenerator;
  now?: () => Date;
  zunoVersion?: string;
};

class SequentialHelenaIdGenerator implements HelenaIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopHelenaLogger implements HelenaLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopZunoEventRecorder implements ZunoEventRecorderPort {
  async record(): Promise<void> {
    return undefined;
  }
}

export class HelenaSkillManager implements HelenaSkillManagerPort {
  private readonly discovery: SkillDiscoveryPort;
  private readonly loader: SkillModuleLoaderPort;
  private readonly validator: SkillManifestValidatorPort;
  private readonly registry: SkillRegistryPort;
  private readonly logger: HelenaLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: HelenaIdGenerator;
  private readonly now: () => Date;
  private readonly zunoVersion: string;

  constructor(dependencies: HelenaSkillManagerDependencies) {
    this.discovery = dependencies.discovery;
    this.loader = dependencies.loader;
    this.validator = dependencies.validator;
    this.registry = dependencies.registry;
    this.logger = dependencies.logger ?? new NoopHelenaLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopZunoEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialHelenaIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
    this.zunoVersion = dependencies.zunoVersion ?? "0.1.0";
  }

  async discoverAndLoadSkills(): Promise<RegisteredSkillRecord[]> {
    const sources = await this.discovery.discover();

    for (const source of sources) {
      this.registry.registerDiscovered(source, this.timestamp());
      await this.log("SkillDiscovered", `Skill descoberta em ${source.location}.`, { sourceId: source.sourceId });

      const validation = this.validator.validate(source.manifest);
      if (!validation.valid) {
        this.transition(source.sourceId, "FAILED", { validationErrors: validation.errors });
        await this.log("ManifestInvalid", "Manifesto inválido. Skill não será carregada.", {
          sourceId: source.sourceId,
          errors: validation.errors,
        });
        continue;
      }

      this.registry.attachManifest(source.sourceId, validation.manifest, this.timestamp());

      if (!validation.manifest.enabled) {
        this.transition(source.sourceId, "DISABLED", { disabledReason: "Manifesto marcado como disabled." });
        await this.log("SkillIgnored", `Skill ${validation.manifest.id} ignorada porque está desabilitada.`, {
          skillId: validation.manifest.id,
        });
        continue;
      }

      if (!this.isCompatible(validation.manifest.compatibility.zuno)) {
        this.transition(source.sourceId, "FAILED", {
          validationErrors: [`Skill exige compatibilidade ${validation.manifest.compatibility.zuno}, mas o Zuno atual é ${this.zunoVersion}.`],
        });
        await this.log("SkillIgnored", `Skill ${validation.manifest.id} ignorada por incompatibilidade de versão.`, {
          skillId: validation.manifest.id,
          required: validation.manifest.compatibility.zuno,
          current: this.zunoVersion,
        });
        continue;
      }

      try {
        const skill = await this.loader.load(source);
        if (skill.manifest.id !== validation.manifest.id) {
          throw new Error(`Skill carregada declarou id ${skill.manifest.id}, esperado ${validation.manifest.id}.`);
        }

        this.registry.attachSkill(source.sourceId, skill, this.timestamp());
        this.transition(source.sourceId, "LOADED");
        this.transition(source.sourceId, "READY");
        await this.log("SkillLoaded", `Skill ${validation.manifest.id} carregada e pronta.`, {
          skillId: validation.manifest.id,
          capabilities: validation.manifest.capabilities,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido ao carregar Skill.";
        this.transition(source.sourceId, "FAILED", { validationErrors: [message] });
        await this.log("ExecutionFailed", `Falha ao carregar Skill ${validation.manifest.id}.`, {
          skillId: validation.manifest.id,
          error: message,
        });
      }
    }

    return this.registry.list();
  }

  async findSkillByCapability(capability: SkillCapability): Promise<RegisteredSkillRecord | undefined> {
    const record = this.registry.findByCapability(capability);
    if (record?.manifest) {
      await this.log("CapabilityFound", `Capability ${capability} encontrada na Skill ${record.manifest.id}.`, {
        skillId: record.manifest.id,
        capability,
      });
      return record;
    }

    await this.log("CapabilityMissing", `Nenhuma Skill pronta encontrada para a capability ${capability}.`, { capability });
    return undefined;
  }

  async executeSkill<TInput = unknown, TOutput = unknown>(
    request: HelenaSkillExecutionRequest<TInput>,
  ): Promise<HelenaSkillExecutionResult<TOutput>> {
    if (!["arthur", "caio"].includes(request.requestedBy)) {
      throw new Error("Helena aceita solicitações de execução apenas do Arthur ou do Caio.");
    }

    const record = await this.findSkillByCapability(request.capability);
    if (!record?.manifest || !record.skill) {
      throw new Error(`Nenhuma Skill pronta para capability ${request.capability}.`);
    }

    const skillId = record.manifest.id;
    await this.log("ExecutionStarted", `Execução iniciada para Skill ${skillId}.`, {
      skillId,
      capability: request.capability,
      executionId: request.context.executionId,
    });
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name: "ExecutionStarted",
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId,
      taskId: request.context.taskId,
    });
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name: "SkillStarted",
      occurredAt: this.timestamp(),
      executionId: request.context.executionId,
      skillId,
      taskId: request.context.taskId,
    });

    this.transition(record.source.sourceId, "RUNNING");

    try {
      const response = await record.skill.execute({
        skillId,
        input: request.input,
        context: {
          ...request.context,
          requestedBy: "helena",
          orchestratedBy: "arthur",
        },
      });

      const finalState = this.mapResponseToState(response);
      this.transition(record.source.sourceId, finalState);

      await this.log(finalState === "FAILED" ? "ExecutionFailed" : "ExecutionCompleted", `Execução finalizada para Skill ${skillId}.`, {
        skillId,
        executionId: request.context.executionId,
        responseStatus: response.status,
      });
      await this.eventRecorder.record({
        id: this.idGenerator.create("event"),
        name: finalState === "FAILED" ? "SkillFailed" : "SkillFinished",
        occurredAt: this.timestamp(),
        executionId: request.context.executionId,
        skillId,
        taskId: request.context.taskId,
        payload: { responseStatus: response.status },
      });
      await this.eventRecorder.record({
        id: this.idGenerator.create("event"),
        name: "ExecutionFinished",
        occurredAt: this.timestamp(),
        executionId: request.context.executionId,
        skillId,
        taskId: request.context.taskId,
        payload: { responseStatus: response.status },
      });

      return { skillId, state: finalState, response: response as SkillResponse<TOutput> };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido na execução da Skill.";
      this.transition(record.source.sourceId, "FAILED", { validationErrors: [message] });
      await this.log("ExecutionFailed", `Erro na execução da Skill ${skillId}.`, {
        skillId,
        executionId: request.context.executionId,
        error: message,
      });
      await this.eventRecorder.record({
        id: this.idGenerator.create("event"),
        name: "SkillFailed",
        occurredAt: this.timestamp(),
        executionId: request.context.executionId,
        skillId,
        taskId: request.context.taskId,
        payload: { error: message },
      });

      return {
        skillId,
        state: "FAILED",
        response: {
          skillId,
          taskId: request.context.taskId,
          status: "failed",
          artifacts: [],
          warnings: [],
          error: {
            code: "SKILL_EXECUTION_FAILED",
            message,
            recoverable: true,
          },
        },
      };
    }
  }

  private mapResponseToState(response: SkillResponse): SkillState {
    if (response.status === "completed") return "COMPLETED";
    if (response.status === "needs_more_context") return "WAITING";
    return "FAILED";
  }

  private transition(sourceId: string, state: SkillState, details: { validationErrors?: string[]; disabledReason?: string } = {}): RegisteredSkillRecord {
    const record = this.registry.updateState(sourceId, state, this.timestamp(), details);
    void this.log("StateChanged", `Estado da Skill alterado para ${state}.`, {
      sourceId,
      skillId: record.manifest?.id,
      state,
    });
    return record;
  }

  private async log(action: Parameters<HelenaLoggerPort["record"]>[0]["action"], message: string, metadata: Record<string, unknown> = {}): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("helena-log"),
      occurredAt: this.timestamp(),
      action,
      message,
      skillId: typeof metadata.skillId === "string" ? metadata.skillId : undefined,
      capability: typeof metadata.capability === "string" ? metadata.capability : undefined,
      executionId: typeof metadata.executionId === "string" ? metadata.executionId : undefined,
      metadata,
    });
  }

  private isCompatible(range: string): boolean {
    if (range === "*" || range === this.zunoVersion) return true;
    if (range.startsWith("^")) {
      const required = parseSemver(range.slice(1));
      const current = parseSemver(this.zunoVersion);
      return current.major === required.major && compareSemver(current, required) >= 0;
    }
    if (range.startsWith(">=")) {
      return compareSemver(parseSemver(this.zunoVersion), parseSemver(range.slice(2))) >= 0;
    }
    return false;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function parseSemver(version: string): { major: number; minor: number; patch: number } {
  const [major = "0", minor = "0", patch = "0"] = version.trim().split(".");
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

function compareSemver(left: { major: number; minor: number; patch: number }, right: { major: number; minor: number; patch: number }): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}
