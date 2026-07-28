import type { ScreenCorners, ScreenCornerPoint, ScreenKeyframe } from "../../application/ports/product-compositing.port.js";

/**
 * PRODUCT COMPOSITING ENGINE — geometria pura (sem I/O, sem FFmpeg), para que a matemática de
 * interpolação/bounding box/máscara possa ser testada isoladamente da execução real do FFmpeg.
 */

export type BoundingBox = { x: number; y: number; width: number; height: number };

export function cornersToArray(corners: ScreenCorners): ScreenCornerPoint[] {
  return [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
}

export function boundingBoxOfCorners(corners: ScreenCorners): BoundingBox {
  const points = cornersToArray(corners);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Bounding box que cobre TODOS os keyframes — usada como o "quadro de trabalho" único de toda a composição (seção sobre limitações: o filtro `perspective` do FFmpeg não aceita corners variáveis por frame/tempo, então o quadro de referência precisa ser fixo do início ao fim). */
export function unionBoundingBox(cornersList: ScreenCorners[]): BoundingBox {
  const boxes = cornersList.map(boundingBoxOfCorners);
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function translateCorners(corners: ScreenCorners, dx: number, dy: number): ScreenCorners {
  const shift = ([x, y]: ScreenCornerPoint): ScreenCornerPoint => [x + dx, y + dy];
  return {
    topLeft: shift(corners.topLeft),
    topRight: shift(corners.topRight),
    bottomRight: shift(corners.bottomRight),
    bottomLeft: shift(corners.bottomLeft),
  };
}

/** Aplica uma margem de segurança (seção 4: `safeMargin`) encolhendo o quadrilátero em direção ao seu próprio centro. */
export function applySafeMargin(corners: ScreenCorners, safeMarginPx: number): ScreenCorners {
  if (safeMarginPx <= 0) return corners;
  const points = cornersToArray(corners);
  const centerX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const centerY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  const shrink = ([x, y]: ScreenCornerPoint): ScreenCornerPoint => {
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.hypot(dx, dy) || 1;
    const shrinkBy = Math.min(safeMarginPx, distance * 0.4);
    const factor = (distance - shrinkBy) / distance;
    return [centerX + dx * factor, centerY + dy * factor];
  };
  return {
    topLeft: shrink(corners.topLeft),
    topRight: shrink(corners.topRight),
    bottomRight: shrink(corners.bottomRight),
    bottomLeft: shrink(corners.bottomLeft),
  };
}

/** Interpolação linear real ponto a ponto entre dois keyframes — matemática honesta, ver limitações de execução (segmentação) no adapter. */
export function lerpCorners(a: ScreenCorners, b: ScreenCorners, t: number): ScreenCorners {
  const lerpPoint = (p0: ScreenCornerPoint, p1: ScreenCornerPoint): ScreenCornerPoint => [
    p0[0] + (p1[0] - p0[0]) * t,
    p0[1] + (p1[1] - p0[1]) * t,
  ];
  return {
    topLeft: lerpPoint(a.topLeft, b.topLeft),
    topRight: lerpPoint(a.topRight, b.topRight),
    bottomRight: lerpPoint(a.bottomRight, b.bottomRight),
    bottomLeft: lerpPoint(a.bottomLeft, b.bottomLeft),
  };
}

export type PlacementSegment = { startTime: number; endTime: number; corners: ScreenCorners };

/**
 * Materializa keyframes em segmentos curtos de transformação ESTÁTICA (ver limitação documentada em
 * `PRODUCT_COMPOSITING_CAPABILITIES`: o filtro `perspective` do FFmpeg não aceita x0..y3 variando
 * por frame/tempo mesmo com `eval=frame` — testado empiricamente). Com 1 keyframe, devolve um único
 * segmento estático cobrindo toda a janela. Com 2+, cada par consecutivo de keyframes vira
 * `substepsPerPair` segmentos com corners linearmente interpolados — uma aproximação em degraus
 * curtos da interpolação contínua, não interpolação subpixel-por-frame.
 */
export function buildPlacementSegments(keyframes: ScreenKeyframe[], startTime: number, endTime: number, substepsPerPair: number): PlacementSegment[] {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (sorted.length === 0) throw new Error("Nenhum keyframe fornecido para construir segmentos de composição.");
  if (sorted.length === 1) return [{ startTime, endTime, corners: sorted[0].corners }];

  const segments: PlacementSegment[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index];
    const to = sorted[index + 1];
    const pairStart = index === 0 ? startTime : from.time;
    const pairEnd = index === sorted.length - 2 ? endTime : to.time;
    const steps = Math.max(1, substepsPerPair);
    for (let step = 0; step < steps; step += 1) {
      const segStart = pairStart + ((pairEnd - pairStart) * step) / steps;
      const segEnd = pairStart + ((pairEnd - pairStart) * (step + 1)) / steps;
      const tMid = (step + 0.5) / steps;
      segments.push({ startTime: segStart, endTime: segEnd, corners: lerpCorners(from.corners, to.corners, tMid) });
    }
  }
  return segments;
}

/** SDF de "rounded box" (Inigo Quilez) — usada para gerar a máscara alpha (canto arredondado + feather) via `geq` do FFmpeg, calculada em espaço de conteúdo (pré-warp), width/height/radius/feather em pixels. */
export function buildRoundedRectAlphaExpr(width: number, height: number, cornerRadiusPx: number, featherPx: number): string {
  const halfW = width / 2;
  const halfH = height / 2;
  const radius = Math.max(0, Math.min(cornerRadiusPx, Math.min(halfW, halfH)));
  const feather = Math.max(0.001, featherPx);
  const qx = `(abs(X-${halfW})-${halfW}+${radius})`;
  const qy = `(abs(Y-${halfH})-${halfH}+${radius})`;
  const outside = `sqrt(pow(max(${qx}\\,0)\\,2)+pow(max(${qy}\\,0)\\,2))`;
  const inside = `min(max(${qx}\\,${qy})\\,0)`;
  const d = `(${outside}+${inside}-${radius})`;
  return `clip(255*(1-clip((${d}+${feather / 2})/${feather}\\,0\\,1))\\,0\\,255)`;
}

export type CornerValidationIssue = { reason: string; detail: string };

/** Shoelace — área (sempre positiva) de um quadrilátero a partir dos 4 pontos, em ordem. */
export function polygonArea(points: ScreenCornerPoint[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** `true` quando o polígono é simples (não auto-intersecta) — checado via consistência de sinal do produto vetorial em cada vértice consecutivo (só é uma checagem exata para quadriláteros convexos, mas convexidade é exatamente o que se espera de uma tela real fotografada; documentado como limitação para formas côncavas exóticas). */
export function isConvexQuad(points: ScreenCornerPoint[]): boolean {
  if (points.length !== 4) return false;
  let sign = 0;
  for (let index = 0; index < 4; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % 4];
    const [x3, y3] = points[(index + 2) % 4];
    const cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2);
    const currentSign = Math.sign(cross);
    if (currentSign === 0) continue;
    if (sign === 0) sign = currentSign;
    else if (currentSign !== sign) return false;
  }
  return true;
}
