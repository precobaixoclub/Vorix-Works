import test from "node:test";
import assert from "node:assert/strict";
import {
  boundingBoxOfCorners,
  unionBoundingBox,
  translateCorners,
  applySafeMargin,
  lerpCorners,
  buildPlacementSegments,
  buildRoundedRectAlphaExpr,
  polygonArea,
  isConvexQuad,
} from "../dist/infrastructure/product-compositing/screen-geometry.js";

function squareCorners(x, y, size) {
  return {
    topLeft: [x, y],
    topRight: [x + size, y],
    bottomRight: [x + size, y + size],
    bottomLeft: [x, y + size],
  };
}

test("boundingBoxOfCorners calcula a caixa exata de um quadrado", () => {
  const box = boundingBoxOfCorners(squareCorners(10, 20, 100));
  assert.deepEqual(box, { x: 10, y: 20, width: 100, height: 100 });
});

test("unionBoundingBox cobre múltiplos keyframes com posições diferentes", () => {
  const box = unionBoundingBox([squareCorners(0, 0, 50), squareCorners(100, 100, 50)]);
  assert.deepEqual(box, { x: 0, y: 0, width: 150, height: 150 });
});

test("translateCorners desloca todos os 4 pontos igualmente", () => {
  const shifted = translateCorners(squareCorners(0, 0, 10), 5, -5);
  assert.deepEqual(shifted.topLeft, [5, -5]);
  assert.deepEqual(shifted.bottomRight, [15, 5]);
});

test("applySafeMargin encolhe o quadrilátero em direção ao centro (nunca aumenta a área)", () => {
  const original = squareCorners(0, 0, 100);
  const shrunk = applySafeMargin(original, 10);
  const originalArea = polygonArea([original.topLeft, original.topRight, original.bottomRight, original.bottomLeft]);
  const shrunkArea = polygonArea([shrunk.topLeft, shrunk.topRight, shrunk.bottomRight, shrunk.bottomLeft]);
  assert.ok(shrunkArea < originalArea, "área após safeMargin deveria ser menor");
});

test("applySafeMargin com margem 0 não altera os cantos", () => {
  const original = squareCorners(0, 0, 100);
  const result = applySafeMargin(original, 0);
  assert.deepEqual(result, original);
});

test("lerpCorners em t=0 devolve o primeiro keyframe, em t=1 devolve o segundo, em t=0.5 devolve o ponto médio real", () => {
  const a = squareCorners(0, 0, 10);
  const b = squareCorners(100, 100, 10);
  assert.deepEqual(lerpCorners(a, b, 0), a);
  assert.deepEqual(lerpCorners(a, b, 1), b);
  const mid = lerpCorners(a, b, 0.5);
  assert.deepEqual(mid.topLeft, [50, 50]);
});

test("buildPlacementSegments com 1 keyframe devolve um único segmento estático cobrindo toda a janela", () => {
  const segments = buildPlacementSegments([{ time: 2, corners: squareCorners(0, 0, 10) }], 0, 5, 6);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].startTime, 0);
  assert.equal(segments[0].endTime, 5);
});

test("buildPlacementSegments com 2 keyframes gera substepsPerPair segmentos com corners realmente interpolados (não apenas 2 blocos)", () => {
  const a = { time: 0, corners: squareCorners(0, 0, 10) };
  const b = { time: 4, corners: squareCorners(100, 100, 10) };
  const segments = buildPlacementSegments([a, b], 0, 4, 4);
  assert.equal(segments.length, 4);
  // Segmentos cobrem toda a janela [0,4] contiguamente, sem sobreposição nem buracos.
  assert.equal(segments[0].startTime, 0);
  assert.equal(segments[segments.length - 1].endTime, 4);
  for (let i = 1; i < segments.length; i += 1) {
    assert.ok(Math.abs(segments[i].startTime - segments[i - 1].endTime) < 1e-9, "segmentos devem ser contíguos");
  }
  // Corners avançam monotonicamente do primeiro para o último segmento (interpolação real, não um valor fixo repetido).
  const firstX = segments[0].corners.topLeft[0];
  const lastX = segments[segments.length - 1].corners.topLeft[0];
  assert.ok(lastX > firstX + 50, "o último segmento deve estar visivelmente mais próximo do segundo keyframe que o primeiro");
});

test("buildPlacementSegments com 3 keyframes cobre os dois pares consecutivos", () => {
  const keyframes = [
    { time: 0, corners: squareCorners(0, 0, 10) },
    { time: 2, corners: squareCorners(50, 50, 10) },
    { time: 4, corners: squareCorners(100, 100, 10) },
  ];
  const segments = buildPlacementSegments(keyframes, 0, 4, 2);
  assert.equal(segments.length, 4);
  assert.equal(segments[0].startTime, 0);
  assert.equal(segments[3].endTime, 4);
});

test("buildRoundedRectAlphaExpr produz uma expressão não vazia parametrizada pelo raio/feather informados", () => {
  const expr = buildRoundedRectAlphaExpr(400, 800, 20, 8);
  assert.ok(expr.includes("sqrt"));
  assert.ok(expr.length > 20);
});

test("polygonArea calcula corretamente a área de um retângulo simples", () => {
  const area = polygonArea([[0, 0], [100, 0], [100, 50], [0, 50]]);
  assert.equal(area, 5000);
});

test("isConvexQuad aceita um retângulo e rejeita um quadrilátero auto-intersectante (bowtie)", () => {
  assert.equal(isConvexQuad([[0, 0], [100, 0], [100, 100], [0, 100]]), true);
  // Bowtie: topRight e bottomRight trocados de lugar em relação a um retângulo válido.
  assert.equal(isConvexQuad([[0, 0], [100, 100], [100, 0], [0, 100]]), false);
});

test("isConvexQuad aceita um quadrilátero em perspectiva real (não retangular, mas convexo)", () => {
  assert.equal(isConvexQuad([[2040, 1080], [2570, 895], [2650, 1350], [1790, 1330]]), true);
});
