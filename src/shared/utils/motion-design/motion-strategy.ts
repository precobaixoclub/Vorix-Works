// Motion Strategy — decide, de forma determinística e auditável, qual Motion Preset melhor serve
// uma campanha, considerando tipo de campanha, público, emoção dominante, branding e plataforma
// de destino. Nunca chama IA; é heurística pura de pontuação por sinal, no mesmo espírito de
// `deriveCampaignCreativeDNA` (Creative Director Engine) — determinístico, sem custo, sempre
// reproduzível a partir da mesma entrada.

import { listMotionPresets } from "./motion-preset-catalog.js";
import { normalize } from "../skill-parsing.js";
import type {
  MotionFormat,
  MotionPresetId,
  MotionRhythm,
  MotionStrategyDecision,
  MotionStrategyInput,
  MotionStrategyScoredPreset,
} from "./motion-design.types.js";

const RHYTHM_SPEED_AFFINITY: Record<MotionRhythm, Record<string, number>> = {
  lento: { slow: 2, medium: 0, fast: -2 },
  moderado: { slow: 0, medium: 2, fast: 0 },
  dinamico: { slow: -1, medium: 1, fast: 2 },
  acelerado: { slow: -2, medium: 0, fast: 3 },
};

/**
 * Pontua todos os presets do catálogo contra a entrada e retorna a decisão ordenada. Sempre
 * retorna um preset (o de maior score) e a pontuação completa de todos os outros, para que a
 * decisão nunca seja uma caixa-preta — ver `MotionStrategyDecision.scored`/`reasoning`.
 */
export function decideMotionStrategy(input: MotionStrategyInput): MotionStrategyDecision {
  const campaignType = normalize(input.campaignType || "");
  const audience = normalize(input.targetAudience || "");
  const emotion = normalize(input.dominantEmotion || "");
  const platform = input.platform;
  const brandTone = normalize(input.identity?.toneOfVoice || "");

  const scored: MotionStrategyScoredPreset[] = listMotionPresets().map((preset) => {
    const matchedSignals: string[] = [];
    let score = 0;

    if (campaignType && preset.bestFor.campaignTypes.some((type) => normalize(type) === campaignType)) {
      score += 4;
      matchedSignals.push(`tipo de campanha "${input.campaignType}" combina com ${preset.name}`);
    }

    if (preset.bestFor.platforms.includes(platform)) {
      score += 3;
      matchedSignals.push(`plataforma "${platform}" é nativa de ${preset.name}`);
    }

    const emotionMatches = preset.bestFor.emotions.filter((candidate) => emotion.includes(normalize(candidate)) || normalize(candidate).includes(emotion));
    if (emotion && emotionMatches.length > 0) {
      score += 3 * emotionMatches.length;
      matchedSignals.push(`emoção "${input.dominantEmotion}" combina com ${emotionMatches.join(", ")} de ${preset.name}`);
    }

    if (brandTone) {
      const toneMatches = preset.bestFor.emotions.filter((candidate) => brandTone.includes(normalize(candidate)) || normalize(candidate).includes(brandTone));
      if (toneMatches.length > 0) {
        score += 2;
        matchedSignals.push(`tom de voz da marca "${input.identity?.toneOfVoice}" reforça ${preset.name}`);
      }
    }

    if (audience && (audience.includes("jovem") || audience.includes("gen z") || audience.includes("adolescente")) && (preset.id === "tiktok" || preset.id === "dynamic")) {
      score += 2;
      matchedSignals.push(`público "${input.targetAudience}" tende a formatos curtos e rápidos como ${preset.name}`);
    }

    if (input.requestedRhythm) {
      const affinity = RHYTHM_SPEED_AFFINITY[input.requestedRhythm][preset.speed] ?? 0;
      if (affinity !== 0) {
        score += affinity;
        matchedSignals.push(`ritmo "${input.requestedRhythm}" ${affinity > 0 ? "combina com" : "diverge de"} velocidade "${preset.speed}" de ${preset.name}`);
      }
    }

    return { presetId: preset.id, score, matchedSignals };
  });

  scored.sort((a, b) => b.score - a.score || a.presetId.localeCompare(b.presetId));

  const winner = scored[0]!;
  const runnerUp = scored[1];
  const confidence = deriveConfidence(winner.score, runnerUp?.score ?? 0);

  const reasoning = buildReasoning(input, winner, runnerUp, confidence);

  return {
    presetId: winner.presetId,
    preset: presetById(winner.presetId),
    reasoning,
    confidence,
    scored,
  };
}

function presetById(id: MotionPresetId) {
  const preset = listMotionPresets().find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`MOTION_STRATEGY_PRESET_NOT_FOUND: "${id}"`);
  return preset;
}

function deriveConfidence(winnerScore: number, runnerUpScore: number): "low" | "medium" | "high" {
  if (winnerScore <= 0) return "low";
  const margin = winnerScore - runnerUpScore;
  if (margin >= 4) return "high";
  if (margin >= 1) return "medium";
  return "low";
}

function buildReasoning(
  input: MotionStrategyInput,
  winner: MotionStrategyScoredPreset,
  runnerUp: MotionStrategyScoredPreset | undefined,
  confidence: "low" | "medium" | "high",
): string[] {
  const reasoning: string[] = [];
  const preset = presetById(winner.presetId);

  if (winner.matchedSignals.length > 0) {
    reasoning.push(`Preset "${preset.name}" escolhido com score ${winner.score}: ${winner.matchedSignals.join("; ")}.`);
  } else {
    reasoning.push(`Nenhum sinal forte encontrado; "${preset.name}" escolhido por ser o preset padrão de menor risco para a entrada recebida.`);
  }

  if (runnerUp) {
    reasoning.push(`Segundo colocado: "${presetById(runnerUp.presetId).name}" com score ${runnerUp.score}.`);
  }

  if (confidence === "low") {
    reasoning.push("Confiança baixa: considerar fornecer campaignType, dominantEmotion ou identity.toneOfVoice mais específicos para uma decisão mais segura.");
  }

  reasoning.push(`Plataforma de destino considerada: ${describePlatform(input.platform)}.`);

  return reasoning;
}

function describePlatform(platform: MotionFormat): string {
  return platform;
}
