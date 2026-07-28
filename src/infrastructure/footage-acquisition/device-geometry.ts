import type { MediaShotDeviceType } from "../../application/ports/media-catalog.port.js";

/**
 * FOOTAGE VISUAL VALIDATION 2.0 (seção 6) — validação geométrica por tipo de dispositivo. Nunca
 * reconhece um dispositivo de verdade (sem modelo de visão computacional neste ambiente, mesma
 * limitação já documentada em `visual-candidate-validator.ts`); só aplica um filtro de sanidade
 * geométrica grosseiro (proporção plausível + área mínima por tipo) sobre a região candidata já
 * encontrada pelo cluster de brilho/contraste — suficiente para descartar formas absurdas (uma
 * fatia de 1 bloco de largura não é um celular nem um notebook), mas nunca confirma que a região
 * É de fato o dispositivo pedido.
 */

export type DeviceGeometryEvaluation = {
  /** Combinação de proporção E área — usado só para `deviceConfidence`/relatórios. */
  plausible: boolean;
  /** Só a PROPORÇÃO (forma) — separado de área de propósito: a escada de classificação (`classifyVisualEvidence`) já tem sua PRÓPRIA checagem de área/preenchimento (`screenCoreOk`); misturar os dois aqui faria a escada travar no estágio errado (ex.: "formato errado" quando na verdade é só "área pequena"). */
  aspectPlausible: boolean;
  deviceConfidence: number;
  aspectRatio?: number;
  reason: string;
};

type AspectRange = { min: number; max: number };

/**
 * Faixas propositalmente generosas: sem correção de perspectiva real, a região candidata pode ser
 * um recorte parcial da tela em qualquer ângulo moderado — o objetivo é rejeitar formas
 * GEOMETRICAMENTE ABSURDAS (frestas, faixas finas, quase-linhas), não exigir um retângulo perfeito.
 */
const ASPECT_RANGE_BY_DEVICE: Record<Exclude<MediaShotDeviceType, "none">, AspectRange> = {
  phone: { min: 0.3, max: 3.2 },
  tablet: { min: 0.5, max: 2.2 },
  // NOTEBOOK — seção 6 pede evitar confundir quadros/janelas/placas: a faixa é mais estreita
  // (tipicamente paisagem, tela conectada a uma base) que phone/tablet, e a área mínima exigida
  // (ver MIN_AREA_FRACTION_BY_DEVICE) é maior, já que este ambiente não consegue confirmar a base/
  // dobradiça (isso exigiria detecção de objeto real).
  notebook: { min: 1.05, max: 2.6 },
  desktop: { min: 1.0, max: 2.6 },
};

const MIN_AREA_FRACTION_BY_DEVICE: Record<Exclude<MediaShotDeviceType, "none">, number> = {
  phone: 0.035,
  tablet: 0.06,
  notebook: 0.05,
  desktop: 0.05,
};

export function evaluateDeviceGeometry(input: {
  device: MediaShotDeviceType;
  boundingBoxFraction?: { x: number; y: number; width: number; height: number };
  screenArea: number;
  originalWidth: number;
  originalHeight: number;
}): DeviceGeometryEvaluation {
  if (input.device === "none") {
    return { plausible: true, aspectPlausible: true, deviceConfidence: 0, reason: "Shot não exige dispositivo — checagem de geometria não se aplica." };
  }
  if (!input.boundingBoxFraction) {
    return { plausible: false, aspectPlausible: false, deviceConfidence: 0, reason: "Nenhuma região candidata para avaliar geometria de dispositivo." };
  }

  const realWidthPx = input.boundingBoxFraction.width * input.originalWidth;
  const realHeightPx = input.boundingBoxFraction.height * input.originalHeight;
  const aspectRatio = realHeightPx > 0 ? realWidthPx / realHeightPx : 0;

  const range = ASPECT_RANGE_BY_DEVICE[input.device];
  const minArea = MIN_AREA_FRACTION_BY_DEVICE[input.device];
  const aspectPlausible = aspectRatio >= range.min && aspectRatio <= range.max;
  const areaPlausible = input.screenArea >= minArea;
  const plausible = aspectPlausible && areaPlausible;

  const deviceConfidence = plausible
    ? Math.min(1, Math.round((input.screenArea / (minArea * 2)) * 1000) / 1000)
    : aspectPlausible || areaPlausible ? 0.3 : 0.05;

  return {
    plausible,
    aspectPlausible,
    deviceConfidence,
    aspectRatio: Math.round(aspectRatio * 100) / 100,
    reason: plausible
      ? `Proporção (${aspectRatio.toFixed(2)}) e área (${(input.screenArea * 100).toFixed(1)}%) plausíveis para "${input.device}" (faixa esperada ${range.min}-${range.max}, área mínima ${(minArea * 100).toFixed(1)}%).`
      : `Proporção (${aspectRatio.toFixed(2)}) ou área (${(input.screenArea * 100).toFixed(1)}%) fora do plausível para "${input.device}" (faixa esperada ${range.min}-${range.max}, área mínima ${(minArea * 100).toFixed(1)}%) — provável falso positivo geométrico (objeto de outro formato, não o dispositivo pedido).`,
  };
}
