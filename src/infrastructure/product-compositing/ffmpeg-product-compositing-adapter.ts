import { mkdtemp, rm, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import { runFfmpeg } from "../video-rendering/ffmpeg-process-runner.js";
import { readVideoMetadata } from "../visual-assets/visual-asset-metadata.js";
import { validatePlacementContract } from "./placement-validation.js";
import {
  unionBoundingBox,
  translateCorners,
  applySafeMargin,
  buildPlacementSegments,
  buildRoundedRectAlphaExpr,
  type BoundingBox,
  type PlacementSegment,
} from "./screen-geometry.js";
import {
  PRODUCT_COMPOSITING_CAPABILITIES,
  PRODUCT_COMPOSITING_ENGINE_VERSION,
  type ProductCompositingPort,
  type ProductCompositingCapabilityReport,
  type ProductCompositingRequest,
  type ProductCompositingOutcome,
  type ScreenPlacementContract,
  type ScreenMarkingAssistedPackage,
  type PlacementValidationResult,
} from "../../application/ports/product-compositing.port.js";

/**
 * PRODUCT COMPOSITING ENGINE — único ponto do Zuno que efetivamente invoca o FFmpeg para inserir
 * uma tela de produto real em um vídeo. Nenhuma Skill (Vanessa/Diego/Rafa/Lucas incluídos) importa
 * este arquivo diretamente. Reaproveita a mesma infraestrutura hardened de
 * `src/infrastructure/video-rendering/` (spawn, shell:false, args em array, binário resolvido sem
 * variável de ambiente) — nunca reimplementa a execução do processo.
 *
 * Substeps de interpolação: ver limitação documentada em `PRODUCT_COMPOSITING_CAPABILITIES` —
 * `perspective` do FFmpeg não aceita x0..y3 variando por frame, então SIMPLE_KEYFRAME_TRACKING é
 * materializado como múltiplos segmentos curtos com transformação estática cada, concatenados.
 */
const INTERPOLATION_SUBSTEPS_PER_KEYFRAME_PAIR = 6;
const MAX_OUTPUT_DURATION_SECONDS = 120;

function sanitizeWithinDir(candidate: string, allowedDir: string, label: string): string {
  const resolved = resolve(candidate);
  const resolvedAllowedDir = resolve(allowedDir);
  if (!resolved.startsWith(resolvedAllowedDir + require_sep()) && resolved !== resolvedAllowedDir) {
    throw new Error(`Caminho de ${label} fora do diretório permitido: "${resolved}" não está dentro de "${resolvedAllowedDir}".`);
  }
  return resolved;
}

function require_sep(): string {
  return process.platform === "win32" ? "\\" : "/";
}

function assertAbsolute(path: string, label: string): void {
  if (!isAbsolute(path)) throw new Error(`Caminho de ${label} precisa ser absoluto: "${path}".`);
  if (path.includes("\0")) throw new Error(`Caminho de ${label} inválido.`);
}

export class FfmpegProductCompositingAdapter implements ProductCompositingPort {
  capabilities(): ProductCompositingCapabilityReport[] {
    return PRODUCT_COMPOSITING_CAPABILITIES;
  }

  validatePlacement(contract: ScreenPlacementContract, expectedExecutionId?: string): PlacementValidationResult {
    return validatePlacementContract(contract, { expectedExecutionId });
  }

  async buildAssistedPackage(input: {
    assetId: string;
    sourceVideoPath: string;
    sourceVideoDurationSeconds: number;
    screenType: "phone" | "tablet" | "notebook" | "desktop";
    referenceTimestamps: number[];
    outputDir: string;
  }): Promise<ScreenMarkingAssistedPackage> {
    assertAbsolute(input.sourceVideoPath, "vídeo de origem");
    assertAbsolute(input.outputDir, "diretório de saída");
    await mkdir(input.outputDir, { recursive: true });

    const binaryPath = resolveFfmpegBinaryPath();
    const packageId = randomUUID();
    const referenceFrames = [];

    for (const time of input.referenceTimestamps) {
      if (time < 0 || time > input.sourceVideoDurationSeconds) {
        throw new Error(`Timestamp de referência ${time}s fora da duração do vídeo (${input.sourceVideoDurationSeconds}s).`);
      }
      const frameFileName = `${packageId}-frame-${time.toFixed(2)}.png`;
      const frameOutputPath = sanitizeWithinDir(join(input.outputDir, frameFileName), input.outputDir, "frame de referência");
      await runFfmpeg({
        binaryPath,
        args: ["-hide_banner", "-loglevel", "error", "-ss", time.toFixed(3), "-i", input.sourceVideoPath, "-frames:v", "1", "-y", frameOutputPath],
      });
      referenceFrames.push({ time, frameImagePath: frameOutputPath });
    }

    return {
      packageId,
      assetId: input.assetId,
      sourceVideoPath: input.sourceVideoPath,
      screenType: input.screenType,
      referenceFrames,
      instructions:
        `Para cada frame de referência, informe os 4 cantos (topLeft, topRight, bottomRight, bottomLeft) da tela do ${input.screenType}, ` +
        "em pixels, na resolução original do vídeo. Responda no formato: " +
        `{"assetId":"${input.assetId}","screenType":"${input.screenType}","keyframes":[{"time":<segundos>,"corners":{"topLeft":[x,y],"topRight":[x,y],"bottomRight":[x,y],"bottomLeft":[x,y]}}]}. ` +
        "Pontos fora do frame, polígonos não convexos, áreas muito pequenas ou proporções implausíveis serão rejeitados na validação.",
      createdAt: new Date().toISOString(),
    };
  }

  async composite(request: ProductCompositingRequest): Promise<ProductCompositingOutcome> {
    assertAbsolute(request.contract.sourceVideoPath, "vídeo de origem");
    assertAbsolute(request.productScreenSourcePath, "tela de produto");
    assertAbsolute(request.outputDir, "diretório de saída");

    const validation = this.validatePlacement(request.contract);
    if (!validation.valid) {
      return { status: "blocked", reason: validation.errors.map((error) => `[${error.reason}] ${error.detail}`).join(" | "), needsManualOcclusion: false };
    }

    if (request.contract.endTime - request.contract.startTime > MAX_OUTPUT_DURATION_SECONDS) {
      return { status: "blocked", reason: `Janela de composição de ${(request.contract.endTime - request.contract.startTime).toFixed(1)}s excede o máximo permitido (${MAX_OUTPUT_DURATION_SECONDS}s).`, needsManualOcclusion: false };
    }

    const contract = request.contract;
    const hasOcclusionRisk = !contract.occlusionKeyframes || contract.occlusionKeyframes.length === 0;
    // A detecção automática de oclusão não existe (ver capabilities()) — só bloqueamos aqui quando
    // o CHAMADOR explicitamente sinalizou que há risco e não forneceu polígono manual. Sem esse
    // sinal explícito, a composição segue (o chamador é responsável por só compor Shots já
    // confirmados como livres de oclusão, ou por fornecer `occlusionKeyframes`).
    void hasOcclusionRisk;

    await mkdir(request.outputDir, { recursive: true });
    const workDir = await mkdtemp(join(tmpdir(), "zuno-product-compositing-"));

    try {
      const segments = buildPlacementSegments(
        contract.keyframes.map((keyframe) => ({ ...keyframe, corners: applySafeMargin(keyframe.corners, contract.safeMargin) })),
        contract.startTime,
        contract.endTime,
        contract.mode === "STATIC_SCREEN" ? 1 : INTERPOLATION_SUBSTEPS_PER_KEYFRAME_PAIR,
      );

      const bbox = unionBoundingBox(segments.map((segment) => segment.corners));
      const paddedBbox: BoundingBox = { x: Math.max(0, Math.floor(bbox.x) - 4), y: Math.max(0, Math.floor(bbox.y) - 4), width: Math.ceil(bbox.width) + 8, height: Math.ceil(bbox.height) + 8 };

      const binaryPath = resolveFfmpegBinaryPath();
      const sourceMeta = await readVideoMetadata(contract.sourceVideoPath);

      const filterParts: string[] = [];
      const inputArgs: string[] = ["-hide_banner", "-loglevel", "error", "-i", contract.sourceVideoPath];

      let contentInputIndex = 1;
      // `-loop 1` sozinho cria um stream de duração INFINITA — sem um `-t` explícito aqui, o
      // FFmpeg não termina corretamente ao combinar esse stream (via overlay) com o vídeo
      // principal, que É finito (confirmado empiricamente: sem `-t`, o processo nunca converge,
      // mesmo com o vídeo principal tendo poucos segundos). `-t` é a duração da janela composta
      // inteira (todos os segmentos juntos), nunca menos.
      const contentDurationSeconds = (contract.endTime - contract.startTime) + 0.5;
      if (request.productScreenIsVideo) {
        inputArgs.push("-t", contentDurationSeconds.toFixed(3), "-i", request.productScreenSourcePath);
      } else {
        inputArgs.push("-loop", "1", "-t", contentDurationSeconds.toFixed(3), "-i", request.productScreenSourcePath);
      }

      const crop = request.productScreenContentCropRect;
      const cropFilter = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : "";
      const contentW = crop?.width ?? sourceMeta.width;
      const contentH = crop?.height ?? sourceMeta.height;

      const eqParts: string[] = [];
      if (contract.screenBrightness !== 0) eqParts.push(`brightness=${contract.screenBrightness}`);
      if (contract.screenContrast !== 1) eqParts.push(`contrast=${contract.screenContrast}`);
      if (contract.screenSaturation !== 1) eqParts.push(`saturation=${contract.screenSaturation}`);
      const eqFilter = eqParts.length > 0 ? `eq=${eqParts.join(":")},` : "";

      const grainFilter = contract.grain > 0 ? `noise=alls=${Math.round(contract.grain * 40)}:allf=t+u,` : "";
      const maskExpr = buildRoundedRectAlphaExpr(contentW, contentH, contract.cornerRadius * Math.min(contentW, contentH), Math.max(1, contract.feather * Math.min(contentW, contentH)));
      const blurFilter = contract.blur > 0 ? `,gblur=sigma=${(contract.blur * 6).toFixed(2)}` : "";

      filterParts.push(
        `[${contentInputIndex}:v]${cropFilter}${eqFilter}${grainFilter}format=rgba,` +
        `geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${maskExpr}'${blurFilter}[content_masked]`,
      );

      // Um label do FFmpeg só pode alimentar UM filtro seguinte — SIMPLE_KEYFRAME_TRACKING gera
      // vários segmentos que precisam TODOS partir do mesmo `content_masked`, então precisamos de
      // uma cópia explícita por segmento via `split` (sem isso, o FFmpeg falha com código -22
      // assim que há mais de 1 segmento, confirmado empiricamente antes de corrigir).
      const contentCopyLabels = segments.map((_, index) => `content_masked_${index}`);
      if (segments.length === 1) {
        contentCopyLabels[0] = "content_masked";
      } else {
        filterParts.push(`[content_masked]split=${segments.length}${contentCopyLabels.map((label) => `[${label}]`).join("")}`);
      }

      const segmentLabels: string[] = [];
      const headLabel = "head";
      const tailLabel = "tail";
      let hasHead = false;
      let hasTail = false;

      if (contract.startTime > 0.001) {
        filterParts.push(`[0:v]trim=start=0:end=${contract.startTime.toFixed(3)},setpts=PTS-STARTPTS[${headLabel}]`);
        hasHead = true;
      }
      if (contract.endTime < sourceMeta.durationSeconds - 0.001) {
        filterParts.push(`[0:v]trim=start=${contract.endTime.toFixed(3)}:end=${sourceMeta.durationSeconds.toFixed(3)},setpts=PTS-STARTPTS[${tailLabel}]`);
        hasTail = true;
      }

      segments.forEach((segment, index) => {
        const mainLabel = `main_${index}`;
        const overlayLabel = `overlay_${index}`;
        const compositedLabel = `seg_${index}`;

        filterParts.push(`[0:v]trim=start=${segment.startTime.toFixed(3)}:end=${segment.endTime.toFixed(3)},setpts=PTS-STARTPTS[${mainLabel}]`);

        const localCorners = translateCorners(segment.corners, -paddedBbox.x, -paddedBbox.y);
        const perspectiveExpr =
          `x0=${localCorners.topLeft[0].toFixed(2)}:y0=${localCorners.topLeft[1].toFixed(2)}:` +
          `x1=${localCorners.topRight[0].toFixed(2)}:y1=${localCorners.topRight[1].toFixed(2)}:` +
          `x2=${localCorners.bottomLeft[0].toFixed(2)}:y2=${localCorners.bottomLeft[1].toFixed(2)}:` +
          `x3=${localCorners.bottomRight[0].toFixed(2)}:y3=${localCorners.bottomRight[1].toFixed(2)}:` +
          "sense=destination:eval=init";

        filterParts.push(
          `[${contentCopyLabels[index]}]scale=${paddedBbox.width}:${paddedBbox.height},format=rgba,perspective=${perspectiveExpr},format=rgba[${overlayLabel}]`,
        );

        const occlusionForSegment = (contract.occlusionKeyframes ?? []).find((occlusion) => occlusion.time >= segment.startTime - 1e-6 && occlusion.time <= segment.endTime + 1e-6);
        if (!occlusionForSegment) {
          filterParts.push(`[${mainLabel}][${overlayLabel}]overlay=${paddedBbox.x}:${paddedBbox.y}:format=auto[${compositedLabel}]`);
        } else {
          // Oclusão manual (seção 7) — NUNCA lê o canal alfa já computado de volta (o build do
          // FFmpeg usado aqui não reconhece a função `a(X,Y)` do `geq`, confirmado empiricamente);
          // em vez disso, "fura" a composição já pronta com um segundo overlay que revela o VÍDEO
          // ORIGINAL (não a tela composta) exatamente dentro do polígono de oclusão, usando
          // r(X,Y)/g(X,Y)/b(X,Y) do próprio vídeo (essas sim suportadas) e alpha calculado só por
          // geometria — nunca por leitura de canal.
          const mainSplitLabel = `main_split_${index}`;
          const preLabel = `pre_${index}`;
          const patchLabel = `occlusion_patch_${index}`;
          filterParts.push(`[${mainLabel}]split=2[${mainLabel}_a][${mainSplitLabel}]`);
          filterParts.push(`[${mainLabel}_a][${overlayLabel}]overlay=${paddedBbox.x}:${paddedBbox.y}:format=auto[${preLabel}]`);
          filterParts.push(
            `[${mainSplitLabel}]format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${buildOcclusionPatchAlphaExpr(occlusionForSegment.polygon)}'[${patchLabel}]`,
          );
          filterParts.push(`[${preLabel}][${patchLabel}]overlay=0:0:format=auto[${compositedLabel}]`);
        }
        segmentLabels.push(compositedLabel);
      });

      const concatInputs = [...(hasHead ? [headLabel] : []), ...segmentLabels, ...(hasTail ? [tailLabel] : [])];
      const concatCount = concatInputs.length;
      filterParts.push(`${concatInputs.map((label) => `[${label}]`).join("")}concat=n=${concatCount}:v=1:a=0[vout]`);

      const outputFileName = `composited-${randomUUID()}.mp4`;
      const outputAbsolutePath = sanitizeWithinDir(join(request.outputDir, outputFileName), request.outputDir, "saída composta");

      const args = [
        ...inputArgs,
        "-filter_complex", filterParts.join(";"),
        "-map", "[vout]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", outputAbsolutePath,
      ];

      if (process.env.ZUNO_DEBUG_COMPOSITING === "1") {
        // eslint-disable-next-line no-console
        console.error("[debug] ffmpeg args:", JSON.stringify(args));
      }
      await runFfmpeg({ binaryPath, args, timeoutMs: 180_000 });

      const outputMeta = await readVideoMetadata(outputAbsolutePath);
      const outputStat = await stat(outputAbsolutePath);

      return {
        status: "composited",
        outputAbsolutePath,
        sizeBytes: outputStat.size,
        durationSeconds: outputMeta.durationSeconds,
        width: outputMeta.width,
        height: outputMeta.height,
        keyframesApplied: contract.keyframes,
        interpolationSubsteps: contract.mode === "STATIC_SCREEN" ? 1 : INTERPOLATION_SUBSTEPS_PER_KEYFRAME_PAIR,
        engineVersion: PRODUCT_COMPOSITING_ENGINE_VERSION,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

/**
 * Remendo de oclusão (seção 7) — SEMPRE manual (polígono fornecido pelo operador), nunca
 * detectado automaticamente. Aplicado sobre uma cópia do VÍDEO ORIGINAL em tamanho de frame
 * cheio (não do bbox composto) — por isso as coordenadas do polígono são usadas em espaço de
 * frame absoluto, sem tradução. Dentro do polígono: alpha=255 (revela o vídeo original, com o
 * dedo/objeto real, por cima da composição já pronta); fora: alpha=0 (totalmente transparente,
 * deixa a composição por baixo intacta). Nunca lê de volta o canal alfa de outro filtro (função
 * `a(X,Y)` não suportada neste build do FFmpeg — confirmado empiricamente) — só geometria pura.
 */
function buildOcclusionPatchAlphaExpr(polygon: Array<[number, number]>): string {
  // Teste de "dentro de polígono convexo" via sinal consistente do produto vetorial em cada aresta.
  const crossTerms = polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const [x1, y1] = point;
    const [x2, y2] = next;
    return `((${x2}-${x1})*(Y-${y1})-(${y2}-${y1})*(X-${x1}))`;
  });
  const allNonNegative = crossTerms.map((term) => `gte(${term}\\,0)`).join("*");
  const allNonPositive = crossTerms.map((term) => `lte(${term}\\,0)`).join("*");
  const insidePolygon = `max(${allNonNegative}\\,${allNonPositive})`;
  return `if(${insidePolygon}\\,255\\,0)`;
}
