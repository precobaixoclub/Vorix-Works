import type { WorkflowExecutionReport } from "../../workflows/caio.types.js";
import type { Blocker } from "./autonomous-types.js";
import { MIN_ACCEPTABLE_SCENE_DIVERSITY, MIN_ACCEPTABLE_PRODUCT_COVERAGE } from "../../../shared/utils/coverage/requirement-evaluator.js";

/**
 * BLOCKER CLASSIFIER — interpreta um `WorkflowExecutionReport` parado e devolve um `Blocker`
 * estruturado, sem nunca importar nenhum tipo de Skill (mesmo padrão ADR 0002 já usado por
 * `printAssistedGenerationInstructions`/`printDeveloperAiInstructions` em
 * `src/interfaces/cli/index.ts`): lê `report.steps[].response.output` por NOME de campo contra um
 * tipo estrutural local, nunca importando `RafaAssistedGenerationOutput`/`NoraAssistedGenerationOutput`
 * de dentro das Skills.
 *
 * ESCOPO (decisão deliberada desta sprint): este classificador só reconhece bloqueios que chegam
 * como `WAITING_ASSISTED_GENERATION` — Production Readiness/Asset Diversity Gate (Rafa) e
 * Narração/Mockup pendente (Rafa/Nora). `WAITING_DEVELOPER_AI` (refinamento criativo de
 * João/Bruno/Vanessa/Diego/Maria/Lucas) e `WAITING_HUMAN_APPROVAL` NUNCA são tratados como
 * "bloqueio resolvível automaticamente" — são, por design, decisão criativa ou aprovação humana
 * (seção "Skills continuam responsáveis apenas pelas decisões criativas" da sprint). `classifyBlocker`
 * devolve `undefined` para esses dois estados; quem chama (`AutonomousExecutionEngine`) decide o
 * que fazer com isso (nunca inventa uma ação para um estado fora deste escopo).
 */

type LocalDiversitySummary = {
  qualityProfile?: unknown;
  passed?: unknown;
  failures?: unknown;
  totalShots?: unknown;
  distinctPhysicalFiles?: unknown;
  minDistinctPhysicalFiles?: unknown;
  videoRatio?: unknown;
  minVideoRatio?: unknown;
};

type LocalProductionReadinessScore = {
  overall?: unknown;
  minimumAcceptable?: unknown;
  visualCoverage?: unknown;
  humanCoverage?: unknown;
  productCoverage?: unknown;
  emotionalCoverage?: unknown;
  videoCoverage?: unknown;
  sceneDiversity?: unknown;
  assetVariety?: unknown;
};

type LocalPendingVisualAsset = {
  expectedRelativePath?: unknown;
  expectedAbsolutePath?: unknown;
  prompt?: unknown;
  width?: unknown;
  height?: unknown;
  aspectRatio?: unknown;
  sceneName?: unknown;
  sceneOrder?: unknown;
  shotId?: unknown;
  requiredKind?: unknown;
  requiredSubject?: unknown;
  tags?: unknown;
};

type LocalPendingNarration = {
  expectedRelativePath?: unknown;
  fileName?: unknown;
  durationSeconds?: unknown;
  prompt?: unknown;
  voiceProfile?: unknown;
  segments?: unknown;
};

type LocalAssistedOutput = {
  mode?: unknown;
  instruction?: unknown;
  resumeCommand?: unknown;
  pendingImages?: LocalPendingVisualAsset[];
  pendingVideos?: LocalPendingVisualAsset[];
  pendingVisualAssets?: LocalPendingVisualAsset[];
  diversitySummary?: LocalDiversitySummary;
  productionPlan?: Record<string, unknown>;
  productionReadinessScore?: LocalProductionReadinessScore;
  pendingNarrations?: LocalPendingNarration[];
  narrationScript?: unknown;
  voiceProfile?: unknown;
};

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function classifyBlocker(report: WorkflowExecutionReport): Blocker | undefined {
  if (report.state !== "WAITING_ASSISTED_GENERATION") return undefined;

  const waitingStep = report.steps.find((step) => step.stepId === report.waitingForStepId);
  if (!waitingStep) return undefined;

  const output = waitingStep.response?.output as LocalAssistedOutput | undefined;
  const base = {
    stepId: waitingStep.stepId,
    stepName: waitingStep.name,
    skillId: waitingStep.skillId,
    executionState: report.state,
    message: typeof output?.instruction === "string" ? output.instruction : report.message,
  };

  if (!output) return { ...base, kind: "unknown" };

  const diversity = output.diversitySummary;
  const readiness = output.productionReadinessScore;

  if (diversity && num(diversity.videoRatio) < num(diversity.minVideoRatio)) {
    return {
      ...base,
      kind: "video_coverage_low",
      metrics: {
        videoRatio: num(diversity.videoRatio),
        minVideoRatio: num(diversity.minVideoRatio),
        distinctPhysicalFiles: num(diversity.distinctPhysicalFiles),
        overall: num(readiness?.overall),
      },
    };
  }

  if (readiness && num(readiness.productCoverage) < MIN_ACCEPTABLE_PRODUCT_COVERAGE) {
    return {
      ...base,
      kind: "product_coverage_low",
      metrics: { productCoverage: num(readiness.productCoverage), overall: num(readiness.overall) },
    };
  }

  if (diversity && num(diversity.distinctPhysicalFiles) < num(diversity.minDistinctPhysicalFiles)) {
    return {
      ...base,
      kind: "asset_diversity_low",
      metrics: {
        distinctPhysicalFiles: num(diversity.distinctPhysicalFiles),
        minDistinctPhysicalFiles: num(diversity.minDistinctPhysicalFiles),
        totalShots: num(diversity.totalShots),
      },
    };
  }

  if (readiness && num(readiness.sceneDiversity) < MIN_ACCEPTABLE_SCENE_DIVERSITY) {
    return {
      ...base,
      kind: "scene_diversity_low",
      metrics: { sceneDiversity: num(readiness.sceneDiversity), overall: num(readiness.overall) },
    };
  }

  const pendingNarrations = Array.isArray(output.pendingNarrations) ? output.pendingNarrations : [];
  if (pendingNarrations.length > 0) {
    return { ...base, kind: "narration_invalid", metrics: { pendingCount: pendingNarrations.length } };
  }

  const pendingVisualAssets = [
    ...(Array.isArray(output.pendingVisualAssets) ? output.pendingVisualAssets : []),
    ...(Array.isArray(output.pendingImages) ? output.pendingImages : []),
    ...(Array.isArray(output.pendingVideos) ? output.pendingVideos : []),
  ];
  if (pendingVisualAssets.length > 0) {
    const allMockupLike = pendingVisualAssets.every((asset) => {
      const kind = String(asset.requiredKind ?? "");
      return kind === "mockup" || kind === "graphic" || kind === "screenshot";
    });
    return {
      ...base,
      kind: allMockupLike ? "mockup_missing" : "visual_asset_missing",
      metrics: { pendingCount: pendingVisualAssets.length },
    };
  }

  return { ...base, kind: "unknown" };
}

/** Extrai os `pendingVisualAssets`/`pendingImages`/`pendingVideos` do step bloqueado, para as ações que precisam do caminho/prompt exatos de cada asset pendente — mesma leitura estrutural do classificador, exposta separadamente para não duplicar o cast em cada ação. */
export function readPendingVisualAssets(report: WorkflowExecutionReport): LocalPendingVisualAsset[] {
  const waitingStep = report.steps.find((step) => step.stepId === report.waitingForStepId);
  const output = waitingStep?.response?.output as LocalAssistedOutput | undefined;
  return [
    ...(Array.isArray(output?.pendingVisualAssets) ? output!.pendingVisualAssets! : []),
    ...(Array.isArray(output?.pendingImages) ? output!.pendingImages! : []),
    ...(Array.isArray(output?.pendingVideos) ? output!.pendingVideos! : []),
  ];
}

export function readPendingNarrations(report: WorkflowExecutionReport): { narrations: LocalPendingNarration[]; narrationScript?: string } {
  const waitingStep = report.steps.find((step) => step.stepId === report.waitingForStepId);
  const output = waitingStep?.response?.output as LocalAssistedOutput | undefined;
  return {
    narrations: Array.isArray(output?.pendingNarrations) ? output!.pendingNarrations! : [],
    narrationScript: typeof output?.narrationScript === "string" ? output.narrationScript : undefined,
  };
}

export type { LocalPendingVisualAsset, LocalPendingNarration, LocalDiversitySummary, LocalProductionReadinessScore };
