import type { WorkflowExecutionReport } from "../../workflows/caio.types.js";
import { classifyBlocker } from "./blocker-classifier.js";
import type {
  ActionDefinition,
  AutonomousEngineConfig,
  AutonomousEngineOutcome,
  Blocker,
  Escalation,
  ExecutionHistoryEntry,
} from "./autonomous-types.js";
import { DEFAULT_ENGINE_CONFIG } from "./autonomous-types.js";

/**
 * AUTONOMOUS EXECUTION ENGINE — seção 1 da sprint. Único responsável por interpretar bloqueios,
 * escolher ações corretivas, controlar tentativas, registrar histórico e decidir quando parar.
 * Nenhuma Skill conhece esta classe — ela só enxerga `WorkflowExecutionReport` (o mesmo contrato
 * público que a CLI já usa) e chama `continueExecution` (injetado, normalmente
 * `continueZunoExecution` de `run-command.ts`) para RETOMAR o workflow depois de cada ação — é essa
 * retomada, não uma cópia própria do Production Readiness, que faz o "recalcular automaticamente"
 * da seção 8: Rafa/Lucas já recalculam tudo do zero a cada `--continue`, então o Engine nunca
 * precisa (nem deveria) duplicar essa lógica.
 *
 * ESCOPO — o Engine só age sobre `WAITING_ASSISTED_GENERATION` (ver `blocker-classifier.ts`).
 * `WAITING_DEVELOPER_AI` (refinamento criativo) e `WAITING_HUMAN_APPROVAL` (aprovação final) NUNCA
 * são "resolvidos" por uma ação — são, por design, decisão criativa ou humana. O Engine para ali e
 * devolve o motivo exato, nunca finge ter resolvido algo que não é dele.
 */
export class AutonomousExecutionEngine {
  private readonly registry: ActionDefinition[];
  private readonly config: AutonomousEngineConfig;
  private readonly continueExecution: (executionId: string) => Promise<WorkflowExecutionReport>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(input: {
    registry: ActionDefinition[];
    config?: Partial<AutonomousEngineConfig>;
    continueExecution: (executionId: string) => Promise<WorkflowExecutionReport>;
    /** Injetável só para testes (evita esperas reais de backoff) — em produção usa `setTimeout` de verdade. */
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.registry = input.registry;
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...input.config };
    this.continueExecution = input.continueExecution;
    this.sleep = input.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)));
  }

  async run(initialReport: WorkflowExecutionReport): Promise<AutonomousEngineOutcome> {
    const history: ExecutionHistoryEntry[] = [];
    const escalations: Escalation[] = [];
    let report = initialReport;
    let resolvedBlockers = 0;
    let totalActionsExecuted = 0;
    let totalRecalculations = 0;

    for (let iteration = 0; iteration < this.config.maxTotalIterations; iteration += 1) {
      if (report.state === "COMPLETED" || report.state === "FAILED" || report.state === "CANCELLED") {
        return this.finish(report, resolvedBlockers, escalations, history, totalActionsExecuted, totalRecalculations, "completed");
      }
      if (report.state === "WAITING_HUMAN_APPROVAL") {
        return this.finish(report, resolvedBlockers, escalations, history, totalActionsExecuted, totalRecalculations, "human_approval_required");
      }
      if (report.state === "WAITING_DEVELOPER_AI") {
        // Fora do escopo por design (seção "Skills continuam responsáveis apenas pelas decisões
        // criativas") — o Engine nunca tenta preencher um refinamento criativo sozinho.
        escalations.push({
          blocker: {
            kind: "unknown",
            stepId: report.waitingForStepId ?? "?",
            stepName: report.steps.find((step) => step.stepId === report.waitingForStepId)?.name ?? "?",
            executionState: report.state,
            message: report.message,
            requiresHumanJudgment: true,
            humanJudgmentReason: "Etapa de decisão criativa (IA desenvolvedora) — fora do escopo do Autonomous Execution Engine por design.",
          },
          reason: "subjective_judgment_required",
          message: "WAITING_DEVELOPER_AI é uma decisão criativa, nunca um bloqueio mecânico — o Engine não tenta resolver isso sozinho.",
        });
        return this.finish(report, resolvedBlockers, escalations, history, totalActionsExecuted, totalRecalculations, "escalated");
      }

      // state === WAITING_ASSISTED_GENERATION
      const blocker = classifyBlocker(report);
      if (!blocker) {
        escalations.push({
          blocker: { kind: "unknown", stepId: report.waitingForStepId ?? "?", stepName: "?", executionState: report.state, message: report.message },
          reason: "no_known_action",
          message: "Não foi possível classificar o bloqueio a partir do relatório do workflow.",
        });
        return this.finish(report, resolvedBlockers, escalations, history, totalActionsExecuted, totalRecalculations, "escalated");
      }
      if (blocker.requiresHumanJudgment) {
        escalations.push({ blocker, reason: "subjective_judgment_required", message: blocker.humanJudgmentReason ?? "Decisão subjetiva — julgamento humano necessário." });
        return this.finish(report, resolvedBlockers, escalations, history, totalActionsExecuted, totalRecalculations, "escalated");
      }

      const candidateActions = selectActionsForBlocker(blocker, this.registry, this.config.actionPriority);
      if (candidateActions.length === 0) {
        escalations.push({ blocker, reason: "no_known_action", message: `Nenhuma ação registrada resolve o bloqueio "${blocker.kind}".` });
        return this.finish(report, resolvedBlockers, escalations, history, totalActionsExecuted, totalRecalculations, "escalated");
      }

      const roundOutcome = await this.attemptActions(candidateActions, blocker, report, history);
      totalActionsExecuted += roundOutcome.actionsExecuted;

      if (!roundOutcome.resolved) {
        escalations.push({
          blocker,
          reason: "attempts_exhausted",
          message: `Todas as ações candidatas (${candidateActions.map((action) => action.id).join(", ")}) foram tentadas e nenhuma resolveu o bloqueio "${blocker.kind}".`,
        });
        return this.finish(report, resolvedBlockers, escalations, history, totalActionsExecuted, totalRecalculations, "escalated");
      }

      resolvedBlockers += 1;

      if (this.config.dryRun) {
        // MODO DRY RUN (seção 12) — a lógica de decisão roda inteira, mas nunca chama `continueExecution`
        // de verdade (isso re-executaria a Skill real, com efeitos colaterais reais). Encerra aqui,
        // reportando o que teria sido tentado.
        return this.finish(report, resolvedBlockers, escalations, history, totalActionsExecuted, totalRecalculations, "completed");
      }

      report = await this.continueExecution(report.executionId);
      totalRecalculations += 1;
    }

    return this.finish(report, resolvedBlockers, escalations, history, totalActionsExecuted, totalRecalculations, "max_iterations_reached");
  }

  /** Tenta cada ação candidata, na ordem de prioridade, até `maxAttempts` cada — nunca pula direto para a próxima sem esgotar as tentativas da atual (seção 5), nunca continua tentando a mesma ação além do teto (nunca loop infinito). */
  private async attemptActions(
    candidateActions: ActionDefinition[],
    blocker: Blocker,
    report: WorkflowExecutionReport,
    history: ExecutionHistoryEntry[],
  ): Promise<{ resolved: boolean; actionsExecuted: number }> {
    let actionsExecuted = 0;

    for (const action of candidateActions) {
      for (let attempt = 1; attempt <= action.maxAttempts; attempt += 1) {
        if (attempt > 1) await this.sleep(action.backoffMs * attempt);

        const start = Date.now();
        let outcome;
        try {
          outcome = await action.execute({ executionId: report.executionId, blocker, report, attemptNumber: attempt, dryRun: this.config.dryRun });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          history.push(this.historyEntry(report, blocker, action.id, attempt, "error", `Ação lançou exceção: ${message}`, Date.now() - start, message));
          actionsExecuted += 1;
          continue;
        }
        actionsExecuted += 1;

        const succeeded = this.config.dryRun ? Boolean(outcome.wouldSucceed) : outcome.ok;
        history.push(
          this.historyEntry(
            report,
            blocker,
            action.id,
            attempt,
            succeeded ? "resolved" : "unresolved",
            outcome.detail,
            outcome.durationMs,
            outcome.error,
          ),
        );

        if (succeeded) return { resolved: true, actionsExecuted };
      }
    }

    return { resolved: false, actionsExecuted };
  }

  private historyEntry(
    report: WorkflowExecutionReport,
    blocker: Blocker,
    actionId: ExecutionHistoryEntry["acao"],
    attempt: number,
    resultado: ExecutionHistoryEntry["resultado"],
    motivo: string,
    tempoMs: number,
    erro?: string,
  ): ExecutionHistoryEntry {
    return {
      timestamp: new Date().toISOString(),
      workflow: report.executionId,
      step: blocker.stepId,
      bloqueio: blocker.kind,
      motivoBloqueio: blocker.message,
      acao: actionId,
      tentativa: attempt,
      resultado,
      motivo,
      erro,
      tempoMs,
    };
  }

  private finish(
    finalReport: WorkflowExecutionReport | undefined,
    resolvedBlockers: number,
    escalations: Escalation[],
    history: ExecutionHistoryEntry[],
    totalActionsExecuted: number,
    totalRecalculations: number,
    stoppedReason: AutonomousEngineOutcome["stoppedReason"],
  ): AutonomousEngineOutcome {
    return { finalReport, resolvedBlockers, escalations, history, totalActionsExecuted, totalRecalculations, stoppedReason };
  }
}

/** Filtra ações cujo `resolves` cobre o tipo de bloqueio, aplica o filtro `isApplicable` (fail fast) e ordena pela prioridade configurada — ações fora da lista de prioridade vão para o fim, na ordem em que aparecem no registry (nunca descartadas, só desempatadas por último). */
export function selectActionsForBlocker(blocker: Blocker, registry: ActionDefinition[], priority: string[]): ActionDefinition[] {
  const applicable = registry.filter((action) => action.resolves.includes(blocker.kind) && action.isApplicable(blocker));
  const priorityIndex = new Map(priority.map((id, index) => [id, index]));
  return [...applicable].sort((a, b) => {
    const rankA = priorityIndex.has(a.id) ? priorityIndex.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const rankB = priorityIndex.has(b.id) ? priorityIndex.get(b.id)! : Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  });
}
