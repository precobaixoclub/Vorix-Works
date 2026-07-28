import { spawn } from "node:child_process";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import type { MediaShotDeviceType } from "../../application/ports/media-catalog.port.js";
import { evaluateDeviceGeometry } from "./device-geometry.js";
import type { RejectionPatternCode, VisualValidationStage } from "./visual-validation-stage.js";

/**
 * FOOTAGE VISUAL VALIDATION 2.0 — reescrita corretiva do Visual Candidate Validator. A versão
 * anterior (Intent-Based Footage Acquisition) decidia `screenVisible`/`compositingReady` a partir
 * de UM par de frames e de um único sinal (brilho+contraste em blocos). Validação real (frames
 * extraídos e olhados por um humano) comprovou 50% de falso positivo em `compositingReady=true`:
 * uma borda de capa de celular e um vídeo de fantasia de Halloween foram ambos classificados como
 * "tela visível" pela mesma razão — uma região mais clara e mais "detalhada" que a vizinhança, sem
 * nenhuma outra evidência exigida.
 *
 * Esta versão nunca decide `screenVisible`/`compositingReady` a partir de um único sinal isolado —
 * exige uma COMBINAÇÃO de evidências (seção 2) analisadas ao longo de MÚLTIPLOS frames (seção 3):
 *   - geometria plausível para o tipo de dispositivo pedido (`device-geometry.ts`);
 *   - persistência da região candidata entre frames (a mesma região, não uma nova a cada frame);
 *   - variedade de cor DENTRO da região candidata — uma tela de interface real tem ícones/texto/
 *     fundo de cores variadas; uma capa de celular ou uma superfície lisa tem uma cor quase
 *     uniforme, mesmo que brilhante e localmente "contrastada" o bastante para enganar a heurística
 *     antiga (este é o discriminador que resolve o falso positivo real encontrado: a borda laranja
 *     da capa de celular);
 *   - nitidez (contraste médio dentro do cluster) suficiente;
 *   - oclusão (mãos/dedos cobrindo a maior parte da região candidata);
 *   - presença humana GERAL vs. interação (mãos especificamente perto/sobre o dispositivo — "uma
 *     pessoa apenas próxima ao dispositivo não conta como interação", seção 4) tratadas como dois
 *     scores separados, nunca um único número ambíguo.
 * A saída é um ESTÁGIO (`VisualValidationStage`), nunca mais um booleano direto — ver
 * `visual-validation-stage.ts`. Na ausência de evidência suficiente, o resultado nunca avança
 * sozinho até `compositing_ready` (isso continua exigindo a simulação geométrica de
 * `pre-composition-simulator.ts` por cima deste resultado).
 *
 * PRINCÍPIO DE HONESTIDADE (mantido): nenhuma destas heurísticas é detecção de objeto/tela real —
 * são todas aproximações de pixel determinísticas, testáveis e documentadas como tal.
 */

const GRID_SIZE = 64;
const BLOCK_SIZE = 8;
const BLOCKS_PER_SIDE = GRID_SIZE / BLOCK_SIZE;

const MIN_SCREEN_AREA_FRACTION_FLOOR = 0.01;
const MIN_SCREEN_AREA_FRACTION = 0.035;
const MIN_BOUNDING_FILL_RATIO = 0.45;
const MIN_COLOR_VARIETY_SCORE = 0.12;
const MIN_PERSISTENCE_FOR_DEVICE = 0.4;
const MIN_PERSISTENCE_FOR_SCREEN = 0.6;
const MIN_CLUSTER_CONTRAST = 5;
const OCCLUSION_SKIN_RATIO_THRESHOLD = 0.35;
const EXTREME_LOW_INTERACTION_THRESHOLD = 0.08;
const MIN_INTERACTION_WHEN_REQUIRED = 0.12;
const SKIN_SCORE_NORMALIZATION = 0.15;
const CLUSTER_IOU_PERSISTENCE_THRESHOLD = 0.2;
const EXPECTED_FRAMES_SAMPLED = 5;

async function extractRgbFrame(absolutePath: string, timestampSeconds: number): Promise<Buffer | undefined> {
  const binaryPath = resolveFfmpegBinaryPath();
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-ss", timestampSeconds.toFixed(2),
    "-i", absolutePath,
    "-frames:v", "1",
    "-vf", `scale=${GRID_SIZE}:${GRID_SIZE}:flags=area,format=rgb24`,
    "-f", "rawvideo",
    "pipe:1",
  ];
  return new Promise<Buffer | undefined>((resolvePromise) => {
    const child = spawn(binaryPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("close", (code) => {
      if (code !== 0 || chunks.length === 0) { resolvePromise(undefined); return; }
      resolvePromise(Buffer.concat(chunks));
    });
    child.on("error", () => resolvePromise(undefined));
  });
}

/** Seção 3 — início, 25%, 50%, 75%, final, com margem de segurança para não pedir a ffmpeg um seek exatamente em 0 ou na duração total (risco de frame vazio em alguns containers). */
function computeTimestamps(durationSeconds: number): number[] {
  if (durationSeconds <= 1) return [Math.min(0.15, durationSeconds / 2)];
  const margin = Math.min(0.3, durationSeconds * 0.05);
  const span = Math.max(0, durationSeconds - 2 * margin);
  const fractions = [0, 0.25, 0.5, 0.75, 1];
  const points = fractions.map((fraction) => Math.round((margin + fraction * span) * 100) / 100);
  return [...new Set(points)];
}

function pixelAt(frame: Buffer, x: number, y: number): [number, number, number] {
  const offset = (y * GRID_SIZE + x) * 3;
  return [frame[offset], frame[offset + 1], frame[offset + 2]];
}

function isSkinTone(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return r > 95 && g > 40 && b > 20 && (max - min) > 15 && Math.abs(r - g) > 15 && r > g && r > b;
}

function blockStats(frame: Buffer, blockRow: number, blockCol: number): { brightness: number; contrast: number; meanColor: [number, number, number] } {
  const values: number[] = [];
  let rs = 0, gs = 0, bs = 0, n = 0;
  for (let y = blockRow * BLOCK_SIZE; y < (blockRow + 1) * BLOCK_SIZE; y += 1) {
    for (let x = blockCol * BLOCK_SIZE; x < (blockCol + 1) * BLOCK_SIZE; x += 1) {
      const [r, g, b] = pixelAt(frame, x, y);
      values.push((r + g + b) / 3);
      rs += r; gs += g; bs += b; n += 1;
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { brightness: mean, contrast: Math.sqrt(variance), meanColor: [rs / n, gs / n, bs / n] };
}

type ScreenClusterResult = {
  screenArea: number;
  boundingFillRatio: number;
  boundingBoxFraction?: { x: number; y: number; width: number; height: number };
  clusterIndices: number[];
  clusterContrast: number;
};

function findLargestScreenCluster(frame: Buffer): ScreenClusterResult {
  const blocks: Array<{ brightness: number; contrast: number; isCandidate: boolean }> = [];
  for (let row = 0; row < BLOCKS_PER_SIDE; row += 1) {
    for (let col = 0; col < BLOCKS_PER_SIDE; col += 1) {
      const stats = blockStats(frame, row, col);
      blocks.push({ brightness: stats.brightness, contrast: stats.contrast, isCandidate: false });
    }
  }
  const meanBrightness = blocks.reduce((sum, block) => sum + block.brightness, 0) / blocks.length;
  const meanContrast = blocks.reduce((sum, block) => sum + block.contrast, 0) / blocks.length;
  for (const block of blocks) {
    block.isCandidate = block.brightness > meanBrightness + 0.15 * 255 && block.contrast > meanContrast;
  }

  const visited = new Array(blocks.length).fill(false);
  let bestCluster: number[] = [];
  const indexOf = (row: number, col: number) => row * BLOCKS_PER_SIDE + col;

  for (let row = 0; row < BLOCKS_PER_SIDE; row += 1) {
    for (let col = 0; col < BLOCKS_PER_SIDE; col += 1) {
      const start = indexOf(row, col);
      if (visited[start] || !blocks[start].isCandidate) continue;
      const cluster: number[] = [];
      const queue = [[row, col]];
      visited[start] = true;
      while (queue.length > 0) {
        const [r, c] = queue.pop()!;
        cluster.push(indexOf(r, c));
        const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
        for (const [nr, nc] of neighbors) {
          if (nr < 0 || nc < 0 || nr >= BLOCKS_PER_SIDE || nc >= BLOCKS_PER_SIDE) continue;
          const nIndex = indexOf(nr, nc);
          if (visited[nIndex] || !blocks[nIndex].isCandidate) continue;
          visited[nIndex] = true;
          queue.push([nr, nc]);
        }
      }
      if (cluster.length > bestCluster.length) bestCluster = cluster;
    }
  }

  if (bestCluster.length === 0) return { screenArea: 0, boundingFillRatio: 0, clusterIndices: [], clusterContrast: 0 };

  const rows = bestCluster.map((index) => Math.floor(index / BLOCKS_PER_SIDE));
  const cols = bestCluster.map((index) => index % BLOCKS_PER_SIDE);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const boundingArea = (maxRow - minRow + 1) * (maxCol - minCol + 1);
  const boundingFillRatio = boundingArea > 0 ? bestCluster.length / boundingArea : 0;
  const screenArea = bestCluster.length / blocks.length;
  const boundingBoxFraction = {
    x: minCol / BLOCKS_PER_SIDE,
    y: minRow / BLOCKS_PER_SIDE,
    width: (maxCol - minCol + 1) / BLOCKS_PER_SIDE,
    height: (maxRow - minRow + 1) / BLOCKS_PER_SIDE,
  };
  const clusterContrast = bestCluster.reduce((sum, index) => sum + blocks[index].contrast, 0) / bestCluster.length;

  return { screenArea, boundingFillRatio, boundingBoxFraction, clusterIndices: bestCluster, clusterContrast };
}

/** Variedade de cor DENTRO do cluster — o discriminador central desta sprint. Uma interface real (ícones, texto, fundo) varia de cor entre blocos vizinhos; uma superfície lisa (capa de celular, parede, tecido) quase não varia, mesmo brilhante/contrastada. Normalizado empiricamente contra os fixtures sintéticos do teste (superfície sólida vs. padrão multicolorido). */
function colorVarietyOfCluster(frame: Buffer, clusterIndices: number[]): number {
  if (clusterIndices.length < 2) return 0;
  const colors = clusterIndices.map((index) => blockStats(frame, Math.floor(index / BLOCKS_PER_SIDE), index % BLOCKS_PER_SIDE).meanColor);
  const stdOf = (values: number[]): number => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  };
  const rStd = stdOf(colors.map((color) => color[0]));
  const gStd = stdOf(colors.map((color) => color[1]));
  const bStd = stdOf(colors.map((color) => color[2]));
  const combined = (rStd + gStd + bStd) / 3;
  return Math.min(1, Math.round((combined / 40) * 1000) / 1000);
}

function skinRatioInRect(frame: Buffer, xStart: number, yStart: number, xEnd: number, yEnd: number): number {
  let skin = 0;
  let total = 0;
  for (let y = Math.max(0, yStart); y < Math.min(GRID_SIZE, yEnd); y += 1) {
    for (let x = Math.max(0, xStart); x < Math.min(GRID_SIZE, xEnd); x += 1) {
      const [r, g, b] = pixelAt(frame, x, y);
      if (isSkinTone(r, g, b)) skin += 1;
      total += 1;
    }
  }
  return total > 0 ? skin / total : 0;
}

function humanPresenceScoreOf(frame: Buffer): number {
  return Math.min(1, Math.round((skinRatioInRect(frame, 0, 0, GRID_SIZE, GRID_SIZE) / SKIN_SCORE_NORMALIZATION) * 1000) / 1000);
}

/**
 * "Uma pessoa apenas próxima ao dispositivo não conta como interação" (seção 4) — mede pele SÓ
 * dentro de uma região dilatada ao redor do bounding box candidato (mão sobre/tocando o
 * aparelho), nunca o frame inteiro. Sem região candidata, não há "dispositivo" para interagir —
 * score sempre 0.
 *
 * Dilação calibrada contra os 2 verdadeiros positivos humanamente confirmados da validação real
 * desta sprint (asset 291335d9/pexels-13441336, "food delivery app"; asset a2da1eee/
 * pexels-6611949, "male hand typing on mobile phone"): o cluster de "tela" detectado é só a
 * ÁREA BRILHANTE da tela em si — a mão que segura o aparelho fica, em ambos os vídeos reais,
 * fora de 1 bloco (8px) de margem (a margem original testada), o que zerava a interação mesmo
 * com a mão claramente visível segurando o telefone. 3 blocos (24px, ~37,5% de margem de cada
 * lado num grid 64x64) foi o menor valor que capturou a mão em AMBOS os vídeos reais sem deixar
 * de rejeitar os 2 falsos positivos confirmados da mesma validação (a capa laranja do celular
 * continua sendo pega por oclusão, não por este score).
 */
function interactionScoreNear(frame: Buffer, boundingBoxFraction: { x: number; y: number; width: number; height: number } | undefined): number {
  if (!boundingBoxFraction) return 0;
  const dilation = BLOCK_SIZE * 3;
  const xStart = Math.round(boundingBoxFraction.x * GRID_SIZE) - dilation;
  const yStart = Math.round(boundingBoxFraction.y * GRID_SIZE) - dilation;
  const xEnd = Math.round((boundingBoxFraction.x + boundingBoxFraction.width) * GRID_SIZE) + dilation;
  const yEnd = Math.round((boundingBoxFraction.y + boundingBoxFraction.height) * GRID_SIZE) + dilation;
  const ratio = skinRatioInRect(frame, xStart, yStart, xEnd, yEnd);
  return Math.min(1, Math.round((ratio / SKIN_SCORE_NORMALIZATION) * 1000) / 1000);
}

/** Fração de pele DENTRO do próprio bounding box (não dilatado) — mãos/dedos cobrindo a maior parte da região candidata é sinal de oclusão crítica (seção 2). */
function occlusionRatioOf(frame: Buffer, boundingBoxFraction: { x: number; y: number; width: number; height: number } | undefined): number {
  if (!boundingBoxFraction) return 0;
  const xStart = Math.round(boundingBoxFraction.x * GRID_SIZE);
  const yStart = Math.round(boundingBoxFraction.y * GRID_SIZE);
  const xEnd = Math.round((boundingBoxFraction.x + boundingBoxFraction.width) * GRID_SIZE);
  const yEnd = Math.round((boundingBoxFraction.y + boundingBoxFraction.height) * GRID_SIZE);
  return skinRatioInRect(frame, xStart, yStart, xEnd, yEnd);
}

function boxIoU(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const interArea = interW * interH;
  const unionArea = a.width * a.height + b.width * b.height - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

export type VisualEvidence = {
  screenAreaMax: number;
  boundingFillRatioAtMax: number;
  colorVarietyScore: number;
  clusterContrast: number;
  persistenceRatio: number;
  framesAnalyzed: number;
  expectedFrames: number;
  aspectRatioPlausible: boolean;
  resolutionSufficient: boolean;
  occlusionRisk: boolean;
  humanInteractionScore: number;
  interactionRequired: boolean;
  screenVisibleRequired: boolean;
};

/**
 * A escada de classificação em si (seção 1) — pura, sem I/O, testável isoladamente com evidência
 * sintética. Nunca pula estágio: cada `return` abaixo representa o TETO alcançado por aquela
 * combinação de evidência, nunca uma suposição otimista. `compositing_ready` nunca é devolvido
 * aqui — só `pre-composition-simulator.ts` (que soma a checagem geométrica de convexidade/área)
 * pode elevar um `compositing_candidate` a `compositing_ready`.
 */
export function classifyVisualEvidence(ev: VisualEvidence): { stage: VisualValidationStage; rejectionReasons: RejectionPatternCode[] } {
  const reasons: RejectionPatternCode[] = [];

  if (ev.screenAreaMax < MIN_SCREEN_AREA_FRACTION_FLOOR) {
    if (ev.screenVisibleRequired) reasons.push("no_screen");
    return { stage: "no_device_detected", rejectionReasons: reasons };
  }

  if (!ev.aspectRatioPlausible) {
    reasons.push("wrong_device");
    return { stage: "probable_device", rejectionReasons: reasons };
  }

  const lowConfidenceSampling = ev.framesAnalyzed < 2 || ev.framesAnalyzed < Math.ceil(ev.expectedFrames / 2);
  if (lowConfidenceSampling || ev.persistenceRatio < MIN_PERSISTENCE_FOR_DEVICE) {
    return { stage: "probable_device", rejectionReasons: reasons };
  }

  const screenCoreOk = ev.screenAreaMax >= MIN_SCREEN_AREA_FRACTION && ev.boundingFillRatioAtMax >= MIN_BOUNDING_FILL_RATIO;
  if (!screenCoreOk) {
    reasons.push("screen_too_small");
    return { stage: "device_visible", rejectionReasons: reasons };
  }

  if (ev.colorVarietyScore < MIN_COLOR_VARIETY_SCORE) {
    reasons.push("visual_false_positive");
    return { stage: "probable_screen", rejectionReasons: reasons };
  }

  if (ev.persistenceRatio < MIN_PERSISTENCE_FOR_SCREEN) {
    return { stage: "probable_screen", rejectionReasons: reasons };
  }

  if (ev.clusterContrast < MIN_CLUSTER_CONTRAST) {
    return { stage: "probable_screen", rejectionReasons: reasons };
  }

  // Regra explícita da sprint (seção 4): screenVisible-level com interação extremamente baixa é,
  // por si só, sinal de falso positivo — independente de o Shot exigir interação ou não.
  if (ev.humanInteractionScore < EXTREME_LOW_INTERACTION_THRESHOLD) {
    reasons.push("visual_false_positive");
    return { stage: "needs_human_review", rejectionReasons: reasons };
  }

  if (ev.occlusionRisk) {
    reasons.push("screen_occluded");
    return { stage: "screen_visible", rejectionReasons: reasons };
  }

  if (ev.interactionRequired && ev.humanInteractionScore < MIN_INTERACTION_WHEN_REQUIRED) {
    reasons.push("interaction_missing");
    return { stage: "screen_visible", rejectionReasons: reasons };
  }

  if (!ev.resolutionSufficient) {
    return { stage: "screen_visible", rejectionReasons: reasons };
  }

  return { stage: "compositing_candidate", rejectionReasons: reasons };
}

export type VisualCandidateAnalysis = {
  stage: VisualValidationStage;
  /** Derivados do estágio — mantidos para compatibilidade com `MediaAssetRecord`/consumidores existentes (nunca calculados de forma independente do estágio). */
  screenVisible: boolean;
  screenArea: number;
  screenBoundingBoxFraction?: { x: number; y: number; width: number; height: number };
  /** Timestamp (segundos) do frame usado como referência (maior cluster) — usado por `pre-composition-simulator.ts` para gerar a prova visual real (seção 7), sem precisar re-extrair frames arbitrários. */
  referenceTimestampSeconds: number;
  deviceOrientation: "front" | "unknown";
  deviceConfidence: number;
  screenConfidence: number;
  humanPresenceScore: number;
  humanInteractionScore: number;
  colorVarietyScore: number;
  persistenceRatio: number;
  framesAnalyzed: number;
  occlusionRisk: boolean;
  sharpnessSufficient: boolean;
  resolutionSufficient: boolean;
  aspectRatioPlausible: boolean;
  rejectionReasons: RejectionPatternCode[];
};

export type VisualCandidateAnalysisOptions = {
  device?: MediaShotDeviceType;
  screenVisibleRequired?: boolean;
  interactionRequired?: boolean;
};

/**
 * Analisa MÚLTIPLOS frames reais do candidato já baixado (seção 3). Nunca lança para "não sei" —
 * devolve `undefined` só se o próprio FFmpeg falhar em extrair QUALQUER frame (arquivo corrompido,
 * já tratado antes por `readVideoMetadata`).
 */
export async function analyzeVisualCandidate(
  absolutePath: string,
  durationSeconds: number,
  width: number,
  height: number,
  options: VisualCandidateAnalysisOptions = {},
): Promise<VisualCandidateAnalysis | undefined> {
  const device = options.device ?? "none";
  const screenVisibleRequired = options.screenVisibleRequired ?? false;
  const interactionRequired = options.interactionRequired ?? false;

  const timestamps = computeTimestamps(durationSeconds);
  const frames: Buffer[] = [];
  for (const timestamp of timestamps) {
    const frame = await extractRgbFrame(absolutePath, timestamp);
    if (frame) frames.push(frame);
  }
  if (frames.length === 0) return undefined;

  const clusters = frames.map(findLargestScreenCluster);
  let referenceIndex = 0;
  for (let index = 1; index < clusters.length; index += 1) {
    if (clusters[index].screenArea > clusters[referenceIndex].screenArea) referenceIndex = index;
  }
  const reference = clusters[referenceIndex];
  const referenceFrame = frames[referenceIndex];

  const persistentFrames = clusters.filter((cluster) => {
    if (cluster.screenArea < MIN_SCREEN_AREA_FRACTION_FLOOR || !cluster.boundingBoxFraction || !reference.boundingBoxFraction) return false;
    return boxIoU(cluster.boundingBoxFraction, reference.boundingBoxFraction) >= CLUSTER_IOU_PERSISTENCE_THRESHOLD;
  }).length;
  const persistenceRatio = Math.round((persistentFrames / frames.length) * 1000) / 1000;

  const colorVarietyScore = colorVarietyOfCluster(referenceFrame, reference.clusterIndices);
  const occlusionRatio = occlusionRatioOf(referenceFrame, reference.boundingBoxFraction);
  const occlusionRisk = occlusionRatio >= OCCLUSION_SKIN_RATIO_THRESHOLD;
  const humanPresenceScore = humanPresenceScoreOf(referenceFrame);
  const humanInteractionScore = interactionScoreNear(referenceFrame, reference.boundingBoxFraction);
  const resolutionSufficient = width >= 1080 && height >= 1920;
  const sharpnessSufficient = reference.clusterContrast >= MIN_CLUSTER_CONTRAST;

  const geometry = evaluateDeviceGeometry({
    device,
    boundingBoxFraction: reference.boundingBoxFraction,
    screenArea: reference.screenArea,
    originalWidth: width,
    originalHeight: height,
  });

  const { stage, rejectionReasons } = classifyVisualEvidence({
    screenAreaMax: reference.screenArea,
    boundingFillRatioAtMax: reference.boundingFillRatio,
    colorVarietyScore,
    clusterContrast: reference.clusterContrast,
    persistenceRatio,
    framesAnalyzed: frames.length,
    expectedFrames: EXPECTED_FRAMES_SAMPLED,
    aspectRatioPlausible: device === "none" ? true : geometry.aspectPlausible,
    resolutionSufficient,
    occlusionRisk,
    humanInteractionScore,
    interactionRequired,
    screenVisibleRequired,
  });

  const screenVisible = stage === "screen_visible" || stage === "compositing_candidate" || stage === "compositing_ready";
  const screenConfidence = screenVisible
    ? Math.min(1, Math.round(((reference.screenArea / (MIN_SCREEN_AREA_FRACTION * 2)) * 0.5 + colorVarietyScore * 0.5) * 1000) / 1000)
    : Math.round(Math.min(1, reference.screenArea / (MIN_SCREEN_AREA_FRACTION * 2)) * 500) / 1000;

  return {
    stage,
    screenVisible,
    screenArea: Math.round(reference.screenArea * 1000) / 1000,
    screenBoundingBoxFraction: reference.screenArea >= MIN_SCREEN_AREA_FRACTION_FLOOR ? reference.boundingBoxFraction : undefined,
    referenceTimestampSeconds: timestamps[referenceIndex],
    deviceOrientation: screenVisible ? "front" : "unknown",
    deviceConfidence: geometry.deviceConfidence,
    screenConfidence,
    humanPresenceScore,
    humanInteractionScore,
    colorVarietyScore,
    persistenceRatio,
    framesAnalyzed: frames.length,
    occlusionRisk,
    sharpnessSufficient,
    resolutionSufficient,
    aspectRatioPlausible: device === "none" ? true : geometry.aspectPlausible,
    rejectionReasons,
  };
}
