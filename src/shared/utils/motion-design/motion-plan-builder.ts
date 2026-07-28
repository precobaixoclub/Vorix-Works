// Motion Design Engine (núcleo puro) — compõe Motion Strategy, Motion Timeline Builder, Motion
// Validator e Motion Metadata em um único Motion Plan. Esta função é o "motor" descrito na
// sprint; a Skill em `src/skills/motion-design-engine/` é apenas uma casca fina que aplica o
// contrato `Skill<Input,Output>` (log, eventos, manifesto) em cima dela — toda a lógica de
// decisão vive aqui, pura e testável sem nenhuma infraestrutura.
//
// Isolamento (ADR 0002): esta função NUNCA gera imagem, nunca renderiza vídeo, nunca chama
// FFmpeg/Remotion/CapCut/qualquer provider. A saída é só o plano.

import { decideMotionStrategy } from "./motion-strategy.js";
import { buildMotionTimeline } from "./motion-timeline-builder.js";
import { validateMotionPlan } from "./motion-validator.js";
import { buildMotionMetadata } from "./motion-metadata.js";
import type { MotionDesignRequestInput, MotionPlan, MotionStrategyInput } from "./motion-design.types.js";

export type MotionPlanIdGenerator = () => string;

const defaultIdGenerator: MotionPlanIdGenerator = () => `motion-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export type BuildMotionPlanOptions = {
  idGenerator?: MotionPlanIdGenerator;
  now?: () => Date;
};

/**
 * Constrói um Motion Plan completo a partir de imagens, storyboard, identidade visual, ritmo e
 * sinais de campanha — a única função que um chamador (a Skill, ou futuramente o Render Engine)
 * precisa invocar para ir de "imagens + intenção narrativa" a "plano de animação validado".
 */
export function buildMotionPlan(input: MotionDesignRequestInput, options: BuildMotionPlanOptions = {}): MotionPlan {
  const idGenerator = options.idGenerator ?? defaultIdGenerator;
  const planId = idGenerator();

  const strategyInput: MotionStrategyInput = {
    campaignType: input.campaignType || "promotional",
    targetAudience: input.targetAudience || "",
    dominantEmotion: input.dominantEmotion || "",
    platform: input.format,
    identity: input.identity,
    requestedRhythm: input.requestedRhythm,
  };
  const strategy = decideMotionStrategy(strategyInput);

  const { scenes, warnings: timelineWarnings } = buildMotionTimeline(input, strategy.preset);

  const validation = validateMotionPlan({
    scenes,
    images: input.images,
    format: input.format,
    totalDurationSeconds: input.campaignDurationSeconds,
  });

  const metadata = buildMotionMetadata({
    planId,
    scenes,
    presetUsed: strategy.presetId,
    input,
    now: options.now,
    notes: timelineWarnings,
  });

  return {
    planId,
    format: input.format,
    totalDurationSeconds: input.campaignDurationSeconds,
    strategy,
    scenes,
    metadata,
    validation,
  };
}
