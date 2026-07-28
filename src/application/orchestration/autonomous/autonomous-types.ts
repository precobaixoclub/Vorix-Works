/**
 * AUTONOMOUS EXECUTION ENGINE — tipos centrais. Este módulo (e todo o resto de
 * `src/application/orchestration/autonomous/` e `src/infrastructure/autonomous/`) nunca é
 * importado por nenhuma Skill, nem por Arthur/Caio/Helena — a única coisa que ele conhece de
 * Caio é o mesmo `WorkflowExecutionReport` público que a própria CLI já consome (ver
 * `blocker-classifier.ts`, que lê `report.steps[].response.output` por nome de campo, igual
 * `printAssistedGenerationInstructions`/`printDeveloperAiInstructions` em `interfaces/cli/index.ts`
 * já fazem — nunca importando um tipo de Skill). "Nenhuma Skill deve conhecer esse componente" é
 * garantido pela direção da dependência: só a CLI importa o Engine, nunca o contrário.
 */

import type { WorkflowExecutionReport } from "../../workflows/caio.types.js";

/** As categorias de bloqueio que o Engine sabe reconhecer — seção 4 da sprint. */
export const BLOCKER_KINDS = [
  "video_coverage_low",
  "product_coverage_low",
  "asset_diversity_low",
  "scene_diversity_low",
  "narration_invalid",
  "audio_missing",
  "mockup_missing",
  "visual_asset_missing",
  "unknown",
] as const;
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

/**
 * Um bloqueio identificado a partir de um `WorkflowExecutionReport` parado. `metrics` carrega os
 * números reais já calculados pelo próprio gate (Production Readiness/Asset Diversity Gate) —
 * nunca um valor inventado pelo Engine, sempre um espelho do que a Skill (Rafa/Nora) já devolveu.
 */
export type Blocker = {
  kind: BlockerKind;
  stepId: string;
  stepName: string;
  skillId?: string;
  /** Estado do workflow no momento em que o bloqueio foi identificado — sempre `WAITING_ASSISTED_GENERATION` para os bloqueios que este Engine resolve (ver seção "Escopo" em `blocker-classifier.ts`). */
  executionState: string;
  message: string;
  metrics?: Record<string, number>;
  /** `true` quando o próprio bloqueio, não uma ação específica, já é conhecido como exigindo julgamento humano (seção 7) — o Engine nunca tenta nenhuma ação nesse caso, escalona direto. */
  requiresHumanJudgment?: boolean;
  humanJudgmentReason?: string;
};

/** As ações corretivas que o Action Registry conhece — seção 2/9 da sprint. */
export const ACTION_IDS = [
  "gap_analysis",
  "media_catalog",
  "footage_acquisition",
  "visual_validation",
  "product_screen_catalog",
  "product_compositing",
  "narration_regeneration",
  "mockup_generation",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export type ActionContext = {
  executionId: string;
  blocker: Blocker;
  report: WorkflowExecutionReport;
  attemptNumber: number;
  /** MODO DRY RUN (seção 12) — quando `true`, a ação NUNCA baixa arquivo, NUNCA altera o catálogo, NUNCA grava no disco de artefatos; só decide o que FARIA e devolve isso em `detail`. */
  dryRun: boolean;
};

export type ActionOutcome = {
  actionId: ActionId;
  /** `true` só quando a ação genuinamente aplicou uma correção real (nunca `true` em `dryRun`, mesmo que a ação "teria funcionado" — ver `ActionOutcome.wouldSucceed`). */
  ok: boolean;
  /** Só usado em `dryRun`: o que a ação teria feito, sem `ok` implicar que algo real aconteceu. */
  wouldSucceed?: boolean;
  detail: string;
  sideEffectsApplied: string[];
  durationMs: number;
  error?: string;
};

export type ActionExecutor = (context: ActionContext) => Promise<ActionOutcome>;

/**
 * Uma capacidade registrada — seção 2 ("Nenhuma lógica hardcoded espalhada"). Todo texto aqui é
 * documentação viva, não decoração: `resolves`/`prerequisites`/`limitations` são lidos por
 * `--simulate-autonomous` e pelo relatório final, nunca duplicados à mão em outro lugar.
 */
export type ActionDefinition = {
  id: ActionId;
  name: string;
  description: string;
  resolves: BlockerKind[];
  prerequisites: string[];
  expectedDurationMsRange: [number, number];
  sideEffects: string[];
  limitations: string[];
  maxAttempts: number;
  /** Backoff LINEAR (seção 5): espera `backoffMs * tentativa` entre uma tentativa e a próxima da MESMA ação. */
  backoffMs: number;
  /**
   * FAIL FAST (seção 10) — filtro síncrono e barato, ANTES de qualquer chamada assíncrona: só
   * checa se o tipo de bloqueio está em `resolves`. A checagem mais profunda e específica (ex.:
   * "existe smartphone candidato?") acontece dentro do próprio `execute`, que deve devolver
   * `ok: false` rapidamente e SEM efeito colateral quando não há solução conhecida, em vez de
   * fingir tentar.
   */
  isApplicable: (blocker: Blocker) => boolean;
  execute: ActionExecutor;
};

/** HISTÓRICO DE EXECUÇÃO (seção 6) — cada linha é auditável isoladamente, nunca depende de estado externo para ser lida. */
export type ExecutionHistoryEntry = {
  timestamp: string;
  workflow: string;
  step: string;
  bloqueio: BlockerKind;
  motivoBloqueio: string;
  acao?: ActionId;
  tentativa: number;
  resultado: "resolved" | "unresolved" | "escalated" | "error";
  scoreAntes?: Record<string, number>;
  scoreDepois?: Record<string, number>;
  delta?: Record<string, number>;
  motivo: string;
  erro?: string;
  tempoMs: number;
};

export type EscalationReason = "no_known_action" | "attempts_exhausted" | "subjective_judgment_required" | "risk_of_incorrect_content";

export type Escalation = {
  blocker: Blocker;
  reason: EscalationReason;
  message: string;
};

export type AutonomousEngineConfig = {
  /** PRIORIDADE CONFIGURÁVEL (seção 9) — ordem em que ações candidatas são tentadas quando mais de uma resolve o mesmo tipo de bloqueio. Nunca hardcoded dentro do loop. */
  actionPriority: ActionId[];
  /** Teto GLOBAL de iterações do loop externo — nunca um loop infinito (seção 5), mesmo se cada ação individual respeitar seu próprio `maxAttempts`. */
  maxTotalIterations: number;
  dryRun: boolean;
};

export type AutonomousEngineOutcome = {
  finalReport: WorkflowExecutionReport | undefined;
  resolvedBlockers: number;
  escalations: Escalation[];
  history: ExecutionHistoryEntry[];
  totalActionsExecuted: number;
  totalRecalculations: number;
  stoppedReason: "completed" | "human_approval_required" | "escalated" | "max_iterations_reached";
};

export const DEFAULT_ACTION_PRIORITY: ActionId[] = [
  "media_catalog",
  "footage_acquisition",
  "visual_validation",
  "product_screen_catalog",
  "product_compositing",
  "narration_regeneration",
  "mockup_generation",
  "gap_analysis",
];

export const DEFAULT_ENGINE_CONFIG: AutonomousEngineConfig = {
  actionPriority: DEFAULT_ACTION_PRIORITY,
  maxTotalIterations: 25,
  dryRun: false,
};
