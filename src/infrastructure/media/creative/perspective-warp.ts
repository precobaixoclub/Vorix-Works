/**
 * Transformação geométrica de perspectiva (homografia) — encaixa uma captura REAL de tela num
 * quadrilátero qualquer (tela de notebook inclinada, monitor em ângulo) preservando retas e
 * proporção local, com amostragem bilinear e borda antisserrilhada. Sem dependência nativa além do
 * buffer RGBA bruto (o `sharp` não faz perspectiva).
 */

export type Point = { x: number; y: number };
/** Cantos na ordem: superior-esquerdo, superior-direito, inferior-direito, inferior-esquerdo. */
export type Quad = [Point, Point, Point, Point];

function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    if (Math.abs(a[column][column]) < 1e-12) throw new Error("PERSPECTIVE_DEGENERATE_QUAD: quadrilátero degenerado.");
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= n; k += 1) a[row][k] -= factor * a[column][k];
    }
  }
  return a.map((row, index) => row[n] / row[index]);
}

/** Homografia H (3×3, h33 = 1) que leva `from[i]` em `to[i]`. */
export function homography(from: Quad, to: Quad): number[] {
  const matrix: number[][] = [];
  const vector: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const { x, y } = from[index];
    const { x: u, y: v } = to[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    vector.push(v);
  }
  return [...solve(matrix, vector), 1];
}

export function applyHomography(h: readonly number[], point: Point): Point {
  const w = h[6] * point.x + h[7] * point.y + h[8];
  return { x: (h[0] * point.x + h[1] * point.y + h[2]) / w, y: (h[3] * point.x + h[4] * point.y + h[5]) / w };
}

/**
 * Desenha `source` (RGBA bruto) dentro de `quad` numa camada RGBA `width`×`height` transparente.
 * Mapeamento inverso (destino → origem) com bilinear; a borda do quadrilátero recebe cobertura
 * parcial (supersample 2×2) para não serrilhar.
 */
export function warpIntoQuad(source: { data: Buffer; width: number; height: number }, quad: Quad, width: number, height: number): Buffer {
  const sourceQuad: Quad = [{ x: 0, y: 0 }, { x: source.width, y: 0 }, { x: source.width, y: source.height }, { x: 0, y: source.height }];
  const inverse = homography(quad, sourceQuad);
  const out = Buffer.alloc(width * height * 4);
  const minX = Math.max(0, Math.floor(Math.min(...quad.map((point) => point.x))));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(...quad.map((point) => point.x))));
  const minY = Math.max(0, Math.floor(Math.min(...quad.map((point) => point.y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...quad.map((point) => point.y))));
  const sample = (sx: number, sy: number, channel: number) => {
    const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(sx)));
    const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(sy)));
    const x1 = Math.min(source.width - 1, x0 + 1);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, sx - x0));
    const fy = Math.max(0, Math.min(1, sy - y0));
    const value = (x: number, y: number) => source.data[(y * source.width + x) * 4 + channel];
    return (value(x0, y0) * (1 - fx) + value(x1, y0) * fx) * (1 - fy) + (value(x0, y1) * (1 - fx) + value(x1, y1) * fx) * fy;
  };
  const inside = (point: Point) => point.x >= 0 && point.y >= 0 && point.x < source.width && point.y < source.height;
  const offsets = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let coverage = 0;
      for (const [dx, dy] of offsets) if (inside(applyHomography(inverse, { x: x + dx, y: y + dy }))) coverage += 0.25;
      if (!coverage) continue;
      const center = applyHomography(inverse, { x: x + 0.5, y: y + 0.5 });
      const sx = Math.max(0, Math.min(source.width - 1, center.x - 0.5));
      const sy = Math.max(0, Math.min(source.height - 1, center.y - 0.5));
      const index = (y * width + x) * 4;
      out[index] = Math.round(sample(sx, sy, 0));
      out[index + 1] = Math.round(sample(sx, sy, 1));
      out[index + 2] = Math.round(sample(sx, sy, 2));
      out[index + 3] = Math.round(sample(sx, sy, 3) * coverage);
    }
  }
  return out;
}

/** Escala média (px de destino por px de origem) de um quadrilátero — base da medição de legibilidade. */
export function quadScale(quad: Quad, sourceWidth: number, sourceHeight: number): number {
  const top = Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y);
  const bottom = Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y);
  const left = Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y);
  const right = Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y);
  return Math.min((top + bottom) / 2 / sourceWidth, (left + right) / 2 / sourceHeight);
}
