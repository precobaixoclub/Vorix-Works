/**
 * Inteligência de material (produto de vestuário): separa a ESTAMPA do tecido na foto ORIGINAL, sem
 * repintar nada. O RGB de cada pixel da estampa fica como na foto; só ganha transparência o que é
 * tecido (e a franja da borda é "desmisturada" da cor do tecido, para não ficar contorno escuro).
 * Também acha os elementos da estampa (ícones/letras) para o motion design animar um a um, e a caixa
 * da estampa em cada variante — base do match-cut entre cores (a estampa fica parada no quadro).
 *
 * Funções puras sobre RGB24; quem decodifica/grava é a infraestrutura.
 */

export type Box = { x: number; y: number; w: number; h: number };
export type PrintExtraction = {
  /** Cor média do tecido (borda da região). */
  fabric: [number, number, number];
  /** RGBA (mesmo tamanho da região): estampa opaca, tecido transparente. */
  rgba: Uint8Array;
  /** Caixa da estampa dentro da região (px). */
  bounds: Box;
  /** Elementos da estampa, da esquerda para a direita (px na região). */
  elements: Box[];
  /** 0–1: separação entre estampa e tecido (baixa = recorte não confiável → não animar elementos). */
  confidence: number;
  /** Lados em que um traço da estampa (centrado na região) encosta na borda: a região é pequena demais. */
  clipped: { top: boolean; bottom: boolean; left: boolean; right: boolean };
};

const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function borderStats(rgb: Uint8Array, w: number, h: number): { mean: [number, number, number]; spread: number } {
  const samples: number[][] = [];
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const i = (y * w + x) * 3;
      samples.push([rgb[i]!, rgb[i + 1]!, rgb[i + 2]!]);
    }
  }
  // Mediana por canal: robusta a um pedaço da estampa encostando na borda.
  const med = [0, 1, 2].map((c) => { const s = samples.map((p) => p[c]!).sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; }) as [number, number, number];
  const dists = samples.map((p) => Math.hypot(p[0]! - med[0], p[1]! - med[1], p[2]! - med[2])).sort((a, b) => a - b);
  // Percentil 60 (não 90): pele/braço/cabelo na borda não podem "inflar" a textura do tecido.
  return { mean: med, spread: dists[Math.floor(dists.length * 0.6)] ?? 0 };
}

/** Componentes conectados (4-vizinhança) de uma máscara binária; devolve as caixas com área. */
export function components(mask: Uint8Array, w: number, h: number, minArea = 12): (Box & { area: number })[] {
  const seen = new Uint8Array(w * h);
  const out: (Box & { area: number })[] = [];
  const stack: number[] = [];
  for (let start = 0; start < w * h; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p - x) / w;
      area += 1;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (area >= minArea) out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area });
  }
  return out;
}

/** Junta pedaços próximos em elementos (folhas/abelhas pequenas vão para o vizinho mais perto). */
export function groupElements(parts: (Box & { area: number })[], gap: number): Box[] {
  let groups = parts.map((p) => ({ ...p }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const a = groups[i]!, b = groups[j]!;
        const near = a.x - gap < b.x + b.w && b.x - gap < a.x + a.w && a.y - gap < b.y + b.h && b.y - gap < a.y + a.h;
        if (!near) continue;
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        groups[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, area: a.area + b.area };
        groups.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  const largest = Math.max(1, ...groups.map((g) => g.area));
  const big = groups.filter((g) => g.area >= largest * 0.06);
  // Migalhas: somam ao elemento grande mais próximo (não viram "ícone" sozinhas).
  for (const crumb of groups.filter((g) => g.area < largest * 0.06)) {
    const cx = crumb.x + crumb.w / 2, cy = crumb.y + crumb.h / 2;
    const target = big.reduce((best, g) => (Math.hypot(g.x + g.w / 2 - cx, g.y + g.h / 2 - cy) < Math.hypot(best.x + best.w / 2 - cx, best.y + best.h / 2 - cy) ? g : best), big[0]!);
    if (!target) continue;
    // Distância até a borda do elemento: migalha isolada (pedaço de braço, fiapo) fica de fora.
    const dx = Math.max(0, target.x - (crumb.x + crumb.w), crumb.x - (target.x + target.w));
    const dy = Math.max(0, target.y - (crumb.y + crumb.h), crumb.y - (target.y + target.h));
    if (Math.hypot(dx, dy) > gap * 6) continue;
    const x = Math.min(target.x, crumb.x), y = Math.min(target.y, crumb.y);
    target.w = Math.max(target.x + target.w, crumb.x + crumb.w) - x;
    target.h = Math.max(target.y + target.h, crumb.y + crumb.h) - y;
    target.x = x;
    target.y = y;
  }
  return big.map(({ x, y, w, h }) => ({ x, y, w, h })).sort((a, b) => a.x - b.x);
}

/** `inner`: região informada (px na área analisada) — elementos com centro fora dela são descartados. */
export function extractPrint(rgb: Uint8Array, w: number, h: number, inner?: Box): PrintExtraction {
  const { mean: fabric, spread } = borderStats(rgb, w, h);
  // Limiar adaptado à textura do tecido (dobras/sombra não viram estampa).
  const d0 = Math.min(90, Math.max(28, spread * 2.2));
  const d1 = d0 + 42;
  const rgba = new Uint8Array(w * h * 4);
  const mask = new Uint8Array(w * h);
  let strong = 0, weak = 0;
  for (let p = 0; p < w * h; p += 1) {
    const r = rgb[p * 3]!, g = rgb[p * 3 + 1]!, b = rgb[p * 3 + 2]!;
    const dist = Math.hypot(r - fabric[0], g - fabric[1], b - fabric[2]);
    const a = smooth(d0, d1, dist);
    if (a > 0.5) mask[p] = 1;
    if (a > 0.95) strong += 1; else if (a > 0.05) weak += 1;
    // Desmistura a franja: c = a·estampa + (1−a)·tecido → estampa = (c − (1−a)·tecido)/a.
    const un = (c: number, f: number) => (a > 0.02 ? Math.max(0, Math.min(255, Math.round((c - (1 - a) * f) / a))) : c);
    rgba[p * 4] = a >= 0.98 ? r : un(r, fabric[0]);
    rgba[p * 4 + 1] = a >= 0.98 ? g : un(g, fabric[1]);
    rgba[p * 4 + 2] = a >= 0.98 ? b : un(b, fabric[2]);
    rgba[p * 4 + 3] = Math.round(a * 255);
  }
  // O que encosta na borda da região acolchoada é cabelo, braço ou costura — a estampa fica no miolo.
  const all = components(mask, w, h, Math.max(6, Math.round(w * h * 0.00004)));
  const touches = (c: Box) => !(c.x > 1 && c.y > 1 && c.x + c.w < w - 1 && c.y + c.h < h - 1);
  const parts = all.filter((c) => !touches(c));
  const inside = (c: Box) => !inner || (c.x + c.w / 2 >= inner.x && c.x + c.w / 2 <= inner.x + inner.w && c.y + c.h / 2 >= inner.y && c.y + c.h / 2 <= inner.y + inner.h);
  // Traço grande, centrado na região, cortado pela borda = a estampa continua além da área analisada.
  const biggest = Math.max(1, ...all.filter(inside).map((c) => c.area));
  const cut = all.filter((c) => touches(c) && inside(c) && c.area >= biggest * 0.15);
  const clipped = { top: cut.some((c) => c.y <= 1), bottom: cut.some((c) => c.y + c.h >= h - 1), left: cut.some((c) => c.x <= 1), right: cut.some((c) => c.x + c.w >= w - 1) };
  const grouped = groupElements(parts.filter(inside), Math.max(2, Math.round(w * 0.004)));
  // Elemento largo demais (dois ícones ligados por uma folha): parte no "vale" de transparência.
  const widths = grouped.map((e) => e.w).sort((a, b) => a - b);
  const typical = widths[Math.floor((widths.length - 1) / 2)] ?? 0;
  const elements = grouped.flatMap((e) => {
    if (grouped.length < 2 || e.w < typical * 1.45) return [e];
    const cols = Array.from({ length: e.w }, (_, i) => { let s = 0; for (let y = e.y; y < e.y + e.h; y += 1) s += rgba[(y * w + e.x + i) * 4 + 3]!; return s; });
    const peak = Math.max(...cols);
    let cut = -1, low = Infinity;
    for (let i = Math.round(e.w * 0.3); i < Math.round(e.w * 0.7); i += 1) if (cols[i]! < low) { low = cols[i]!; cut = i; }
    if (cut < 0 || low > peak * 0.12) return [e];
    return [{ x: e.x, y: e.y, w: cut, h: e.h }, { x: e.x + cut, y: e.y, w: e.w - cut, h: e.h }];
  });
  const bounds = elements.length
    ? (() => { const x = Math.min(...elements.map((e) => e.x)), y = Math.min(...elements.map((e) => e.y)); return { x, y, w: Math.max(...elements.map((e) => e.x + e.w)) - x, h: Math.max(...elements.map((e) => e.y + e.h)) - y }; })()
    : { x: 0, y: 0, w, h };
  // Confiança: estampa com miolo sólido e pouca "meia-transparência" (borda limpa).
  const confidence = strong + weak === 0 ? 0 : Math.round((strong / (strong + weak)) * 100) / 100;
  return { fabric, rgba, bounds, elements, confidence, clipped };
}

/** Transformação que leva a estampa da variante `from` para a posição/tamanho dela na variante `to` (frações da foto). */
export function alignmentBetween(from: Box, to: Box): { scale: number; dx: number; dy: number } {
  const scale = to.w / Math.max(1e-6, from.w);
  return { scale, dx: to.x + to.w / 2 - (from.x + from.w / 2) * scale, dy: to.y + to.h / 2 - (from.y + from.h / 2) * scale };
}
