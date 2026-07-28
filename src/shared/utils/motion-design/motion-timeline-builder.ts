// Motion Timeline Builder — transforma um storyboard (ordem narrativa + imagens) e um Motion
// Preset já decidido em uma sequência concreta de `MotionScene`, com `startSeconds`/
// `durationSeconds` que somam exatamente `campaignDurationSeconds`. Não decide QUAL preset usar
// (isso é responsabilidade da Motion Strategy) nem valida o resultado (isso é responsabilidade do
// Motion Validator) — apenas monta a timeline.

import type {
  MotionDesignRequestInput,
  MotionPreset,
  MotionScene,
  MotionSceneAnimationAssignment,
  MotionSourceImage,
  MotionStoryboardBeat,
} from "./motion-design.types.js";

const MIN_SCENE_DURATION_SECONDS = 0.5;

export type MotionTimelineBuildResult = {
  scenes: MotionScene[];
  warnings: string[];
};

/**
 * Constrói a timeline de Motion a partir do storyboard, das imagens e do preset já escolhido.
 * Regra de duração: usa `suggestedDurationSeconds` de cada beat quando presente; para os beats
 * sem sugestão, distribui o tempo restante igualmente entre eles. Se a soma das durações
 * sugeridas já ultrapassar `campaignDurationSeconds`, todas as durações são escaladas
 * proporcionalmente para que o total feche exatamente — a mesma abordagem de escala proporcional
 * usada por `applyRebalancePlan` (Narrative Timing Rebalancing), nunca alteração manual.
 */
export function buildMotionTimeline(input: MotionDesignRequestInput, preset: MotionPreset): MotionTimelineBuildResult {
  const warnings: string[] = [];
  const imagesById = new Map(input.images.map((image) => [image.id, image]));
  const orderedBeats = [...input.storyboard].sort((a, b) => a.order - b.order);

  if (orderedBeats.length === 0) {
    return { scenes: [], warnings: ["Storyboard vazio; nenhuma cena foi construída."] };
  }

  const rawDurations = distributeDurations(orderedBeats, input.campaignDurationSeconds, warnings);

  let cursor = 0;
  const scenes: MotionScene[] = orderedBeats.map((beat, index) => {
    const image = imagesById.get(beat.imageId);
    if (!image) {
      warnings.push(`Beat ${beat.order} ("${beat.sceneName}") referencia imageId "${beat.imageId}" que não está entre as imagens recebidas.`);
    }

    const durationSeconds = rawDurations[index]!;
    const startSeconds = cursor;
    cursor += durationSeconds;

    const isLast = index === orderedBeats.length - 1;

    const animation: MotionSceneAnimationAssignment = {
      background: preset.background,
      text: beat.textOverlay || beat.subtitle ? preset.text : "static",
      icons: beat.hasIcon ? preset.icons : "none",
      cta: beat.hasCta ? preset.cta : "none",
      entrance: preset.entrance,
      exit: preset.exit,
      transitionToNext: isLast ? undefined : preset.transition,
    };

    return {
      order: beat.order,
      sceneName: beat.sceneName,
      imageId: beat.imageId,
      imageRef: resolveImageRef(image),
      presetId: preset.id,
      narrativeRole: beat.narrativeRole,
      startSeconds: roundToMillisecond(startSeconds),
      durationSeconds: roundToMillisecond(durationSeconds),
      animation,
      textOverlay: beat.textOverlay,
      subtitle: beat.subtitle,
      hasIcon: Boolean(beat.hasIcon),
      hasCta: Boolean(beat.hasCta),
      intensity: preset.intensity,
      speed: preset.speed,
    };
  });

  return { scenes, warnings };
}

function distributeDurations(beats: MotionStoryboardBeat[], totalDurationSeconds: number, warnings: string[]): number[] {
  const suggested = beats.map((beat) => (typeof beat.suggestedDurationSeconds === "number" && beat.suggestedDurationSeconds > 0 ? beat.suggestedDurationSeconds : undefined));
  const suggestedSum = suggested.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const unsuggestedCount = suggested.filter((value) => value === undefined).length;

  if (unsuggestedCount === 0) {
    if (suggestedSum <= 0) {
      warnings.push("Nenhum beat do storyboard tem duração sugerida válida; distribuindo tempo igualmente entre todas as cenas.");
      return equalSplit(beats.length, totalDurationSeconds);
    }
    if (Math.abs(suggestedSum - totalDurationSeconds) > 0.01) {
      warnings.push(
        `Soma das durações sugeridas do storyboard (${suggestedSum.toFixed(2)}s) diverge da duração da campanha (${totalDurationSeconds}s); durações escaladas proporcionalmente.`,
      );
    }
    const scale = totalDurationSeconds / suggestedSum;
    return suggested.map((value) => Math.max(MIN_SCENE_DURATION_SECONDS, value! * scale));
  }

  // Mistura de beats com e sem duração sugerida: os sugeridos mantêm o valor pedido (respeitando
  // o mínimo), e o tempo restante é dividido igualmente entre os beats sem sugestão. Se não sobrar
  // tempo suficiente, escala tudo proporcionalmente para o total continuar exato.
  const remaining = totalDurationSeconds - suggestedSum;
  const perUnsuggested = remaining > 0 ? remaining / unsuggestedCount : MIN_SCENE_DURATION_SECONDS;

  if (remaining <= 0) {
    warnings.push("Durações sugeridas do storyboard já ocupam toda a duração da campanha; cenas sem sugestão receberão a duração mínima e o total será escalado para fechar exato.");
  }

  const raw = suggested.map((value) => value ?? Math.max(MIN_SCENE_DURATION_SECONDS, perUnsuggested));
  const rawSum = raw.reduce<number>((sum, value) => sum + value, 0);
  const scale = totalDurationSeconds / rawSum;
  return raw.map((value) => Math.max(MIN_SCENE_DURATION_SECONDS, value * scale));
}

function equalSplit(count: number, totalDurationSeconds: number): number[] {
  const each = totalDurationSeconds / count;
  return new Array(count).fill(each);
}

function resolveImageRef(image: MotionSourceImage | undefined): string {
  if (!image) return "";
  return image.localPath || image.relativePath || image.uri || "";
}

function roundToMillisecond(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
