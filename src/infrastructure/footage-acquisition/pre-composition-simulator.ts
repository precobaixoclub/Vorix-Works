import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import { polygonArea, isConvexQuad } from "../product-compositing/screen-geometry.js";
import type { VisualValidationStage } from "./visual-validation-stage.js";
import type { VisualCandidateAnalysis } from "./visual-candidate-validator.js";

/**
 * FOOTAGE VISUAL VALIDATION 2.0 (seção 7) — "Seria possível inserir uma interface do produto
 * nesta filmagem?" Só pode elevar um candidato de `compositing_candidate` (teto do Visual
 * Candidate Validator) para `compositing_ready` (seção 1) — nunca decide sozinho a partir de
 * qualquer estágio anterior, porque estágios anteriores já significam evidência insuficiente.
 * Reaproveita a MESMA geometria já usada e testada pelo Product Compositing Engine
 * (`screen-geometry.ts`) para a checagem de convexidade/área.
 *
 * Gera prova visual REAL para revisão humana: um frame anotado com o retângulo detectado (nunca
 * um quadrilátero de 4 pontos — este sistema nunca calculou perspectiva real, só um bounding box
 * alinhado aos eixos) e um recorte ampliado da região candidata. Deliberadamente NÃO gera um
 * "frame composto" com produto de verdade — isso é responsabilidade do Product Compositing Engine
 * e está fora do escopo desta sprint corretiva ("Não implementar composição final nesta sprint").
 * `compositing_ready` aqui NUNCA significa aprovado — só que o pipeline automático esgotou sua
 * evidência disponível; a aprovação real continua exclusivamente humana (seção 8).
 */

const MIN_AREA_PX2 = 2000;

export type PreCompositionArtifacts = {
  annotatedFramePath?: string;
  zoomFramePath?: string;
};

export type PreCompositionSimulationResult = {
  verdict: "SIM" | "NAO";
  justification: string;
  finalStage: VisualValidationStage;
  artifacts?: PreCompositionArtifacts;
};

export type PreCompositionSimulationInput = {
  analysis: VisualCandidateAnalysis | undefined;
  width: number;
  height: number;
  /** Presentes só quando o caller quer gerar artefatos reais de revisão (a orquestração de aquisição sempre passa; testes puros de geometria podem omitir). */
  absolutePath?: string;
  assetId?: string;
  artifactsDir?: string;
};

async function runFfmpeg(args: string[]): Promise<boolean> {
  const binaryPath = resolveFfmpegBinaryPath();
  return new Promise<boolean>((resolvePromise) => {
    const child = spawn(binaryPath, args, { windowsHide: true });
    child.on("close", (code) => resolvePromise(code === 0));
    child.on("error", () => resolvePromise(false));
  });
}

async function generateReviewArtifacts(input: {
  absolutePath: string;
  timestampSeconds: number;
  boundingBoxFraction: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
  outputDir: string;
  assetId: string;
}): Promise<PreCompositionArtifacts | undefined> {
  try {
    await mkdir(input.outputDir, { recursive: true });
  } catch {
    return undefined;
  }

  const boxX = Math.max(0, Math.round(input.boundingBoxFraction.x * input.width));
  const boxY = Math.max(0, Math.round(input.boundingBoxFraction.y * input.height));
  const boxW = Math.max(2, Math.round(input.boundingBoxFraction.width * input.width));
  const boxH = Math.max(2, Math.round(input.boundingBoxFraction.height * input.height));

  const annotatedFramePath = join(input.outputDir, `${input.assetId}-annotated.jpg`);
  const annotatedOk = await runFfmpeg([
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", input.timestampSeconds.toFixed(2), "-i", input.absolutePath,
    "-frames:v", "1", "-vf", `drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=red@0.9:thickness=4`,
    "-q:v", "3", annotatedFramePath,
  ]);

  const zoomFramePath = join(input.outputDir, `${input.assetId}-zoom.jpg`);
  const zoomOk = await runFfmpeg([
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", input.timestampSeconds.toFixed(2), "-i", input.absolutePath,
    "-frames:v", "1", "-vf", `crop=${boxW}:${boxH}:${boxX}:${boxY},scale=${boxW * 3}:${boxH * 3}:flags=neighbor`,
    "-q:v", "3", zoomFramePath,
  ]);

  return { annotatedFramePath: annotatedOk ? annotatedFramePath : undefined, zoomFramePath: zoomOk ? zoomFramePath : undefined };
}

export async function simulatePreComposition(input: PreCompositionSimulationInput): Promise<PreCompositionSimulationResult> {
  const { analysis, width, height } = input;
  if (!analysis) {
    return {
      verdict: "NAO",
      justification: "Não foi possível analisar frames reais do candidato (falha de extração) — sem evidência visual, não há como simular composição.",
      finalStage: "rejected",
    };
  }

  if (analysis.stage !== "compositing_candidate") {
    return {
      verdict: "NAO",
      justification: `Estágio de validação visual ("${analysis.stage}") não chegou a "compositing_candidate" — a combinação de evidências (geometria, persistência entre frames, variedade de cor dentro da região, interação, oclusão) ainda não é suficiente para justificar sequer tentar a composição. Nunca aprovado só por brilho/contraste isolado.`,
      finalStage: analysis.stage,
    };
  }
  if (!analysis.screenBoundingBoxFraction) {
    return { verdict: "NAO", justification: "Nenhuma região candidata a tela com geometria válida.", finalStage: analysis.stage };
  }

  const box = analysis.screenBoundingBoxFraction;
  const corners: [number, number][] = [
    [box.x * width, box.y * height],
    [(box.x + box.width) * width, box.y * height],
    [(box.x + box.width) * width, (box.y + box.height) * height],
    [box.x * width, (box.y + box.height) * height],
  ];

  if (!isConvexQuad(corners)) {
    return { verdict: "NAO", justification: "A região candidata não forma um quadrilátero geometricamente válido — provável falso positivo residual da heurística de detecção.", finalStage: analysis.stage };
  }

  const area = polygonArea(corners);
  if (area < MIN_AREA_PX2) {
    return { verdict: "NAO", justification: `Área da região candidata (${Math.round(area)}px²) abaixo do mínimo (${MIN_AREA_PX2}px²) — tela pequena demais para uma composição legível.`, finalStage: analysis.stage };
  }

  let artifacts: PreCompositionArtifacts | undefined;
  if (input.absolutePath && input.assetId && input.artifactsDir) {
    artifacts = await generateReviewArtifacts({
      absolutePath: input.absolutePath,
      timestampSeconds: analysis.referenceTimestampSeconds,
      boundingBoxFraction: box,
      width, height,
      outputDir: input.artifactsDir,
      assetId: input.assetId,
    });
  }

  return {
    verdict: "SIM",
    justification: `Todas as evidências combinadas sustentam avançar a "compositing_ready": geometria plausível (deviceConfidence=${analysis.deviceConfidence.toFixed(2)}), persistência ${Math.round(analysis.persistenceRatio * 100)}% entre ${analysis.framesAnalyzed} frame(s), variedade de cor interna ${analysis.colorVarietyScore.toFixed(2)}, sem oclusão crítica, interação=${analysis.humanInteractionScore.toFixed(2)}, área geométrica válida (${Math.round(area)}px²). Ainda assim NUNCA aprovado automaticamente — exige revisão humana (seção 8) antes de contar para verifiedCompositingCoverage.`,
    finalStage: "compositing_ready",
    artifacts,
  };
}
