/**
 * Perfil de linguagem audiovisual de um vídeo — usado em DOIS papéis com o MESMO medidor:
 *  1) vídeo profissional de REFERÊNCIA anexado à pauta (o que a criação original deve perseguir);
 *  2) diagnóstico das nossas próprias peças (o que de fato saiu do motor).
 *
 * Tudo aqui é MEDIDO sobre quadros reduzidos (funções puras, sem modelo externo): cortes, duração dos
 * planos, energia de movimento, câmera (deslocamento global), luz, contraste, cor, paleta, ocupação
 * do quadro e quadros vazios. Tipografia e direção de arte NÃO são medidas aqui: o diretor as lê nas
 * miniaturas — e o relatório diz isso, para nunca apresentar como medido o que foi interpretado.
 *
 * Direitos: a referência orienta uma criação ORIGINAL. O perfil guarda números e uma paleta; nenhum
 * quadro da referência entra na peça renderizada.
 */

export type RgbFrames = { width: number; height: number; fps: number; /** RGB24 concatenado, quadro a quadro. */ data: Uint8Array };

export type ShotStats = { count: number; meanSeconds: number; medianSeconds: number; minSeconds: number; maxSeconds: number; cutsPer10s: number; /** Duração média do plano no 1º, 2º e 3º terço do vídeo. */ paceByThird: [number, number, number] };

export type ReferenceProfile = {
  durationSeconds: number;
  aspect: number;
  cuts: number[];
  shots: ShotStats;
  /** 0–100: mudança média entre quadros DENTRO dos planos (sem contar os cortes). */
  motionEnergy: number;
  motionClass: "static" | "gentle" | "dynamic" | "frenetic";
  /** Deslocamento global médio por segundo, em % da largura (câmera/paralaxe vs. objeto parado). */
  cameraTravel: number;
  luma: { mean: number; contrast: number };
  saturation: number;
  colorfulness: number;
  /** >0 quente, <0 fria. */
  warmth: number;
  palette: { hex: string; share: number }[];
  composition: { negativeSpace: number; fill: number; centroid: { x: number; y: number }; centeredShare: number };
  /** Quadros quase vazios (sem conteúdo legível): fundo chapado, transição morta, tela preta. */
  emptyFrames: { share: number; longestSeconds: number };
  hookSeconds: number;
  endSeconds: number;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

function histogram(data: Uint8Array, offset: number, pixels: number): Float32Array {
  const h = new Float32Array(48);
  for (let p = 0; p < pixels; p += 1) {
    const i = offset + p * 3;
    h[data[i]! >> 4]! += 1;
    h[16 + (data[i + 1]! >> 4)]! += 1;
    h[32 + (data[i + 2]! >> 4)]! += 1;
  }
  for (let k = 0; k < 48; k += 1) h[k] = h[k]! / (pixels * 3);
  return h;
}

/** Cortes: pico local da diferença de histograma acima do limiar, com plano mínimo de 0,25 s. */
export function detectCuts(frames: RgbFrames, threshold = 0.22): number[] {
  const pixels = frames.width * frames.height;
  const count = Math.floor(frames.data.length / (pixels * 3));
  const diffs: number[] = [0];
  let prev = histogram(frames.data, 0, pixels);
  for (let f = 1; f < count; f += 1) {
    const cur = histogram(frames.data, f * pixels * 3, pixels);
    let d = 0;
    for (let k = 0; k < 48; k += 1) d += Math.abs(cur[k]! - prev[k]!);
    diffs.push(d);
    prev = cur;
  }
  const minGap = Math.max(1, Math.round(frames.fps * 0.25));
  const cuts: number[] = [];
  let last = -minGap;
  for (let f = 1; f < count; f += 1) {
    const d = diffs[f]!;
    if (d < threshold) continue;
    if (d < (diffs[f - 1] ?? 0) || d < (diffs[f + 1] ?? 0)) continue;
    if (f - last < minGap) continue;
    cuts.push(round(f / frames.fps, 3));
    last = f;
  }
  return cuts;
}

export function shotStats(cuts: number[], durationSeconds: number): ShotStats {
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < durationSeconds), durationSeconds];
  const lengths = bounds.slice(1).map((end, i) => end - bounds[i]!);
  const third = durationSeconds / 3;
  const pace = [0, 1, 2].map((t) => {
    const inThird = lengths.filter((_, i) => { const mid = (bounds[i]! + bounds[i + 1]!) / 2; return mid >= t * third && mid < (t + 1) * third; });
    return round(inThird.length ? inThird.reduce((a, b) => a + b, 0) / inThird.length : third, 2);
  }) as [number, number, number];
  return {
    count: lengths.length,
    meanSeconds: round(durationSeconds / Math.max(1, lengths.length)),
    medianSeconds: round(median(lengths)),
    minSeconds: round(Math.min(...lengths)),
    maxSeconds: round(Math.max(...lengths)),
    cutsPer10s: round((cuts.length / Math.max(0.1, durationSeconds)) * 10, 1),
    paceByThird: pace,
  };
}

/** Paleta dominante: k-means determinístico (sementes espalhadas pela luminância), k = 5. */
export function dominantPalette(samples: number[][], k = 5): { hex: string; share: number }[] {
  if (!samples.length) return [];
  const sorted = [...samples].sort((a, b) => a[0]! + a[1]! + a[2]! - (b[0]! + b[1]! + b[2]!));
  let centers = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]!]);
  let assign = new Array<number>(samples.length).fill(0);
  for (let iter = 0; iter < 12; iter += 1) {
    assign = samples.map((s) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, i) => { const d = (s[0]! - c[0]!) ** 2 + (s[1]! - c[1]!) ** 2 + (s[2]! - c[2]!) ** 2; if (d < bestD) { bestD = d; best = i; } });
      return best;
    });
    centers = centers.map((c, i) => {
      const members = samples.filter((_, j) => assign[j] === i);
      if (!members.length) return c;
      return [0, 1, 2].map((ch) => members.reduce((a, m) => a + m[ch]!, 0) / members.length);
    });
  }
  const shares = centers.map((_, i) => assign.filter((a) => a === i).length / samples.length);
  return centers.map((c, i) => ({ hex: hex(c[0]!, c[1]!, c[2]!), share: round(shares[i]!, 3) })).filter((p) => p.share >= 0.02).sort((a, b) => b.share - a.share);
}

/** Deslocamento global (busca ±3 px) entre dois quadros em cinza: o "quanto a câmera andou". */
function globalShift(a: Float32Array, b: Float32Array, w: number, h: number): number {
  let best = Infinity;
  let bestShift = 0;
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      let sum = 0;
      let n = 0;
      for (let y = 4; y < h - 4; y += 2) for (let x = 4; x < w - 4; x += 2) { sum += Math.abs(a[y * w + x]! - b[(y + dy) * w + x + dx]!); n += 1; }
      const err = sum / Math.max(1, n);
      if (err < best - 0.01) { best = err; bestShift = Math.hypot(dx, dy); }
    }
  }
  return bestShift;
}

export function analyzeFrames(frames: RgbFrames, durationSeconds?: number): ReferenceProfile {
  const { width: w, height: h, fps, data } = frames;
  const pixels = w * h;
  const count = Math.floor(data.length / (pixels * 3));
  const duration = durationSeconds ?? count / fps;
  const cuts = detectCuts(frames);
  const cutFrames = new Set(cuts.map((c) => Math.round(c * fps)));
  const grays: Float32Array[] = [];
  let lumaSum = 0;
  let lumaSq = 0;
  let satSum = 0;
  let rg = 0, rgSq = 0, yb = 0, ybSq = 0, warm = 0;
  let neg = 0, fillSum = 0, cxSum = 0, cySum = 0, centered = 0, detailFrames = 0;
  const empty: boolean[] = [];
  const samples: number[][] = [];
  for (let f = 0; f < count; f += 1) {
    const g = new Float32Array(pixels);
    let fl = 0, flSq = 0;
    for (let p = 0; p < pixels; p += 1) {
      const i = f * pixels * 3 + p * 3;
      const r = data[i]!, gg = data[i + 1]!, b = data[i + 2]!;
      const y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      g[p] = y;
      fl += y;
      flSq += y * y;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      satSum += mx === 0 ? 0 : (mx - mn) / mx;
      const a1 = r - gg, a2 = 0.5 * (r + gg) - b;
      rg += a1; rgSq += a1 * a1; yb += a2; ybSq += a2 * a2;
      warm += (r - b) / 255;
      if (f % Math.max(1, Math.round(fps / 2)) === 0 && p % 7 === 0) samples.push([r, gg, b]);
    }
    lumaSum += fl;
    lumaSq += flSq;
    const fMean = fl / pixels;
    const fStd = Math.sqrt(Math.max(0, flSq / pixels - fMean * fMean));
    // Ocupação: gradiente acima do ruído = conteúdo. Centroide do conteúdo = onde o olho vai.
    let detail = 0, sx = 0, sy = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        const grad = Math.abs(g[i + 1]! - g[i - 1]!) + Math.abs(g[i + w]! - g[i - w]!);
        if (grad > 18) { detail += 1; sx += x; sy += y; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
    }
    const inner = (w - 2) * (h - 2);
    neg += 1 - detail / inner;
    empty.push(detail / inner < 0.012 || fStd < 6);
    if (detail > inner * 0.01) {
      detailFrames += 1;
      const cx = sx / detail / w, cy = sy / detail / h;
      cxSum += cx; cySum += cy;
      if (Math.abs(cx - 0.5) < 0.12 && Math.abs(cy - 0.5) < 0.15) centered += 1;
      fillSum += ((maxX - minX) * (maxY - minY)) / inner;
    }
    grays.push(g);
  }
  let motion = 0, motionN = 0, travel = 0, travelN = 0;
  const gw = w, gh = h;
  for (let f = 1; f < count; f += 1) {
    if (cutFrames.has(f) || cutFrames.has(f - 1)) continue;
    let d = 0;
    for (let p = 0; p < pixels; p += 1) d += Math.abs(grays[f]![p]! - grays[f - 1]![p]!);
    motion += d / pixels;
    motionN += 1;
    if (f % 2 === 0) { travel += globalShift(grays[f - 1]!, grays[f]!, gw, gh); travelN += 1; }
  }
  const n = count * pixels;
  const lumaMean = lumaSum / Math.max(1, n);
  // Diferença média por quadro a 6 q/s (0–255) × 5: parado < 3 (só granulação), suave < 10, marcado < 30.
  const motionEnergy = round(clamp((motion / Math.max(1, motionN)) * (6 / fps) * 5, 0, 100), 1);
  const rgMean = rg / n, ybMean = yb / n;
  const colorfulness = Math.sqrt(Math.max(0, rgSq / n - rgMean ** 2) + Math.max(0, ybSq / n - ybMean ** 2)) + 0.3 * Math.hypot(rgMean, ybMean);
  let longest = 0, run = 0;
  for (const e of empty) { run = e ? run + 1 : 0; longest = Math.max(longest, run); }
  const shots = shotStats(cuts, duration);
  const bounds = [0, ...cuts, duration];
  return {
    durationSeconds: round(duration),
    aspect: round(w / h, 3),
    cuts,
    shots,
    motionEnergy,
    motionClass: motionEnergy < 3 ? "static" : motionEnergy < 10 ? "gentle" : motionEnergy < 30 ? "dynamic" : "frenetic",
    cameraTravel: round(((travel / Math.max(1, travelN)) / w) * 100 * (fps / 2), 2),
    luma: { mean: round(lumaMean, 1), contrast: round(Math.sqrt(Math.max(0, lumaSq / Math.max(1, n) - lumaMean ** 2)), 1) },
    saturation: round(satSum / Math.max(1, n), 3),
    colorfulness: round(colorfulness, 1),
    warmth: round(warm / Math.max(1, n), 3),
    palette: dominantPalette(samples),
    composition: {
      negativeSpace: round(neg / Math.max(1, count), 3),
      fill: round(fillSum / Math.max(1, detailFrames), 3),
      centroid: { x: round(cxSum / Math.max(1, detailFrames), 3), y: round(cySum / Math.max(1, detailFrames), 3) },
      centeredShare: round(centered / Math.max(1, detailFrames), 3),
    },
    emptyFrames: { share: round(empty.filter(Boolean).length / Math.max(1, count), 3), longestSeconds: round(longest / fps, 2) },
    hookSeconds: round((bounds[1] ?? duration) - 0, 2),
    endSeconds: round(duration - (bounds[bounds.length - 2] ?? 0), 2),
  };
}

export type AudioProfile = { integratedLufs?: number; truePeakDb?: number; bpm?: number; cutsOnBeat?: number };

const MOTION_LABEL: Record<ReferenceProfile["motionClass"], string> = { static: "quase parado", gentle: "movimento suave", dynamic: "movimento marcado", frenetic: "movimento frenético" };

/**
 * Orientação ao diretor a partir do perfil medido. É linguagem (ritmo, câmera, luz, cor, ocupação), não
 * cópia: o diretor cria uma peça original com os materiais da marca.
 */
export function referenceGuidance(profile: ReferenceProfile, audio: AudioProfile = {}, aspects?: readonly string[]): string[] {
  const want = (a: string) => !aspects?.length || aspects.includes(a);
  const p = profile;
  const lines: string[] = [];
  if (want("ritmo")) {
    lines.push(`Ritmo medido: ${p.shots.count} planos em ${p.durationSeconds} s (plano mediano ${p.shots.medianSeconds} s, ${p.shots.cutsPer10s} cortes a cada 10 s); planos por terço ${p.shots.paceByThird.join(" → ")} s; gancho de ${p.hookSeconds} s e fechamento de ${p.endSeconds} s.`);
  }
  if (want("movimento")) lines.push(`Movimento: ${MOTION_LABEL[p.motionClass]} (energia ${p.motionEnergy}/100); câmera percorre ~${p.cameraTravel}% da largura por segundo.`);
  if (want("cor")) lines.push(`Cor e luz: luminância média ${p.luma.mean}/255, contraste ${p.luma.contrast}, saturação ${Math.round(p.saturation * 100)}%, ${p.warmth > 0.03 ? "temperatura quente" : p.warmth < -0.03 ? "temperatura fria" : "temperatura neutra"}; paleta ${p.palette.map((c) => `${c.hex} (${Math.round(c.share * 100)}%)`).join(", ")}.`);
  if (want("composicao") || want("enquadramento")) lines.push(`Composição: ${Math.round(p.composition.negativeSpace * 100)}% de respiro, o assunto ocupa ~${Math.round(p.composition.fill * 100)}% do quadro, ${Math.round(p.composition.centeredShare * 100)}% dos quadros com o assunto centralizado.`);
  if (audio.bpm || audio.integratedLufs !== undefined) lines.push(`Áudio: ${audio.bpm ? `${audio.bpm} BPM` : "sem pulso claro"}${audio.cutsOnBeat !== undefined ? `, ${Math.round(audio.cutsOnBeat * 100)}% dos cortes na batida` : ""}${audio.integratedLufs !== undefined ? `, ${audio.integratedLufs} LUFS` : ""}.`);
  if (p.emptyFrames.share > 0.04) lines.push(`Atenção: ${Math.round(p.emptyFrames.share * 100)}% de quadros quase vazios (máx. ${p.emptyFrames.longestSeconds} s seguidos).`);
  return lines;
}

/** Comparação objetiva entre duas peças (ex.: referência × nossa versão) — base do diagnóstico. */
export function compareProfiles(ours: ReferenceProfile, reference: ReferenceProfile): string[] {
  const out: string[] = [];
  const ratio = ours.shots.medianSeconds / Math.max(0.1, reference.shots.medianSeconds);
  if (ratio > 1.4) out.push(`Planos ${ratio.toFixed(1)}× mais longos que a referência (${ours.shots.medianSeconds} s × ${reference.shots.medianSeconds} s).`);
  if (ratio < 0.6) out.push(`Planos bem mais curtos que a referência (${ours.shots.medianSeconds} s × ${reference.shots.medianSeconds} s).`);
  if (ours.motionEnergy < reference.motionEnergy * 0.5) out.push(`Menos da metade da energia de movimento da referência (${ours.motionEnergy} × ${reference.motionEnergy}).`);
  if (ours.composition.fill < reference.composition.fill - 0.15) out.push(`O assunto ocupa menos do quadro (${Math.round(ours.composition.fill * 100)}% × ${Math.round(reference.composition.fill * 100)}%).`);
  if (ours.emptyFrames.share > reference.emptyFrames.share + 0.03) out.push(`Mais quadros vazios (${Math.round(ours.emptyFrames.share * 100)}% × ${Math.round(reference.emptyFrames.share * 100)}%).`);
  return out;
}
