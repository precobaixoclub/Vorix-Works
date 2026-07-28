import { spawn } from "node:child_process";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import type { MediaFootageClassification } from "../../application/ports/media-catalog.port.js";

/**
 * MEDIA INTELLIGENCE ENGINE (seção 7) — heurística real (não simulada) para detectar vídeo
 * proceduralmente gerado: extrai um frame do meio do vídeo, reduz para 32x32 em tons de cinza e
 * mede a energia de borda (soma das diferenças absolutas entre pixels vizinhos). Gradientes
 * `gradients=`/fundos procedurais têm transição suave — energia de borda muito baixa mesmo com
 * zoom/drift aplicado por cima. Fotografia/filmagem real tem textura, ruído e detalhe — energia de
 * borda consistentemente mais alta.
 *
 * IMPORTANTE — o que esta função NUNCA faz: nunca classifica um vídeo como `filmed_footage` ou
 * `generated_video` de alta qualidade automaticamente. Alta energia de borda apenas significa "não
 * é obviamente procedural" — não prova que é filmagem real. Só confirma `procedural_background`
 * com confiança (limiar deliberadamente conservador); qualquer coisa acima do limiar fica
 * `undefined` (não classificado), exigindo classificação manual via `--media-tag`/revisão humana
 * antes de contar como filmagem real na métrica Video Coverage. Isto é uma escolha de design
 * deliberada: é seguro afirmar "isto é sintético" a partir de pixels; não é seguro afirmar "isto é
 * uma filmagem real" a partir de pixels sozinhos.
 */

const PROCEDURAL_EDGE_ENERGY_THRESHOLD = 4.0;
const FRAME_SAMPLE_SIZE = 32;

async function extractGrayFrame(absolutePath: string, timestampSeconds: number, size = FRAME_SAMPLE_SIZE): Promise<Buffer | undefined> {
  const binaryPath = resolveFfmpegBinaryPath();
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-ss", timestampSeconds.toFixed(2),
    "-i", absolutePath,
    "-frames:v", "1",
    "-vf", `scale=${size}:${size}:flags=area,format=gray`,
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

function edgeEnergyOf(pixels: Buffer, size: number): number {
  let totalDelta = 0;
  let samples = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const index = row * size + col;
      totalDelta += Math.abs(pixels[index] - pixels[index + 1]);
      samples += 1;
    }
  }
  for (let col = 0; col < size; col += 1) {
    for (let row = 0; row < size - 1; row += 1) {
      const index = row * size + col;
      totalDelta += Math.abs(pixels[index] - pixels[index + size]);
      samples += 1;
    }
  }
  return samples > 0 ? totalDelta / samples : 0;
}

function meanAbsoluteDifference(frameA: Buffer, frameB: Buffer): number {
  const length = Math.min(frameA.byteLength, frameB.byteLength);
  if (length === 0) return 0;
  let total = 0;
  for (let index = 0; index < length; index += 1) total += Math.abs(frameA[index] - frameB[index]);
  return total / length;
}

export async function classifyVideoFootage(absolutePath: string): Promise<{ classification: MediaFootageClassification | undefined; edgeEnergy?: number }> {
  const pixels = await extractGrayFrame(absolutePath, 0.5);
  if (!pixels || pixels.byteLength < FRAME_SAMPLE_SIZE * FRAME_SAMPLE_SIZE) return { classification: undefined };

  const edgeEnergy = edgeEnergyOf(pixels, FRAME_SAMPLE_SIZE);
  if (edgeEnergy < PROCEDURAL_EDGE_ENERGY_THRESHOLD) {
    return { classification: "procedural_background", edgeEnergy };
  }
  return { classification: undefined, edgeEnergy };
}

const MIN_TEMPORAL_VARIATION = 0.5;

export type RealFootageEvidence = {
  hasValidFrames: boolean;
  edgeEnergy?: number;
  temporalVariationScore?: number;
  hasTemporalVariation: boolean;
  looksProceduralByEdgeEnergy: boolean;
};

/**
 * REAL FOOTAGE ACQUISITION (seção 7) — validação técnica pós-download: extrai DOIS frames reais
 * em pontos diferentes do vídeo (não só um) e mede a diferença média de pixel entre eles
 * (`temporalVariationScore`) — um vídeo corrompido, congelado ou com um único frame repetido
 * produz variação ~0; filmagem real sempre tem alguma variação temporal genuína. Combinado com a
 * energia de borda (`classifyVideoFootage`) para também descartar conteúdo procedural disfarçado.
 * Não decide sozinho a classificação final — só reúne evidência real e mensurável, registrada
 * junto com o registro do asset (nunca uma alegação sem evidência).
 */
export async function gatherRealFootageEvidence(absolutePath: string, durationSeconds: number): Promise<RealFootageEvidence> {
  const firstTimestamp = Math.min(0.3, Math.max(0, durationSeconds * 0.1));
  const secondTimestamp = Math.max(firstTimestamp + 0.2, Math.min(durationSeconds - 0.1, durationSeconds * 0.7));

  const [frameA, frameB] = await Promise.all([
    extractGrayFrame(absolutePath, firstTimestamp),
    extractGrayFrame(absolutePath, secondTimestamp),
  ]);

  if (!frameA || !frameB || frameA.byteLength < FRAME_SAMPLE_SIZE * FRAME_SAMPLE_SIZE || frameB.byteLength < FRAME_SAMPLE_SIZE * FRAME_SAMPLE_SIZE) {
    return { hasValidFrames: false, hasTemporalVariation: false, looksProceduralByEdgeEnergy: false };
  }

  const edgeEnergy = edgeEnergyOf(frameA, FRAME_SAMPLE_SIZE);
  const temporalVariationScore = meanAbsoluteDifference(frameA, frameB);

  return {
    hasValidFrames: true,
    edgeEnergy,
    temporalVariationScore,
    hasTemporalVariation: temporalVariationScore >= MIN_TEMPORAL_VARIATION,
    looksProceduralByEdgeEnergy: edgeEnergy < PROCEDURAL_EDGE_ENERGY_THRESHOLD,
  };
}
