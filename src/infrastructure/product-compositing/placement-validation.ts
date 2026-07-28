import type { PlacementValidationError, PlacementValidationResult, ScreenPlacementContract } from "../../application/ports/product-compositing.port.js";
import { cornersToArray, polygonArea, isConvexQuad } from "./screen-geometry.js";

const MIN_AREA_PX2 = 2000;
const MAX_ASPECT_RATIO_DISTORTION = 6;

/**
 * PRODUCT COMPOSITING ENGINE (seção 5) — validação real das coordenadas antes de qualquer
 * composição. Bloqueia explicitamente: pontos fora do frame, polígono inválido (não-convexo/
 * degenerado), área excessivamente pequena, proporção impossível, keyframes fora da duração, vídeo
 * de outra execução, modo de interpolação não suportado, keyframes insuficientes/fora de ordem.
 */
export function validatePlacementContract(contract: ScreenPlacementContract, input: { executionIdOfVideo?: string; expectedExecutionId?: string }): PlacementValidationResult {
  const errors: PlacementValidationError[] = [];

  if (contract.interpolationMode !== "linear" && contract.interpolationMode !== "hold") {
    errors.push({ reason: "unsupported_interpolation_mode", detail: `Modo de interpolação "${contract.interpolationMode}" não é suportado — apenas "linear" e "hold" foram implementados.` });
  }

  if (contract.keyframes.length === 0) {
    errors.push({ reason: "insufficient_keyframes", detail: "Nenhum keyframe fornecido — pelo menos 1 é obrigatório." });
  }
  if (contract.mode === "SIMPLE_KEYFRAME_TRACKING" && contract.keyframes.length < 2) {
    errors.push({ reason: "insufficient_keyframes", detail: "SIMPLE_KEYFRAME_TRACKING exige pelo menos 2 keyframes — use STATIC_SCREEN para posição única." });
  }

  const sortedTimes = [...contract.keyframes].map((keyframe) => keyframe.time).sort((a, b) => a - b);
  const isSorted = contract.keyframes.every((keyframe, index) => keyframe.time === sortedTimes[index]);
  if (!isSorted) {
    errors.push({ reason: "keyframes_out_of_order", detail: "Os keyframes devem estar em ordem crescente de tempo, sem duplicatas." });
  }
  const hasDuplicateTimes = new Set(sortedTimes).size !== sortedTimes.length;
  if (hasDuplicateTimes) {
    errors.push({ reason: "keyframes_out_of_order", detail: "Dois keyframes não podem ter exatamente o mesmo timestamp." });
  }

  if (contract.startTime < 0 || contract.endTime > contract.sourceVideoDurationSeconds || contract.startTime >= contract.endTime) {
    errors.push({ reason: "keyframe_outside_duration", detail: `Janela [${contract.startTime}, ${contract.endTime}] inválida para um vídeo de ${contract.sourceVideoDurationSeconds}s.` });
  }
  for (const keyframe of contract.keyframes) {
    if (keyframe.time < contract.startTime - 1e-6 || keyframe.time > contract.endTime + 1e-6) {
      errors.push({ reason: "keyframe_outside_duration", detail: `Keyframe em t=${keyframe.time}s está fora da janela [${contract.startTime}, ${contract.endTime}] do Shot.` });
    }
    if (keyframe.time < 0 || keyframe.time > contract.sourceVideoDurationSeconds) {
      errors.push({ reason: "keyframe_outside_duration", detail: `Keyframe em t=${keyframe.time}s está fora da duração real do vídeo (${contract.sourceVideoDurationSeconds}s).` });
    }
  }

  if (input.expectedExecutionId && input.executionIdOfVideo && input.expectedExecutionId !== input.executionIdOfVideo) {
    errors.push({ reason: "asset_from_other_execution", detail: `O vídeo pertence à execução "${input.executionIdOfVideo}", mas a composição foi solicitada para "${input.expectedExecutionId}".` });
  }

  for (const keyframe of contract.keyframes) {
    const points = cornersToArray(keyframe.corners);
    for (const [x, y] of points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        errors.push({ reason: "corner_outside_frame", detail: `Coordenada não numérica em keyframe t=${keyframe.time}.` });
        continue;
      }
      if (x < 0 || y < 0) {
        errors.push({ reason: "corner_outside_frame", detail: `Canto (${x}, ${y}) do keyframe t=${keyframe.time} tem coordenada negativa — fora do frame.` });
      }
    }

    if (!isConvexQuad(points)) {
      errors.push({ reason: "invalid_polygon", detail: `Os 4 pontos do keyframe t=${keyframe.time} não formam um quadrilátero convexo simples (cantos fora de ordem ou auto-intersectando).` });
      continue;
    }

    const area = polygonArea(points);
    if (area < MIN_AREA_PX2) {
      errors.push({ reason: "area_too_small", detail: `Área do keyframe t=${keyframe.time} é de apenas ${area.toFixed(0)}px² — abaixo do mínimo de ${MIN_AREA_PX2}px², provavelmente marcação incorreta.` });
    }

    const topWidth = Math.hypot(keyframe.corners.topRight[0] - keyframe.corners.topLeft[0], keyframe.corners.topRight[1] - keyframe.corners.topLeft[1]);
    const leftHeight = Math.hypot(keyframe.corners.bottomLeft[0] - keyframe.corners.topLeft[0], keyframe.corners.bottomLeft[1] - keyframe.corners.topLeft[1]);
    const ratio = Math.max(topWidth, leftHeight) / Math.max(1, Math.min(topWidth, leftHeight));
    if (ratio > MAX_ASPECT_RATIO_DISTORTION) {
      errors.push({ reason: "impossible_aspect_ratio", detail: `Proporção ${ratio.toFixed(1)}:1 entre os lados do keyframe t=${keyframe.time} é implausível para uma tela de dispositivo.` });
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
