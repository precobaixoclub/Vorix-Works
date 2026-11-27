/**
 * Visual Composition Engine (puro): posições calculadas, não "chutadas". Nenhum elemento sobrepõe outro
 * nem sai da área segura; o produto/tela ganha o maior espaço possível sem perder a proporção original.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type Box = { top: number; bottom: number; left: number; right: number; width: number; height: number };

export const overlaps = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
export const inside = (r: Rect, box: Box) => r.x >= box.left - 0.5 && r.y >= box.top - 0.5 && r.x + r.w <= box.right + 0.5 && r.y + r.h <= box.bottom + 0.5;

/**
 * Vitrine de variantes SEM sobreposição: 2 lado a lado; 3 = destaque em cima e duas embaixo.
 * `reserveTop` é a altura do título. Cada cartão mantém a proporção da foto (aspect = w/h).
 */
export function lineupRects(n: number, aspect: number, box: Box, reserveTop: number, gap = 28): Rect[] {
  const top = box.top + reserveTop;
  const availH = box.bottom - top;
  if (n <= 1) {
    const w = Math.min(box.width, availH * aspect);
    return [{ x: box.left + (box.width - w) / 2, y: top + (availH - w / aspect) / 2, w, h: w / aspect }];
  }
  if (n === 2) {
    let w = (box.width - gap) / 2;
    w = Math.min(w, availH * aspect);
    const h = w / aspect;
    const x0 = box.left + (box.width - (2 * w + gap)) / 2;
    const y = top + (availH - h) / 2;
    return [{ x: x0, y, w, h }, { x: x0 + w + gap, y, w, h }];
  }
  // 3: destaque (60% da altura útil) + duas menores embaixo.
  const heroH = Math.min((availH - gap) * 0.58, box.width * 0.7 / aspect);
  const heroW = heroH * aspect;
  let smallW = (box.width - gap) / 2;
  let smallH = smallW / aspect;
  const room = availH - heroH - gap;
  if (smallH > room) { smallH = room; smallW = smallH * aspect; }
  const total = heroH + gap + smallH;
  const y0 = top + (availH - total) / 2;
  const x0 = box.left + (box.width - (2 * smallW + gap)) / 2;
  return [
    { x: box.left + (box.width - heroW) / 2, y: y0, w: heroW, h: heroH },
    { x: x0, y: y0 + heroH + gap, w: smallW, h: smallH },
    { x: x0 + smallW + gap, y: y0 + heroH + gap, w: smallW, h: smallH },
  ];
}

/**
 * Foco em software: captura inteira em cima e a LUPA da função embaixo (sem escurecer a tela). A região é
 * ampliada com margem de contexto; a lupa ocupa a largura segura e nunca passa da área útil.
 */
export function softwareFocusLayout(shotAspect: number, region: { x: number; y: number; w: number; h: number }, box: Box, reserveTop: number, gap = 36, shotWidth?: number, minSourceZoom = 2) {
  const pad = 0.15;
  const r = { x: Math.max(0, region.x - region.w * pad), y: Math.max(0, region.y - region.h * pad * 2), w: Math.min(1, region.w * (1 + 2 * pad)), h: Math.min(1, region.h * (1 + 4 * pad)) };
  r.w = Math.min(r.w, 1 - r.x);
  r.h = Math.min(r.h, 1 - r.y);
  const top = box.top + reserveTop;
  const availH = box.bottom - top;
  const loupeW = box.width;
  // Ampliação sobre os PIXELS ORIGINAIS (legibilidade): pelo menos `minSourceZoom`×. Se a região inteira não
  // cabe nessa ampliação, a lupa mostra uma janela e percorre a região (acompanha a leitura).
  const srcW = shotWidth ?? loupeW;
  const srcH = srcW / shotAspect;
  const fitZoom = loupeW / (r.w * srcW);
  const zoomSrc = Math.max(fitZoom, shotWidth ? minSourceZoom : fitZoom);
  const viewW = Math.min(r.w, loupeW / (zoomSrc * srcW));
  let viewH = r.h;
  let loupeH = viewH * srcH * zoomSrc;
  const maxLoupeH = availH * 0.48;
  if (loupeH > maxLoupeH) {
    loupeH = maxLoupeH;
    viewH = loupeH / (srcH * zoomSrc);
  }
  const viewY = Math.min(1 - viewH, Math.max(0, r.y + r.h / 2 - viewH / 2));
  let cardW = box.width;
  let cardH = cardW / shotAspect;
  if (cardH + gap + loupeH > availH) {
    cardH = availH - gap - loupeH;
    cardW = cardH * shotAspect;
  }
  const y0 = top + (availH - (cardH + gap + loupeH)) / 2;
  const card: Rect = { x: box.left + (box.width - cardW) / 2, y: y0, w: cardW, h: cardH };
  const loupe: Rect = { x: box.left + (box.width - loupeW) / 2, y: y0 + cardH + gap, w: loupeW, h: loupeH };
  // Janela visível na captura (frações): começa no início da região e, se preciso, anda até o fim.
  const view = { x0: r.x, x1: r.x + r.w - viewW, y: viewY, w: viewW, h: viewH };
  return { card, loupe, crop: r, view, zoom: loupeW / (viewW * cardW), sourceZoom: loupeW / (viewW * srcW) };
}
