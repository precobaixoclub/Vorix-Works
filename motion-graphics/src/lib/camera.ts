/**
 * Câmera virtual sobre a foto ORIGINAL: um retângulo (frações da foto) com a proporção do quadro.
 * Mover a câmera = interpolar retângulos (zoom em escala logarítmica, sem "acelerar" no fim). A foto
 * nunca é esticada nem recolorida; a ampliação é limitada para não perder nitidez.
 */

export type Frac = { x: number; y: number; w: number; h: number };
export type Photo = { w: number; h: number; print?: Frac };

/** Retângulo da câmera com a proporção do quadro (`aspect` = largura/altura do quadro). */
function fit(photo: Photo, aspect: number, cx: number, cy: number, w: number, maxZoom: number, frameW: number): Frac {
  const minW = frameW / (maxZoom * photo.w);
  let rw = Math.max(minW, Math.min(1, w));
  let rh = (rw * photo.w) / (aspect * photo.h);
  if (rh > 1) { rh = 1; rw = (aspect * photo.h) / photo.w; }
  const x = Math.max(0, Math.min(1 - rw, cx - rw / 2));
  const y = Math.max(0, Math.min(1 - rh, cy - rh / 2));
  return { x, y, w: rw, h: rh };
}

export type Shot = "full" | "print" | "chest" | "top" | "bottom" | "macro" | "detail" | "detail2";

/** Enquadramentos nomeados a partir da estampa (o que interessa no produto). */
export function frame(photo: Photo, shot: Shot, aspect: number, frameW: number, maxZoom = 1.75): Frac {
  const p = photo.print ?? { x: 0.3, y: 0.3, w: 0.4, h: 0.1 };
  const pcx = p.x + p.w / 2;
  const pcy = p.y + p.h / 2;
  switch (shot) {
    case "full": return fit(photo, aspect, 0.5, 0.5, 1, maxZoom, frameW);
    // Estampa ocupando ~74% da largura, um pouco acima do centro (respiro para o texto embaixo).
    case "print": return fit(photo, aspect, pcx, pcy + 0.06, p.w / 0.74, maxZoom, frameW);
    case "macro": return fit(photo, aspect, pcx, pcy, p.w / 0.92, maxZoom, frameW);
    // Recorte parcial (quiz, "segura o palpite"): um terço da estampa, perto, com a textura do tecido.
    // Fragmento de verdade (quiz): ~1/4 da estampa, perto, até 3,6× sobre os pixels originais.
    case "detail": return fit(photo, aspect, p.x + p.w * 0.2, pcy, p.w * 0.26, Math.max(maxZoom, 3.6), frameW);
    // Segunda pista: o outro lado da estampa (sem mostrar o conjunto).
    case "detail2": return fit(photo, aspect, p.x + p.w * 0.82, pcy, p.w * 0.26, Math.max(maxZoom, 3.6), frameW);
    case "chest": return fit(photo, aspect, pcx, pcy + 0.12, p.w / 0.5, maxZoom, frameW);
    case "top": return fit(photo, aspect, 0.5, 0.0, 0.82, maxZoom, frameW);
    case "bottom": return fit(photo, aspect, 0.5, 1, 0.82, maxZoom, frameW);
  }
}

export function lerpRect(a: Frac, b: Frac, t: number): Frac {
  const w = Math.exp(Math.log(a.w) + (Math.log(b.w) - Math.log(a.w)) * t);
  const h = Math.exp(Math.log(a.h) + (Math.log(b.h) - Math.log(a.h)) * t);
  const cx = a.x + a.w / 2 + (b.x + b.w / 2 - (a.x + a.w / 2)) * t;
  const cy = a.y + a.h / 2 + (b.y + b.h / 2 - (a.y + a.h / 2)) * t;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Estilo CSS da <Img> (tamanho natural da foto, origem 0 0) que mostra `rect` preenchendo o quadro W×H. */
export function imageTransform(photo: Photo, rect: Frac, W: number) {
  const scale = W / (rect.w * photo.w);
  return { scale, left: -rect.x * photo.w * scale, top: -rect.y * photo.h * scale };
}

/** Onde um retângulo da foto (frações) aparece no quadro, para a câmera `rect`. */
export function toScreen(region: Frac, rect: Frac, W: number, H: number): Frac {
  return { x: ((region.x - rect.x) / rect.w) * W, y: ((region.y - rect.y) / rect.h) * H, w: (region.w / rect.w) * W, h: (region.h / rect.h) * H };
}

/** Luminância média (0–255) da foto sob uma área do quadro — escolhe a tinta do texto e o véu. */
export function lumaUnder(grid: { cols: number; rows: number; values: number[] } | undefined, area: Frac, rect: Frac, W: number, H: number) {
  if (!grid) return { mean: 128, spread: 0 };
  const src = { x: rect.x + (area.x / W) * rect.w, y: rect.y + (area.y / H) * rect.h, w: (area.w / W) * rect.w, h: (area.h / H) * rect.h };
  const vals: number[] = [];
  for (let r = 0; r < grid.rows; r += 1) {
    for (let c = 0; c < grid.cols; c += 1) {
      const cx = (c + 0.5) / grid.cols, cy = (r + 0.5) / grid.rows;
      if (cx >= src.x && cx <= src.x + src.w && cy >= src.y && cy <= src.y + src.h) vals.push(grid.values[r * grid.cols + c]!);
    }
  }
  if (!vals.length) return { mean: 128, spread: 0 };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const spread = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  return { mean, spread };
}

/** Faixa larga (comparação empilhada): a estampa INTEIRA cabe na altura da faixa, centrada. */
export function bandFrame(photo: Photo, aspect: number, frameW: number): Frac {
  const p = photo.print ?? { x: 0.3, y: 0.3, w: 0.4, h: 0.1 };
  const byHeight = ((p.h / 0.72) * aspect * photo.h) / photo.w;
  return fit(photo, aspect, p.x + p.w / 2, p.y + p.h / 2, Math.max(p.w / 0.8, byHeight), 1.75, frameW);
}

/** Mantém o retângulo da câmera dentro da foto (nunca mostra borda vazia). */
export function clampRect(r: Frac): Frac {
  const w = Math.min(1, r.w), h = Math.min(1, r.h);
  const k = Math.min(w / r.w, h / r.h);
  const cw = r.w * k, ch = r.h * k;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  return { x: Math.max(0, Math.min(1 - cw, cx - cw / 2)), y: Math.max(0, Math.min(1 - ch, cy - ch / 2)), w: cw, h: ch };
}
