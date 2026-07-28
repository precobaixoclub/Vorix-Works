import type { SkillCapability } from "../../domain/skills/skill-capability.contract.js";
import type { SkillResponse } from "../../domain/skills/skill.contract.js";
import type { ZunoEventName, ZunoEventRecorderPort } from "../events/zuno-event.contract.js";
import type { ExecutionPlan, ExecutionPlanStep } from "../orchestration/execution-plan.contract.js";
import { DEFAULT_ZUNO_RUNTIME_MODE } from "../runtime/zuno-runtime-mode.js";
import type { HelenaSkillManagerPort } from "../skills/helena.contract.js";
import type { ValentinaTenantPort } from "../tenancy/valentina-tenant.port.js";
import type { CaioWorkflowExecutorPort } from "./caio.contract.js";
import type { CaioLogAction, CaioLoggerPort } from "./caio-log.contract.js";
import type {
  WorkflowArtifactSummary,
  WorkflowExecutionReport,
  WorkflowExecutionRequest,
  WorkflowExecutionState,
  WorkflowHumanApprovalInput,
  WorkflowStepExecutionReport,
  WorkflowStepState,
} from "./caio.types.js";

export type CaioIdGenerator = {
  create(prefix: string): string;
};

export type CaioWorkflowExecutorDependencies = {
  helena: HelenaSkillManagerPort;
  tenants?: ValentinaTenantPort;
  logger?: CaioLoggerPort;
  eventRecorder?: ZunoEventRecorderPort;
  idGenerator?: CaioIdGenerator;
  now?: () => Date;
};

class SequentialCaioIdGenerator implements CaioIdGenerator {
  private nextNumber = 1;

  create(prefix: string): string {
    const id = `${prefix}-${String(this.nextNumber).padStart(4, "0")}`;
    this.nextNumber += 1;
    return id;
  }
}

class NoopCaioLogger implements CaioLoggerPort {
  async record(): Promise<void> {
    return undefined;
  }
}

class NoopZunoEventRecorder implements ZunoEventRecorderPort {
  async record(): Promise<void> {
    return undefined;
  }
}

export class CaioWorkflowExecutor implements CaioWorkflowExecutorPort {
  private readonly helena: HelenaSkillManagerPort;
  private readonly tenants?: ValentinaTenantPort;
  private readonly logger: CaioLoggerPort;
  private readonly eventRecorder: ZunoEventRecorderPort;
  private readonly idGenerator: CaioIdGenerator;
  private readonly now: () => Date;
  private readonly executions = new Map<string, WorkflowExecutionReport>();

  constructor(dependencies: CaioWorkflowExecutorDependencies) {
    this.helena = dependencies.helena;
    this.tenants = dependencies.tenants;
    this.logger = dependencies.logger ?? new NoopCaioLogger();
    this.eventRecorder = dependencies.eventRecorder ?? new NoopZunoEventRecorder();
    this.idGenerator = dependencies.idGenerator ?? new SequentialCaioIdGenerator();
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: WorkflowExecutionRequest): Promise<WorkflowExecutionReport> {
    this.validatePlan(request.plan);
    const tenantContext = await this.resolveTenantContext(request);

    const executionId = this.idGenerator.create("workflow-execution");
    const startedAt = this.timestamp();
    const steps = this.createInitialStepReports(request.plan);
    const report: WorkflowExecutionReport = {
      executionId,
      planId: request.plan.id,
      clientId: tenantContext.clientId,
      tenantId: tenantContext.tenantId,
      state: "CREATED",
      startedAt,
      message: "Workflow criado e pronto para execução.",
      steps,
      artifactSummary: emptyArtifactSummary(),
      planSnapshot: request.plan,
      locale: request.locale ?? "pt-BR",
      dryRun: request.dryRun ?? true,
      mode: request.mode ?? DEFAULT_ZUNO_RUNTIME_MODE,
      correlationId: request.correlationId ?? executionId,
    };
    this.executions.set(executionId, report);

    const missingCapabilities = await this.findMissingCapabilities(request.plan);
    if (missingCapabilities.length > 0) {
      const message = `Workflow não pode ser executado: nenhuma Skill pronta para a(s) capability(ies) ${missingCapabilities.join(", ")}.`;
      report.state = "FAILED";
      report.finishedAt = this.timestamp();
      report.message = message;
      await this.log("WorkflowFailed", report, message, undefined, { missingCapabilities });
      await this.emit("ExecutionFinished", report, { state: report.state, missingCapabilities });
      return report;
    }

    await this.setWorkflowState(report, "RUNNING", "Workflow iniciado.", "WorkflowStarted");
    await this.emit("ExecutionStarted", report, { planId: request.plan.id });

    return this.runSteps(report);
  }

  /**
   * Verifica, antes de rodar qualquer etapa, se toda capability exigida pelo plano tem Skill
   * pronta em Helena — falhar aqui, de uma vez, evita gastar chamadas reais de Ícaro em etapas
   * anteriores só para descobrir no meio do caminho que uma etapa posterior nunca poderia rodar.
   */
  private async findMissingCapabilities(plan: ExecutionPlan): Promise<SkillCapability[]> {
    const requiredCapabilities = new Set<SkillCapability>();
    for (const step of plan.steps) {
      if (step.type === "skill" && step.skillCapability) requiredCapabilities.add(step.skillCapability);
    }

    const missing: SkillCapability[] = [];
    for (const capability of requiredCapabilities) {
      const record = await this.helena.findSkillByCapability(capability);
      if (!record) missing.push(capability);
    }
    return missing;
  }

  async resume(executionId: string, approval: WorkflowHumanApprovalInput): Promise<WorkflowExecutionReport> {
    const report = this.executions.get(executionId);
    if (!report) {
      throw new Error(`Execução não encontrada: ${executionId}.`);
    }

    if (["COMPLETED", "FAILED", "CANCELLED"].includes(report.state)) {
      return report;
    }

    if (report.state !== "WAITING_HUMAN_APPROVAL" || !report.waitingForStepId) {
      throw new Error(`Workflow ${executionId} não está aguardando aprovação humana.`);
    }

    const stepReport = this.requireStepReport(report, report.waitingForStepId);

    if (!approval.confirmed) {
      return this.failWorkflow(report, stepReport, "HUMAN_APPROVAL_REJECTED", "Aprovação humana foi negada.", false);
    }

    this.setStepState(stepReport, "COMPLETED");
    // A decisão humana vira o "output" desta etapa, resolvível pelos mesmos inputBindings
    // genéricos usados para saída de Skill (ex.: a etapa de publicação lê `humanApproval` daqui).
    stepReport.response = {
      skillId: "human-approval",
      taskId: stepReport.stepId,
      status: "completed",
      output: approval,
      artifacts: [],
      warnings: [],
    };
    await this.finishStep(report, stepReport);

    report.waitingForStepId = undefined;
    report.state = "RUNNING";
    report.message = `Workflow retomado após aprovação humana da etapa "${stepReport.name}".`;
    await this.log("WorkflowResumed", report, report.message, stepReport.stepId, {
      approvedBy: approval.approvedBy,
      approvedAt: approval.approvedAt,
    });
    await this.emit("WorkflowResumed", report, { stepId: stepReport.stepId, approvedBy: approval.approvedBy });

    return this.runSteps(report);
  }

  async resumeAssistedGeneration(executionId: string): Promise<WorkflowExecutionReport> {
    const report = this.executions.get(executionId);
    if (!report) {
      throw new Error(`Execução não encontrada: ${executionId}.`);
    }

    if (["COMPLETED", "FAILED", "CANCELLED"].includes(report.state)) {
      return report;
    }

    if (report.state !== "WAITING_ASSISTED_GENERATION" || !report.waitingForStepId) {
      throw new Error(`Workflow ${executionId} não está aguardando geração assistida.`);
    }

    const stepReport = this.requireStepReport(report, report.waitingForStepId);

    // Não há decisão a aplicar aqui (diferente de `resume`) — apenas volta a etapa para PENDING
    // para que `runSteps` a execute de novo. A própria Skill (ex.: Pedro) é responsável por
    // verificar se o artefato esperado já existe e decidir se completa ou pausa novamente.
    this.setStepState(stepReport, "PENDING");
    stepReport.waitingReason = undefined;
    report.waitingForStepId = undefined;
    report.state = "RUNNING";
    report.message = `Workflow retomado para nova verificação da etapa "${stepReport.name}" (geração assistida).`;
    await this.log("WorkflowResumed", report, report.message, stepReport.stepId);
    await this.emit("WorkflowResumed", report, { stepId: stepReport.stepId, reason: "assisted_generation" });

    return this.runSteps(report);
  }

  async resumeDeveloperAI(executionId: string): Promise<WorkflowExecutionReport> {
    const report = this.executions.get(executionId);
    if (!report) {
      throw new Error(`Execução não encontrada: ${executionId}.`);
    }

    if (["COMPLETED", "FAILED", "CANCELLED"].includes(report.state)) {
      return report;
    }

    if (report.state !== "WAITING_DEVELOPER_AI" || !report.waitingForStepId) {
      throw new Error(`Workflow ${executionId} não está aguardando IA desenvolvedora.`);
    }

    const stepReport = this.requireStepReport(report, report.waitingForStepId);

    // Mesmo raciocínio de `resumeAssistedGeneration`: não há decisão a aplicar aqui, apenas volta
    // a etapa para PENDING para que `runSteps` a execute de novo. A própria Skill é responsável
    // por verificar se a resposta esperada da IA desenvolvedora já existe em disco e decidir se
    // completa ou pausa novamente.
    this.setStepState(stepReport, "PENDING");
    stepReport.waitingReason = undefined;
    report.waitingForStepId = undefined;
    report.state = "RUNNING";
    report.message = `Workflow retomado para nova verificação da etapa "${stepReport.name}" (IA desenvolvedora).`;
    await this.log("WorkflowResumed", report, report.message, stepReport.stepId);
    await this.emit("WorkflowResumed", report, { stepId: stepReport.stepId, reason: "developer_ai" });

    return this.runSteps(report);
  }

  getExecution(executionId: string): WorkflowExecutionReport | undefined {
    return this.executions.get(executionId);
  }

  hydrateExecution(report: WorkflowExecutionReport): void {
    report.mode = report.mode ?? DEFAULT_ZUNO_RUNTIME_MODE;
    report.artifactSummary = {
      ...emptyArtifactSummary(),
      ...(report.artifactSummary ?? {}),
    };
    this.executions.set(report.executionId, report);
  }

  applyLocalMusicAsset(executionId: string, musicTrackPath: string): { applied: boolean; reason?: string } {
    const report = this.executions.get(executionId);
    if (!report) {
      throw new Error(`Execução não encontrada: ${executionId}.`);
    }

    const stepReport = report.steps.find((step) => step.skillCapability === "video_rendering");
    if (!stepReport) {
      return { applied: false, reason: "Este workflow não possui uma etapa de renderização de vídeo." };
    }
    if (stepReport.state === "COMPLETED") {
      return { applied: false, reason: "A etapa de renderização de vídeo já foi concluída nesta execução; a música informada não pôde ser aplicada retroativamente." };
    }

    const planStep = report.planSnapshot.steps.find((step) => step.id === stepReport.stepId);
    if (!planStep) {
      return { applied: false, reason: "Etapa de renderização de vídeo não encontrada no plano." };
    }

    const existingLocalAssets = planStep.input.localAssets && typeof planStep.input.localAssets === "object"
      ? (planStep.input.localAssets as Record<string, unknown>)
      : {};
    planStep.input = {
      ...planStep.input,
      localAssets: { ...existingLocalAssets, musicTrackPath },
    };

    return { applied: true };
  }

  private async runSteps(report: WorkflowExecutionReport): Promise<WorkflowExecutionReport> {
    const orderedSteps = [...report.planSnapshot.steps].sort((left, right) => left.order - right.order);
    for (const step of orderedSteps) {
      const stepReport = this.requireStepReport(report, step.id);
      if (stepReport.state !== "PENDING") continue;

      if (!this.dependenciesCompleted(step, report)) {
        this.setStepState(stepReport, "SKIPPED", "Dependência anterior não foi concluída.");
        continue;
      }

      if (step.type === "human_gate") {
        await this.startStep(report, stepReport);
        this.setStepState(stepReport, "WAITING", "Etapa humana aguardando aprovação.");
        report.state = "WAITING_HUMAN_APPROVAL";
        report.waitingForStepId = step.id;
        report.message = `Workflow pausado aguardando aprovação humana na etapa "${step.name}".`;
        await this.log("StepWaitingHumanApproval", report, `Etapa ${step.name} aguardando aprovação humana.`, step.id);
        await this.emit("WorkflowPaused", report, { stepId: step.id, reason: "human_gate" });
        return report;
      }

      if (step.type === "system") {
        await this.startStep(report, stepReport);
        this.setStepState(stepReport, "COMPLETED");
        await this.finishStep(report, stepReport);
        continue;
      }

      if (step.type === "skill") {
        const skillFailure = await this.executeSkillStep(report, step, stepReport);
        if (skillFailure) return skillFailure;
        continue;
      }

      const failed = await this.failWorkflow(report, stepReport, "STEP_TYPE_UNSUPPORTED", `Tipo de etapa não suportado: ${step.type}.`);
      return failed;
    }

    report.state = "COMPLETED";
    report.finishedAt = this.timestamp();
    report.message = "Workflow concluído com sucesso.";
    await this.log("WorkflowCompleted", report, "Workflow concluído com sucesso.");
    await this.emit("ExecutionFinished", report, { state: report.state });
    return report;
  }

  async cancel(executionId: string, reason = "Workflow cancelado manualmente."): Promise<WorkflowExecutionReport> {
    const report = this.executions.get(executionId);
    if (!report) {
      throw new Error(`Execução não encontrada: ${executionId}`);
    }

    if (["COMPLETED", "FAILED", "CANCELLED"].includes(report.state)) {
      return report;
    }

    report.state = "CANCELLED";
    report.finishedAt = this.timestamp();
    report.message = reason;
    for (const step of report.steps) {
      if (step.state === "PENDING") {
        step.state = "SKIPPED";
      }
      if (step.state === "RUNNING" || step.state === "WAITING") {
        step.state = "SKIPPED";
        step.finishedAt = this.timestamp();
      }
    }
    await this.log("WorkflowCancelled", report, reason);
    await this.emit("ExecutionCancelled", report, { reason });
    return report;
  }

  private async executeSkillStep(
    report: WorkflowExecutionReport,
    step: ExecutionPlanStep,
    stepReport: WorkflowStepExecutionReport,
  ): Promise<WorkflowExecutionReport | undefined> {
    if (!step.skillCapability) {
      return this.failWorkflow(report, stepReport, "MISSING_SKILL_CAPABILITY", `Etapa ${step.name} exige Skill, mas não possui skillCapability.`);
    }

    await this.startStep(report, stepReport);
    await this.emit("SkillStarted", report, { stepId: step.id, capability: step.skillCapability });

    try {
      const resolvedInput = withUpstreamSkillsReport(resolveStepInput(step, report), report);
      const result = await this.helena.executeSkill({
        requestedBy: "caio",
        capability: step.skillCapability,
        input: resolvedInput,
        context: {
          executionId: report.executionId,
          taskId: step.id,
          correlationId: report.correlationId,
          locale: report.locale,
          clientId: report.clientId,
          tenantId: report.tenantId,
          dryRun: report.dryRun,
          metadata: {
            planId: report.planId,
            stepName: step.name,
            expectedOutput: step.expectedOutput,
            runtimeMode: report.mode,
          },
        },
      });

      stepReport.skillId = result.skillId;
      stepReport.response = result.response as SkillResponse;
      stepReport.artifactSummary = extractArtifactSummary(result.response as SkillResponse);
      report.artifactSummary = mergeArtifactSummaries(report.artifactSummary, stepReport.artifactSummary);

      if (result.response.status === "needs_assisted_generation") {
        this.setStepState(stepReport, "WAITING", "Aguardando artefato de geração assistida.");
        report.state = "WAITING_ASSISTED_GENERATION";
        report.waitingForStepId = step.id;
        report.message = `Workflow pausado aguardando geração assistida na etapa "${step.name}".`;
        await this.log("StepWaitingAssistedGeneration", report, `Etapa ${step.name} aguardando geração assistida.`, step.id);
        await this.emit("WorkflowPaused", report, { stepId: step.id, reason: "assisted_generation" });
        return report;
      }

      if (result.response.status === "needs_developer_ai") {
        this.setStepState(stepReport, "WAITING", "Aguardando resposta da IA desenvolvedora.");
        report.state = "WAITING_DEVELOPER_AI";
        report.waitingForStepId = step.id;
        report.message = `Workflow pausado aguardando IA desenvolvedora na etapa "${step.name}".`;
        await this.log("StepWaitingDeveloperAI", report, `Etapa ${step.name} aguardando IA desenvolvedora.`, step.id);
        await this.emit("WorkflowPaused", report, { stepId: step.id, reason: "developer_ai" });
        return report;
      }

      if (result.response.status !== "completed" || result.state === "FAILED") {
        await this.emit("SkillFailed", report, { stepId: step.id, skillId: result.skillId, responseStatus: result.response.status });
        return this.failWorkflow(
          report,
          stepReport,
          result.response.error?.code ?? "SKILL_FAILED",
          result.response.error?.message ?? `Skill ${result.skillId} falhou.`,
          result.response.error?.recoverable ?? true,
        );
      }

      this.setStepState(stepReport, "COMPLETED");
      await this.emit("SkillFinished", report, { stepId: step.id, skillId: result.skillId, responseStatus: result.response.status });
      await this.finishStep(report, stepReport);
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro desconhecido ao executar Skill.";
      await this.emit("SkillFailed", report, { stepId: step.id, capability: step.skillCapability, error: message });
      return this.failWorkflow(report, stepReport, "HELENA_EXECUTION_FAILED", message, true);
    }
  }

  private validatePlan(plan: ExecutionPlan): void {
    if (plan.createdBy !== "arthur") {
      throw new Error("Caio só executa planos criados pelo Arthur.");
    }
    if (!plan.id) {
      throw new Error("ExecutionPlan precisa possuir id.");
    }
    if (!Array.isArray(plan.steps)) {
      throw new Error("ExecutionPlan precisa possuir lista de etapas.");
    }
    if (!plan.tenant?.clientId?.trim()) {
      throw new Error("ExecutionPlan precisa possuir clientId resolvido pela Valentina.");
    }

    const stepIds = new Set<string>();
    const orders = new Set<number>();
    for (const step of plan.steps) {
      if (!step.id) throw new Error("Todas as etapas precisam possuir id.");
      if (stepIds.has(step.id)) throw new Error(`Etapa duplicada no plano: ${step.id}.`);
      stepIds.add(step.id);
      if (orders.has(step.order)) throw new Error(`Ordem duplicada no plano: ${step.order}.`);
      orders.add(step.order);
      for (const dependency of step.dependsOn) {
        if (!stepIds.has(dependency) && !plan.steps.some((candidate) => candidate.id === dependency)) {
          throw new Error(`Etapa ${step.id} depende de etapa inexistente: ${dependency}.`);
        }
      }
      for (const binding of step.inputBindings ?? []) {
        if (!stepIds.has(binding.fromStepId) && !plan.steps.some((candidate) => candidate.id === binding.fromStepId)) {
          throw new Error(`Etapa ${step.id} possui inputBinding apontando para etapa inexistente: ${binding.fromStepId}.`);
        }
      }
    }
  }

  private async resolveTenantContext(request: WorkflowExecutionRequest): Promise<{ clientId: string; tenantId?: string }> {
    const tenantId = request.tenantId ?? request.plan.tenant.tenantId;
    const clientId = request.clientId ?? request.plan.tenant.clientId;

    if (this.tenants && tenantId) {
      const context = await this.tenants.getClientContext(tenantId);
      return {
        clientId: context.clientId,
        tenantId: context.tenantId,
      };
    }

    if (!clientId?.trim()) {
      throw new Error("Caio precisa receber um clientId antes de iniciar o workflow.");
    }

    return { clientId, tenantId };
  }

  private createInitialStepReports(plan: ExecutionPlan): WorkflowStepExecutionReport[] {
    return [...plan.steps]
      .sort((left, right) => left.order - right.order)
      .map((step) => ({
        stepId: step.id,
        order: step.order,
        name: step.name,
        type: step.type,
        skillCapability: step.skillCapability,
        state: "PENDING",
      }));
  }

  private dependenciesCompleted(step: ExecutionPlanStep, report: WorkflowExecutionReport): boolean {
    return step.dependsOn.every((dependencyId) => {
      const dependency = report.steps.find((candidate) => candidate.stepId === dependencyId);
      return dependency?.state === "COMPLETED";
    });
  }

  private requireStepReport(report: WorkflowExecutionReport, stepId: string): WorkflowStepExecutionReport {
    const stepReport = report.steps.find((step) => step.stepId === stepId);
    if (!stepReport) {
      throw new Error(`Step report não encontrado para ${stepId}.`);
    }
    return stepReport;
  }

  private async startStep(report: WorkflowExecutionReport, stepReport: WorkflowStepExecutionReport): Promise<void> {
    this.setStepState(stepReport, "RUNNING");
    stepReport.startedAt = this.timestamp();
    await this.log("StepStarted", report, `Etapa ${stepReport.name} iniciada.`, stepReport.stepId);
    await this.emit("StepStarted", report, { stepId: stepReport.stepId, stepName: stepReport.name });
  }

  private async finishStep(report: WorkflowExecutionReport, stepReport: WorkflowStepExecutionReport): Promise<void> {
    stepReport.finishedAt = this.timestamp();
    await this.log("StepCompleted", report, `Etapa ${stepReport.name} concluída.`, stepReport.stepId);
    await this.emit("StepFinished", report, { stepId: stepReport.stepId, stepName: stepReport.name });
  }

  private async failWorkflow(
    report: WorkflowExecutionReport,
    stepReport: WorkflowStepExecutionReport,
    code: string,
    message: string,
    recoverable = true,
  ): Promise<WorkflowExecutionReport> {
    this.setStepState(stepReport, "FAILED");
    stepReport.finishedAt = this.timestamp();
    stepReport.error = { code, message, recoverable };
    report.state = "FAILED";
    report.finishedAt = this.timestamp();
    report.message = `Workflow falhou na etapa "${stepReport.name}": ${message}`;
    await this.log("StepFailed", report, report.message, stepReport.stepId, { code, recoverable });
    await this.log("WorkflowFailed", report, "Workflow falhou e foi interrompido.", undefined, { failedStepId: stepReport.stepId });
    await this.emit("StepFailed", report, { stepId: stepReport.stepId, code, message, recoverable });
    await this.emit("ExecutionFinished", report, { state: report.state, failedStepId: stepReport.stepId });
    return report;
  }

  private async setWorkflowState(
    report: WorkflowExecutionReport,
    state: WorkflowExecutionState,
    message: string,
    logAction: CaioLogAction,
  ): Promise<void> {
    report.state = state;
    report.message = message;
    await this.log(logAction, report, message);
  }

  private setStepState(stepReport: WorkflowStepExecutionReport, state: WorkflowStepState, waitingReason?: string): void {
    stepReport.state = state;
    if (waitingReason) stepReport.waitingReason = waitingReason;
  }

  private async log(
    action: CaioLogAction,
    report: WorkflowExecutionReport,
    message: string,
    stepId?: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.logger.record({
      id: this.idGenerator.create("caio-log"),
      occurredAt: this.timestamp(),
      action,
      message,
      executionId: report.executionId,
      planId: report.planId,
      stepId,
      metadata,
    });
  }

  private async emit(name: ZunoEventName, report: WorkflowExecutionReport, payload: Record<string, unknown> = {}): Promise<void> {
    await this.eventRecorder.record({
      id: this.idGenerator.create("event"),
      name,
      occurredAt: this.timestamp(),
      executionId: report.executionId,
      taskId: typeof payload.stepId === "string" ? payload.stepId : undefined,
      skillId: typeof payload.skillId === "string" ? payload.skillId : undefined,
      payload: {
        planId: report.planId,
        clientId: report.clientId,
        tenantId: report.tenantId,
        source: "caio",
        ...payload,
      },
    });
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function emptyArtifactSummary(): WorkflowArtifactSummary {
  return {
    htmlPaths: [],
    imagePaths: [],
    videoPaths: [],
    captionPaths: [],
    publicationPaths: [],
    metadataPaths: [],
    zipPaths: [],
    hashtagsPaths: [],
    reportPaths: [],
  };
}

function mergeArtifactSummaries(
  current: WorkflowArtifactSummary,
  next: WorkflowArtifactSummary,
): WorkflowArtifactSummary {
  return {
    htmlPaths: unique([...(current.htmlPaths ?? []), ...(next.htmlPaths ?? [])]),
    imagePaths: unique([...(current.imagePaths ?? []), ...(next.imagePaths ?? [])]),
    videoPaths: unique([...(current.videoPaths ?? []), ...(next.videoPaths ?? [])]),
    captionPaths: unique([...(current.captionPaths ?? []), ...(next.captionPaths ?? [])]),
    publicationPaths: unique([...(current.publicationPaths ?? []), ...(next.publicationPaths ?? [])]),
    metadataPaths: unique([...(current.metadataPaths ?? []), ...(next.metadataPaths ?? [])]),
    zipPaths: unique([...(current.zipPaths ?? []), ...(next.zipPaths ?? [])]),
    hashtagsPaths: unique([...(current.hashtagsPaths ?? []), ...(next.hashtagsPaths ?? [])]),
    reportPaths: unique([...(current.reportPaths ?? []), ...(next.reportPaths ?? [])]),
  };
}

function extractArtifactSummary(response: SkillResponse): WorkflowArtifactSummary {
  const summary = emptyArtifactSummary();
  const output = valueAsRecord(response.output);
  const delivery = valueAsRecord(output?.delivery);
  const video = valueAsRecord(output?.video);

  pushString(summary.htmlPaths, delivery?.htmlPath);
  pushStringArray(summary.imagePaths, delivery?.imagePaths);
  pushStringArray(summary.videoPaths, delivery?.videoPaths);
  pushString(summary.videoPaths, delivery?.videoPath);
  pushString(summary.videoPaths, video?.localPath);
  pushString(summary.captionPaths, delivery?.captionPath);
  pushString(summary.publicationPaths, delivery?.publicationPath);
  pushString(summary.hashtagsPaths, delivery?.hashtagsPath);
  pushString(summary.metadataPaths, delivery?.metadataPath);
  pushString(summary.reportPaths, delivery?.executionReportPath);
  pushString(summary.zipPaths, delivery?.zipPath);

  for (const artifact of response.artifacts ?? []) {
    pushArtifactFile(summary, artifact);
  }

  return {
    htmlPaths: unique(summary.htmlPaths),
    imagePaths: unique(summary.imagePaths),
    videoPaths: unique(summary.videoPaths),
    captionPaths: unique(summary.captionPaths),
    publicationPaths: unique(summary.publicationPaths),
    metadataPaths: unique(summary.metadataPaths),
    zipPaths: unique(summary.zipPaths),
    hashtagsPaths: unique(summary.hashtagsPaths),
    reportPaths: unique(summary.reportPaths),
  };
}

function pushArtifactFile(summary: WorkflowArtifactSummary, artifact: SkillResponse["artifacts"][number]): void {
  const mimeType = artifact.file?.mimeType?.toLowerCase() ?? "";
  if (artifact.type === "video" || mimeType.startsWith("video/")) {
    pushString(summary.videoPaths, artifact.file?.localPath);
  } else if (artifact.type === "image" || artifact.type === "carousel" || mimeType.startsWith("image/")) {
    pushString(summary.imagePaths, artifact.file?.localPath);
  }

  for (const item of artifact.items ?? []) {
    pushArtifactFile(summary, item);
  }
}

/**
 * Resolve a entrada real de uma etapa combinando o input genérico que Arthur já monta
 * (clientId, tenantId, objective, channels, audience) com os `inputBindings` declarados no
 * plano, lendo apenas a saída (`response.output`) de etapas já concluídas. Nunca importa nem
 * conhece nenhum tipo de Skill — opera inteiramente por nome de campo em texto (ADR 0002).
 */
export function resolveStepInput(step: ExecutionPlanStep, report: WorkflowExecutionReport): Record<string, unknown> {
  let resolved: Record<string, unknown> = { ...step.input };

  for (const binding of step.inputBindings ?? []) {
    const sourceStep = report.steps.find((candidate) => candidate.stepId === binding.fromStepId);
    if (!sourceStep || sourceStep.state !== "COMPLETED" || !sourceStep.response) continue;

    const sourceValue = binding.sourcePath ? getByPath(sourceStep.response.output, binding.sourcePath) : sourceStep.response.output;
    if (sourceValue === undefined) continue;

    const value = binding.pick ? applyPick(sourceValue, binding.pick) : sourceValue;

    if (binding.targetField === null) {
      if (isRecord(value)) resolved = { ...value };
      continue;
    }

    setByPath(resolved, binding.targetField, value);
  }

  return resolved;
}

/**
 * Injeta metadados genéricos do workflow em `workflowContext`, disponíveis para qualquer Skill
 * sem que Caio nem a Skill precisem conhecer o formato de saída umas das outras:
 * - `upstreamSkillsReport`: resumo das Skills já concluídas (hoje usado pelo Pedro para montar a
 *   seção "Relatório das Skills utilizadas" no HTML de entrega);
 * - `publishingEnabled`: verdadeiro quando o plano inclui uma etapa de publicação social (hoje
 *   usado pelo Pedro para decidir se mostra o comando de "Publicar" no HTML de entrega).
 */
export function withUpstreamSkillsReport(input: Record<string, unknown>, report: WorkflowExecutionReport): Record<string, unknown> {
  const upstreamSkillsReport = report.steps
    .filter((candidate) => candidate.state === "COMPLETED" && candidate.skillId)
    .map((candidate) => ({ skillId: candidate.skillId, name: candidate.name, state: candidate.state }));
  const publishingEnabled = report.planSnapshot.steps.some((step) => step.skillCapability === "social_publishing");

  const workflowContext = isRecord(input.workflowContext) ? input.workflowContext : {};

  return {
    ...input,
    workflowContext: {
      ...workflowContext,
      upstreamSkillsReport,
      publishingEnabled,
      runtimeMode: report.mode,
      localProduction: report.mode === "LOCAL_PRODUCTION",
    },
  };
}

function getByPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((accumulator, key) => {
    if (!isRecord(accumulator)) return undefined;
    return accumulator[key];
  }, source);
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!isRecord(cursor[key])) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

function applyPick(value: unknown, pick: string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => pickFields(item, pick));
  return pickFields(value, pick);
}

function pickFields(value: unknown, pick: string[]): unknown {
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of pick) {
    if (key in value) result[key] = value[key];
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAsRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function pushString(target: string[], value: unknown): void {
  if (typeof value === "string" && value.trim()) target.push(value);
}

function pushStringArray(target: string[], value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    pushString(target, item);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
