import type {
  VideoAudioTrack,
  VideoMotionElement,
  VideoOverlayRole,
  VideoRenderAsset,
  VideoRenderRequest,
  VideoRenderScene,
  VideoSceneTransition,
} from "../../application/ports/video-rendering.port.js";
import { normalizeShotTimelineForRender, projectClipsAsRenderScenes, type ShotRenderPlan } from "./shot-render-planner.js";
// NARRATIVE TIMING REBALANCING — movidas para `shared/utils/video-timing-constants.ts` (ADR 0001)
// e reexportadas aqui para não quebrar nenhum import existente; `timing-rebalancing/*` importa
// da fonte compartilhada diretamente, nunca desta cópia.
import { CUT_CROSSFADE_SECONDS, DEFAULT_CROSSFADE_SECONDS, XFADE_TRANSITION_BY_STYLE } from "../../shared/utils/video-timing-constants.js";

export { CUT_CROSSFADE_SECONDS, DEFAULT_CROSSFADE_SECONDS, XFADE_TRANSITION_BY_STYLE };
const HEADLINE_COLOR = "#FFFFFF";
const CAPTION_COLOR = "#FFFFFF";
const CTA_COLOR = "#FFFFFF";
const DEFAULT_DUCK_AMOUNT = 0.5;
const DEFAULT_DUCK_DURATION_SECONDS = 0.6;
const FINAL_AUDIO_FILTER = "aresample=44100,aformat=sample_rates=44100:channel_layouts=stereo,alimiter=limit=0.95";

/**
 * Traduz o estilo de transição explícito de Diego (`VideoSceneTransition`) para o nome real do
 * efeito `xfade` do FFmpeg, e a duração-alvo do crossfade — antes desta tabela, toda transição
 * renderizava literalmente como `transition=fade`, não importa o que fosse pedido a montante.
 * (Definida em `shared/utils/video-timing-constants.ts`, importada acima.)
 */

const FONT_SIZE_BY_ROLE: Record<VideoOverlayRole, number> = { headline: 68, cta: 58, caption: 38 };
const MOTION_FONT_SIZE_BY_ROLE: Record<string, number> = {
  headline: 72,
  subtitle: 42,
  caption: 34,
  card: 34,
  cta: 54,
  logo: 32,
};
/** Heurística de largura média de glifo (fração do fontSize) para as fontes serifadas usadas no drawtext — calibrada visualmente, não uma métrica exata de fonte. */
const AVG_CHAR_WIDTH_FACTOR = 0.52;
const USABLE_WIDTH_RATIO = 0.78;

export type OverlayTextFileKey = string;

/**
 * Quebra o texto do overlay em múltiplas linhas para nunca ultrapassar a largura do quadro — sem
 * isso, um `onScreenText`/`captionText` mais longo (comum em frases completas de Bruno/Diego)
 * ultrapassava a borda da tela dos dois lados, um bug real encontrado durante a validação desta
 * implementação. `text_align=center` (aplicado no filtro) centraliza cada linha resultante.
 */
export function wrapOverlayText(role: VideoOverlayRole, text: string, canvasWidth: number): string {
  const fontSize = FONT_SIZE_BY_ROLE[role];
  const usableWidth = canvasWidth * USABLE_WIDTH_RATIO;
  const maxCharsPerLine = Math.max(8, Math.floor(usableWidth / (fontSize * AVG_CHAR_WIDTH_FACTOR)));
  return wrapWords(text.trim(), maxCharsPerLine);
}

function wrapWords(text: string, maxCharsPerLine: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

export type FontFilePaths = {
  regular: string;
  bold: string;
};

export type CompileFfmpegArgsInput = {
  request: VideoRenderRequest;
  /** Caminho absoluto do arquivo .txt (UTF-8) já escrito em disco para cada overlay de texto, por cena/papel. */
  overlayTextFiles: Map<OverlayTextFileKey, string>;
  outputAbsolutePath: string;
  fonts: FontFilePaths;
  /** Resultado do probe de capacidade (ver `probeFfmpegCapabilities`) — decide fundo gradiente real vs. fallback sólido. */
  supportsGradients: boolean;
};

/**
 * Monta os argumentos do FFmpeg (array, nunca string de shell) a partir de um `VideoRenderRequest`
 * já totalmente resolvido (assets validados, textos já escritos em arquivo). Função pura e
 * testável isoladamente, sem nunca executar nada — quem executa é `ffmpeg-process-runner.ts`.
 */
export function compileFfmpegArgs(input: CompileFfmpegArgsInput): string[] {
  return compileFfmpegArgsWithPlan(input).args;
}

/**
 * SHOT RENDER ENGINE — variante que retorna também o plano normalizado (clipes achatados a
 * partir do `shotTimeline` de cada cena). O adapter usa isso para gerar o `shot-render-plan.json`
 * e o `execution-report` com métricas por Shot (renderedShots, unsupportedMotionFallbacks, etc.).
 * O comportamento de renderização é idêntico ao `compileFfmpegArgs`.
 */
export function compileFfmpegArgsWithPlan(input: CompileFfmpegArgsInput): { args: string[]; plan: ShotRenderPlan } {
  const { request, fonts } = input;
  const assetsById = new Map<string, VideoRenderAsset>(request.assets.map((asset) => [asset.id, asset]));

  // SHOT RENDER ENGINE — cenas com `shotTimeline` são achatadas em clipes de Shot antes de o
  // compilador enxergar qualquer coisa. Do ponto de vista do resto deste arquivo, `scenes` é
  // apenas uma lista sequencial de blocos independentes; o compilador não sabe (nem precisa
  // saber) se cada bloco veio de um Shot ou de uma cena legada. Isso faz a fronteira scene↔shot
  // cair exatamente aqui, sem duplicar o filter graph.
  const plan = normalizeShotTimelineForRender(request);
  const scenes = projectClipsAsRenderScenes(plan.clips);

  const inputArgs: string[] = [];
  const filterParts: string[] = [];
  let inputIndex = 0;

  // Cada asset de logo referenciado por qualquer cena vira UM único input reaproveitado por
  // todas as cenas que o usam (em vez de duplicar o mesmo arquivo como input várias vezes), já
  // redimensionado uma única vez para uma label própria (`logoN`) referenciada pelo overlay.
  const logoAssetIds = new Set(scenes.map((scene) => scene.logo?.assetId).filter((id): id is string => Boolean(id)));
  const logoLabelByAssetId = new Map<string, string>();
  const logoTargetWidth = Math.round(Math.min(request.width, request.height) * 0.22);
  for (const assetId of logoAssetIds) {
    const asset = assetsById.get(assetId);
    if (!asset) throw new Error(`Asset de logo não resolvido: ${assetId}`);
    const logoInputIndex = inputIndex;
    inputArgs.push("-loop", "1", "-t", request.totalDurationSeconds.toFixed(3), "-i", asset.absolutePath);
    inputIndex += 1;

    const logoLabel = `logo${logoInputIndex}`;
    filterParts.push(`[${logoInputIndex}:v]format=rgba,scale=${logoTargetWidth}:-1[${logoLabel}]`);
    logoLabelByAssetId.set(assetId, logoLabel);
  }

  const motionAssetInputByElementKey = new Map<string, number>();
  for (const scene of scenes) {
    for (const element of scene.motion?.elements ?? []) {
      if (!element.assetId) continue;
      const asset = assetsById.get(element.assetId);
      if (!asset) throw new Error(`Asset de motion não resolvido: ${element.assetId}`);
      const motionInputIndex = inputIndex;
      inputArgs.push(...buildMotionAssetInputArgs(asset, scene.durationSeconds));
      inputIndex += 1;
      motionAssetInputByElementKey.set(motionElementKey(scene.order, element.id), motionInputIndex);
    }
  }

  // Light sweep: uma faixa de luz diagonal atravessando o quadro, gerada como um input `gradients`
  // sintético próprio (mesma fonte já usada para fundos em gradiente) e composta por cima via
  // `blend=screen` — só existe input extra para cenas que realmente pedem o efeito
  // (`entrance: "light_sweep"` em algum elemento de motion), e só quando o probe de capacidade já
  // confirmou que este FFmpeg suporta o filtro `gradients` (mesma guarda de `supportsGradients`
  // usada para fundos, degrada graciosamente na ausência dele).
  const lightSweepInputByScene = new Map<number, number>();
  if (input.supportsGradients) {
    for (const scene of scenes) {
      const wantsSweep = (scene.motion?.elements ?? []).some((element) => element.entrance === "light_sweep");
      if (!wantsSweep) continue;
      const sweepInputIndex = inputIndex;
      const sweepWidth = Math.round(request.width * 0.32);
      inputArgs.push(
        "-f",
        "lavfi",
        "-i",
        `gradients=s=${sweepWidth}x${request.height}:d=${scene.durationSeconds.toFixed(3)}:r=${request.fps}:c0=0x000000:c1=0xFFFFFF:c2=0x000000:x0=0:y0=0:x1=${sweepWidth}:y1=0`,
      );
      inputIndex += 1;
      lightSweepInputByScene.set(scene.order, sweepInputIndex);
    }
  }

  const sceneVideoLabels: string[] = [];

  for (const scene of scenes) {
    const sourceInputIndex = inputIndex;
    inputArgs.push(...buildSceneSourceInputArgs(scene, request.width, request.height, request.fps, assetsById, input.supportsGradients));
    inputIndex += 1;

    const chainLabel = `s${scene.order}`;
    const chainFilters = buildSceneFilterChain({
      scene,
      sourceInputIndex,
      width: request.width,
      height: request.height,
      fps: request.fps,
      overlayTextFiles: input.overlayTextFiles,
      fonts,
      outputLabel: chainLabel,
      logoLabelByAssetId,
      motionAssetInputByElementKey,
      lightSweepInputIndex: lightSweepInputByScene.get(scene.order),
    });
    filterParts.push(...chainFilters);
    sceneVideoLabels.push(chainLabel);
  }

  const { filters: transitionFilters, outputLabel: videoOutputLabel } = buildTransitionChain(scenes, sceneVideoLabels);
  filterParts.push(...transitionFilters);

  const audioResult = buildAudioGraph(request, assetsById, inputArgs, () => {
    const index = inputIndex;
    inputIndex += 1;
    return index;
  });
  filterParts.push(...audioResult.filters);

  const filterComplex = filterParts.join(";");

  const args: string[] = [...inputArgs, "-filter_complex", filterComplex, "-map", `[${videoOutputLabel}]`];

  if (audioResult.outputLabel) {
    // SHOT RENDER ENGINE — NUNCA usar `-shortest`. O flag `-shortest` corta o vídeo quando o
    // áudio termina antes, o que já causou truncamento do end card (o áudio de narração acabava
    // e o vídeo era cortado no meio do CTA). A duração final é governada por `-t` do vídeo; a
    // trilha (que roda em loop infinito) é limitada pelo mesmo `-t`. A narração e os SFX são
    // acolchoados com silêncio (`apad`) dentro do filter graph de áudio para preencher até o
    // fim do vídeo — ver `buildAudioTrackFilterChain`.
    args.push("-map", `[${audioResult.outputLabel}]`, "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2");
  } else {
    args.push("-an");
  }

  args.push(
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(request.fps),
    "-t",
    request.totalDurationSeconds.toFixed(3),
    "-movflags",
    "+faststart",
    "-y",
    input.outputAbsolutePath,
  );

  return { args, plan };
}

/**
 * Um elemento de motion cujo asset é `kind: "image"` sempre vira um loop de imagem estática
 * (`-loop 1`, técnica já usada em todo o compilador). Um asset `kind: "video"` (vídeo real,
 * b-roll ou cinemagraph) nunca usa `-loop 1` — isso é flag do demuxer de imagem, inválida para
 * vídeo real. Em vez disso: se o clipe fonte for mais curto que o tempo em tela da cena, ele
 * repete via `-stream_loop -1` (limitado por `-t`); se for igual ou mais longo, simplesmente corta
 * para a duração da cena via `-t`. Verificado com clipes sintéticos reais via FFmpeg (não é
 * comportamento assumido).
 */
function buildMotionAssetInputArgs(asset: VideoRenderAsset, sceneDurationSeconds: number): string[] {
  const duration = sceneDurationSeconds.toFixed(3);
  if (asset.kind !== "video") return ["-loop", "1", "-t", duration, "-i", asset.absolutePath];
  const needsLoop = typeof asset.sourceDurationSeconds === "number" && asset.sourceDurationSeconds < sceneDurationSeconds - 0.05;
  if (needsLoop) return ["-stream_loop", "-1", "-t", duration, "-i", asset.absolutePath];
  return ["-t", duration, "-i", asset.absolutePath];
}

function buildSceneSourceInputArgs(
  scene: VideoRenderScene,
  width: number,
  height: number,
  fps: number,
  assetsById: Map<string, VideoRenderAsset>,
  supportsGradients: boolean,
): string[] {
  const duration = scene.durationSeconds.toFixed(3);

  if (scene.background.type === "image") {
    const asset = assetsById.get(scene.background.assetId);
    if (!asset) throw new Error(`Asset de imagem de fundo não resolvido: ${scene.background.assetId}`);
    return ["-loop", "1", "-t", duration, "-i", asset.absolutePath];
  }

  if (scene.background.type === "gradient" && supportsGradients) {
    const c0 = toFfmpegColor(scene.background.colorTop);
    const c1 = toFfmpegColor(scene.background.colorBottom);
    return [
      "-f",
      "lavfi",
      "-i",
      `gradients=s=${width}x${height}:d=${duration}:r=${fps}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=0:y1=${height}`,
    ];
  }

  const solidColor = toFfmpegColor(scene.background.type === "gradient" ? scene.background.colorTop : scene.background.color);
  return ["-f", "lavfi", "-i", `color=c=${solidColor}:s=${width}x${height}:d=${duration}:r=${fps}`];
}

function buildSceneFilterChain(input: {
  scene: VideoRenderScene;
  sourceInputIndex: number;
  width: number;
  height: number;
  fps: number;
  overlayTextFiles: Map<OverlayTextFileKey, string>;
  fonts: FontFilePaths;
  outputLabel: string;
  logoLabelByAssetId: Map<string, string>;
  motionAssetInputByElementKey: Map<string, number>;
  lightSweepInputIndex?: number;
}): string[] {
  const { scene, sourceInputIndex, width, height, fps, overlayTextFiles, fonts, outputLabel } = input;
  const steps: string[] = [];
  let current = `[${sourceInputIndex}:v]`;
  let stepCounter = 0;
  const nextLabel = () => `${outputLabel}_${stepCounter++}`;

  const scaled = `[${nextLabel()}]`;
  steps.push(`${current}scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${scaled}`);
  current = scaled;

  const zoomed = `[${nextLabel()}]`;
  const zoomPanFilter = buildZoomPanFilter(scene, width, height, fps);
  if (zoomPanFilter) {
    steps.push(`${current}${zoomPanFilter}${zoomed}`);
    current = zoomed;
  }

  // Vinheta muito leve, sempre aplicada — acabamento de motion graphics premium, nunca perceptível
  // como efeito isolado (ângulo PI/6, o valor mais suave do filtro `vignette` do FFmpeg).
  const vignetted = `[${nextLabel()}]`;
  steps.push(`${current}vignette=angle=PI/6${vignetted}`);
  current = vignetted;

  if (input.lightSweepInputIndex !== undefined) {
    const swept = `[${nextLabel()}]`;
    const sweepLabel = `[${nextLabel()}]`;
    const sweepWidth = Math.round(width * 0.32);
    const sweepDuration = Math.max(0.6, Math.min(1.4, scene.durationSeconds * 0.4));
    const travel = width + sweepWidth * 2;
    steps.push(`[${input.lightSweepInputIndex}:v]format=rgba,colorchannelmixer=aa=0.5${sweepLabel}`);
    steps.push(
      `${current}${sweepLabel}overlay=x='-${sweepWidth}+${travel}*min(max(t/${sweepDuration.toFixed(3)},0),1)':y=0:format=auto${swept}`,
    );
    current = swept;
  }

  if ((scene.motion?.elements.length ?? 0) > 0) {
    const polished = `[${nextLabel()}]`;
    steps.push(`${current}eq=brightness=-0.035:saturation=0.94${polished}`);
    current = polished;

    for (const element of orderedMotionElements(scene, "asset")) {
      const inputIndex = input.motionAssetInputByElementKey.get(motionElementKey(scene.order, element.id));
      if (inputIndex === undefined) continue;
      const layerLabel = `[${nextLabel()}]`;
      steps.push(buildMotionAssetLayerFilter(inputIndex, element, scene, width, height, layerLabel));
      const composited = `[${nextLabel()}]`;
      steps.push(`${current}${layerLabel}${buildMotionAssetOverlayFilter(element, scene, width, height)}${composited}`);
      current = composited;
    }

    for (const element of orderedMotionElements(scene, "text")) {
      const textFile = overlayTextFiles.get(motionTextFileKey(scene.order, element.id));
      if (!textFile) continue;
      const drawn = `[${nextLabel()}]`;
      steps.push(`${current}${buildMotionTextFilter(element, textFile, fonts, width, height)}${drawn}`);
      current = drawn;
    }

    if (scene.logo) {
      const logoLabel = input.logoLabelByAssetId.get(scene.logo.assetId);
      if (logoLabel !== undefined) {
        steps.push(`${current}[${logoLabel}]${buildLogoOverlayFilter(scene.logo.placement, width, height)}[${outputLabel}]`);
        return steps;
      }
    }

    steps.push(`${current}null[${outputLabel}]`);
    return steps;
  }

  for (const role of ["headline", "caption", "cta"] as VideoOverlayRole[]) {
    const textFile = overlayTextFiles.get(`${scene.order}:${role}`);
    if (!textFile) continue;
    const drawn = `[${nextLabel()}]`;
    steps.push(`${current}${buildDrawTextFilter(role, textFile, fonts, height)}${drawn}`);
    current = drawn;
  }

  if (scene.logo) {
    const logoLabel = input.logoLabelByAssetId.get(scene.logo.assetId);
    if (logoLabel !== undefined) {
      steps.push(`${current}[${logoLabel}]${buildLogoOverlayFilter(scene.logo.placement, width, height)}[${outputLabel}]`);
      return steps;
    }
  }

  steps.push(`${current}null[${outputLabel}]`);
  return steps;
}

function orderedMotionElements(scene: VideoRenderScene, kind: "asset" | "text"): VideoMotionElement[] {
  return (scene.motion?.elements ?? [])
    .filter((element) => (kind === "asset" ? Boolean(element.assetId) : Boolean(element.text?.trim())))
    .sort((a, b) => a.priority - b.priority || a.startSeconds - b.startSeconds);
}

export function motionTextFileKey(sceneOrder: number, elementId: string): OverlayTextFileKey {
  return `${sceneOrder}:motion:${elementId}`;
}

function motionElementKey(sceneOrder: number, elementId: string): string {
  return `${sceneOrder}:${elementId}`;
}

export function wrapMotionText(element: Pick<VideoMotionElement, "role" | "text">, canvasWidth: number): string {
  const fontSize = MOTION_FONT_SIZE_BY_ROLE[element.role] ?? FONT_SIZE_BY_ROLE.caption;
  const usableWidth = canvasWidth * (element.role === "headline" || element.role === "cta" ? 0.72 : 0.68);
  const maxCharsPerLine = Math.max(7, Math.floor(usableWidth / (fontSize * AVG_CHAR_WIDTH_FACTOR)));
  return wrapWords((element.text ?? "").trim(), maxCharsPerLine);
}

/**
 * Duração da entrada usada por `mask_reveal`/`blur_reveal`/`glow_pulse` — mais curta que o
 * `entranceDuration` (18-55% da cena) usado pelas animações de posição, porque estes três efeitos
 * são "revelações" pontuais (a imagem já está no lugar, só ainda não totalmente visível/nítida),
 * não uma entrada deslizando de fora do quadro.
 */
function revealDurationSeconds(scene: VideoRenderScene): number {
  return Math.max(0.35, Math.min(0.9, scene.durationSeconds * 0.25));
}

function buildMotionAssetLayerFilter(
  inputIndex: number,
  element: VideoMotionElement,
  scene: VideoRenderScene,
  canvasWidth: number,
  canvasHeight: number,
  outputLabel: string,
): string {
  const targetWidth = Math.round(element.width ?? defaultMotionAssetWidth(element, canvasWidth));
  const targetHeight = Math.round(element.height ?? canvasHeight * 0.72);
  const start = clampSeconds(element.startSeconds, scene.durationSeconds);
  const end = clampSeconds(element.exitStartSeconds ?? element.startSeconds + element.durationSeconds, scene.durationSeconds);
  const exitDuration = Math.max(0.001, element.exitDurationSeconds ?? 0.32);
  const opacity = Math.max(0.1, Math.min(1, element.opacity ?? 1));
  const scaleMode =
    element.role === "main_image"
      ? `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}`
      : `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`;

  // `mask_reveal`: em vez de deslizar de fora do quadro, a imagem já ocupa a posição final e é
  // revelada por um crop animado (largura crescendo de ~0 até a largura total) — uma cortina real
  // se abrindo, verificado empiricamente contra o FFmpeg real antes desta implementação (largura
  // mínima de crop precisa ser >= 2px, nunca 0, senão o filtro rejeita o frame inicial).
  if (element.entrance === "mask_reveal") {
    const revealDuration = revealDurationSeconds(scene);
    const progress = `min(max((t-${start.toFixed(3)})/${revealDuration.toFixed(3)},0),1)`;
    const revealFilters = [
      "format=rgba",
      scaleMode,
      `crop=w='max(2,min(iw,iw*${progress}))':h=ih:x=0:y=0`,
      `colorchannelmixer=aa=${opacity.toFixed(2)}`,
      `fade=t=out:st=${Math.max(start, end - exitDuration).toFixed(3)}:d=${exitDuration.toFixed(3)}:alpha=1`,
    ];
    return `[${inputIndex}:v]${revealFilters.join(",")}${outputLabel}`;
  }

  // `blur_reveal`: o FFmpeg real não permite `sigma` do `gblur` como expressão por frame (testado
  // e confirmado — a opção `eval` nem existe neste filtro nesta build). A alternativa real e
  // testada é compor DUAS cópias da mesma imagem — uma nítida entrando com fade-in, uma borrada
  // (sigma fixo) saindo com fade-out por cima — o cruzamento das duas dá a sensação de "focar".
  if (element.entrance === "blur_reveal") {
    const revealDuration = revealDurationSeconds(scene);
    const sharpLabel = `${outputLabel.slice(0, -1)}_sharp]`;
    const blurredLabel = `${outputLabel.slice(0, -1)}_blurred]`;
    const splitLabel = `${outputLabel.slice(0, -1)}_split]`;
    return [
      `[${inputIndex}:v]format=rgba,${scaleMode},colorchannelmixer=aa=${opacity.toFixed(2)}` +
        `,fade=t=out:st=${Math.max(start, end - exitDuration).toFixed(3)}:d=${exitDuration.toFixed(3)}:alpha=1,split=2${splitLabel}${sharpLabel.replace("_sharp", "_sharpB")}`,
      `${splitLabel}fade=t=in:st=${start.toFixed(3)}:d=${revealDuration.toFixed(3)}:alpha=1${sharpLabel}`,
      `${sharpLabel.replace("_sharp", "_sharpB")}gblur=sigma=16,fade=t=out:st=${start.toFixed(3)}:d=${revealDuration.toFixed(3)}:alpha=1${blurredLabel}`,
      `${blurredLabel}${sharpLabel}overlay=0:0:format=auto${outputLabel}`,
    ].join(";");
  }

  // `glow_pulse`: mesma limitação de `eval` por frame — `blend.all_opacity` também não aceita
  // expressão. A alternativa real: uma cópia borrada e clareada da imagem, com a opacidade
  // pulsando via múltiplos `fade` encadeados (cada um só atua dentro da sua própria janela de
  // tempo, então encadear vários cria um piscar real, sem precisar de expressão por frame),
  // misturada por cima com `blend=all_mode=screen` (modo de mistura aditivo, clássico de glow).
  if (element.entrance === "glow_pulse") {
    const pulseWindow = Math.max(0.5, Math.min(1.2, scene.durationSeconds * 0.35));
    const half = (pulseWindow / 2).toFixed(3);
    const pulses = [start, start + pulseWindow, start + pulseWindow * 2]
      .filter((pulseStart) => pulseStart + pulseWindow / 2 <= end)
      .flatMap((pulseStart) => [
        `fade=t=in:st=${pulseStart.toFixed(3)}:d=${half}:alpha=1`,
        `fade=t=out:st=${(pulseStart + pulseWindow / 2).toFixed(3)}:d=${half}:alpha=1`,
      ]);
    const baseLabel = `${outputLabel.slice(0, -1)}_base]`;
    const glowLabel = `${outputLabel.slice(0, -1)}_glow]`;
    const splitLabel = `${outputLabel.slice(0, -1)}_gsplit]`;
    const baseFilters = [
      "format=rgba",
      scaleMode,
      `colorchannelmixer=aa=${opacity.toFixed(2)}`,
      `fade=t=in:st=${start.toFixed(3)}:d=0.320:alpha=1`,
      `fade=t=out:st=${Math.max(start, end - exitDuration).toFixed(3)}:d=${exitDuration.toFixed(3)}:alpha=1`,
    ];
    return [
      `[${inputIndex}:v]${baseFilters.join(",")},split=2${splitLabel}${baseLabel}`,
      `${splitLabel}gblur=sigma=18,eq=brightness=0.22:saturation=1.3${pulses.length ? "," + pulses.join(",") : ""}${glowLabel}`,
      `${baseLabel}${glowLabel}blend=all_mode=screen:all_opacity=0.7${outputLabel}`,
    ].join(";");
  }

  const layerFilters = [
    "format=rgba",
    scaleMode,
    `colorchannelmixer=aa=${opacity.toFixed(2)}`,
    `fade=t=in:st=${start.toFixed(3)}:d=0.320:alpha=1`,
    `fade=t=out:st=${Math.max(start, end - exitDuration).toFixed(3)}:d=${exitDuration.toFixed(3)}:alpha=1`,
  ];
  if (element.blur) layerFilters.push("gblur=sigma=1.2");
  return `[${inputIndex}:v]${layerFilters.join(",")}${outputLabel}`;
}

function buildMotionAssetOverlayFilter(element: VideoMotionElement, scene: VideoRenderScene, canvasWidth: number, canvasHeight: number): string {
  const start = clampSeconds(element.startSeconds, scene.durationSeconds);
  const end = clampSeconds(element.startSeconds + element.durationSeconds, scene.durationSeconds);
  const entranceDuration = Math.max(0.18, Math.min(0.55, scene.durationSeconds * 0.18));
  const defaultPosition = defaultMotionAssetPosition(element, canvasWidth, canvasHeight);
  const baseX = element.x !== undefined ? String(Math.round(element.x)) : defaultPosition.x;
  const baseY = element.y !== undefined ? String(Math.round(element.y)) : defaultPosition.y;
  const isHero = element.role === "mockup" || element.role === "main_image";
  const xExpr = buildMotionPositionExpression(baseX, element.entrance, "x", start, entranceDuration, isHero, element.easing, scene.durationSeconds);
  const yExpr = buildMotionPositionExpression(baseY, element.entrance, "y", start, entranceDuration, isHero, element.easing, scene.durationSeconds);
  return `overlay=x='${xExpr}':y='${yExpr}':enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`;
}

function buildMotionTextFilter(
  element: VideoMotionElement,
  textFilePath: string,
  fonts: FontFilePaths,
  canvasWidth: number,
  canvasHeight: number,
): string {
  const escapedPath = escapeFfmpegPath(textFilePath);
  const escapedFont = escapeFfmpegPath(element.role === "headline" || element.role === "cta" ? fonts.bold : fonts.regular);
  const fontSize = MOTION_FONT_SIZE_BY_ROLE[element.role] ?? FONT_SIZE_BY_ROLE.caption;
  const start = Math.max(0, element.startSeconds);
  const end = Math.max(start + 0.8, element.startSeconds + element.durationSeconds);
  const entranceDuration = Math.max(0.18, Math.min(0.5, element.durationSeconds * 0.2));
  const exitStart = element.exitStartSeconds ?? Math.max(start + 0.8, end - (element.exitDurationSeconds ?? 0.32));
  const exitDuration = Math.max(0.001, element.exitDurationSeconds ?? 0.32);
  const defaultPosition = defaultMotionTextPosition(element, canvasWidth, canvasHeight);
  const baseX = element.x !== undefined ? String(Math.round(element.x)) : defaultPosition.x;
  const baseY = element.y !== undefined ? String(Math.round(element.y)) : defaultPosition.y;
  const xExpr = buildMotionPositionExpression(baseX, element.entrance, "x", start, entranceDuration, false, element.easing);
  const yExpr = buildMotionPositionExpression(baseY, element.entrance, "y", start, entranceDuration, false, element.easing);
  const alpha = buildMotionAlphaExpression(start, entranceDuration, exitStart, exitDuration);
  const color = element.role === "cta" ? CTA_COLOR : element.role === "caption" || element.role === "subtitle" ? CAPTION_COLOR : HEADLINE_COLOR;
  // Glassmorphism (aproximação real, sem desfoque por trás do texto em uma única passada de
  // drawtext — o FFmpeg não permite isso diretamente): painel translúcido claro com contraste
  // reduzido, em vez da caixa preta sólida padrão — só no end card (`element.glass`), reservado
  // para a cena de fechamento, nunca competindo com o box escuro padrão das demais cenas.
  const boxOpacity = element.glass ? "0.16" : element.role === "headline" ? "0.30" : element.role === "cta" ? "0.62" : "0.38";
  const boxColor = element.glass ? "white" : "black";
  const border = element.role === "headline" || element.role === "cta" ? 26 : 18;
  const shadow = element.shadow !== false ? ":shadowcolor=black@0.42:shadowx=0:shadowy=3" : "";
  const box = `:box=1:boxcolor=${boxColor}@${boxOpacity}:boxborderw=${border}`;
  return (
    `drawtext=fontfile='${escapedFont}':textfile='${escapedPath}':expansion=none:text_align=center:fontsize=${fontSize}:fontcolor=${toDrawtextColor(color)}` +
    `:x='${xExpr}':y='${yExpr}':line_spacing=9:alpha='${alpha}':enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'${shadow}${box}`
  );
}

function buildMotionAlphaExpression(start: number, entranceDuration: number, exitStart: number, exitDuration: number): string {
  return `if(lt(t,${start.toFixed(3)}),0,if(lt(t,${(start + entranceDuration).toFixed(3)}),(t-${start.toFixed(3)})/${entranceDuration.toFixed(3)},if(gt(t,${exitStart.toFixed(3)}),max(0,1-(t-${exitStart.toFixed(3)})/${exitDuration.toFixed(3)}),1)))`;
}

/**
 * `back_out` deixa de ser um rótulo só decorativo: aplica a curva clássica de "overshoot" (o
 * elemento passa levemente do ponto final e volta), fórmula padrão de easing
 * `1 + c3*(p-1)^3 + c1*(p-1)^2` com c1=1.70158/c3=2.70158 — verificada como expressão válida
 * contra o FFmpeg real (`pow`, multiplicação, sem função exótica alguma). Para as demais curvas
 * (`ease_in`, `ease_out`, `ease_in_out`), aplica uma curva quadrática/cúbica real em vez de
 * interpolação linear, que era o comportamento de toda curva antes desta evolução (o campo
 * `easing` era só guardado, nunca influenciava matemática nenhuma).
 */
function easedProgressExpression(progress: string, easing: VideoMotionElement["easing"] | undefined): string {
  if (easing === "back_out") {
    return `(1+2.70158*pow(${progress}-1,3)+1.70158*pow(${progress}-1,2))`;
  }
  if (easing === "ease_out") {
    return `(1-pow(1-${progress},2))`;
  }
  if (easing === "ease_in") {
    return `pow(${progress},2)`;
  }
  if (easing === "ease_in_out") {
    return `if(lt(${progress},0.5),2*pow(${progress},2),1-pow(-2*${progress}+2,2)/2)`;
  }
  return progress;
}

function buildMotionPositionExpression(
  base: string,
  animation: VideoMotionElement["entrance"],
  axis: "x" | "y",
  start: number,
  duration: number,
  floating: boolean,
  easing?: VideoMotionElement["easing"],
  sceneDurationSeconds?: number,
): string {
  const progress = `min(max((t-${start.toFixed(3)})/${duration.toFixed(3)},0),1)`;
  const eased = easedProgressExpression(progress, easing);
  const offset = axis === "x" ? 72 : 64;
  let expression = `(${base})`;
  if (animation === "slide_up" && axis === "y") expression = `(${base})+${offset}*(1-${eased})`;
  if (animation === "slide_down" && axis === "y") expression = `(${base})-${offset}*(1-${eased})`;
  if (animation === "slide_left" && axis === "x") expression = `(${base})+${offset}*(1-${eased})`;
  if (animation === "slide_right" && axis === "x") expression = `(${base})-${offset}*(1-${eased})`;
  // `whip`: um snap-pan rápido — mesmo princípio do slide, mas com deslocamento 3x maior, para
  // ler como um whip-pan de comercial (entrada brusca que assenta rápido), nunca um slide comum.
  if (animation === "whip" && axis === "x") expression = `(${base})+${offset * 3}*(1-${eased})`;
  if ((animation === "pop" || animation === "push") && axis === "y") expression = `(${base})+18*sin(PI*${progress})`;
  // `parallax`: deriva lenta e independente ao longo da cena INTEIRA (não só na entrada), na
  // direção oposta ao zoom/pan de fundo — cria a sensação de duas camadas se movendo em
  // velocidades diferentes, a assinatura visual de parallax real, distinta do "floating" (que só
  // oscila em torno do ponto fixo, sem deriva direcional).
  if (animation === "parallax" && sceneDurationSeconds && sceneDurationSeconds > 0) {
    const sceneProgress = `min(max(t/${sceneDurationSeconds.toFixed(3)},0),1)`;
    if (axis === "x") expression = `${expression}-24*(${sceneProgress}-0.5)`;
    if (axis === "y") expression = `${expression}-14*(${sceneProgress}-0.5)`;
  }
  if (floating && axis === "y") expression = `${expression}+8*sin(2*PI*(t-${start.toFixed(3)})/2.800)`;
  if (floating && axis === "x") expression = `${expression}+4*sin(2*PI*(t-${start.toFixed(3)})/3.600)`;
  return expression;
}

function defaultMotionAssetWidth(element: VideoMotionElement, canvasWidth: number): number {
  if (element.role === "logo") return Math.round(canvasWidth * 0.28);
  if (element.role === "card") return Math.round(canvasWidth * 0.72);
  if (element.role === "mockup") return Math.round(canvasWidth * 0.78);
  // Inset pequeno de canto — a imagem secundária de uma sequência visual (ver
  // VisualAssetResolver `sequenceSize`) nunca deve competir em tamanho com a imagem principal.
  if (element.role === "detail_image") return Math.round(canvasWidth * 0.38);
  return Math.round(canvasWidth * 0.84);
}

function defaultMotionAssetPosition(element: VideoMotionElement, _canvasWidth: number, canvasHeight: number): { x: string; y: string } {
  if (element.role === "logo") return { x: "(W-w)/2", y: String(Math.round(canvasHeight * 0.18)) };
  if (element.role === "card") return { x: "(W-w)/2", y: String(Math.round(canvasHeight * 0.51)) };
  if (element.role === "mockup") return { x: "(W-w)/2", y: String(Math.round(canvasHeight * 0.22)) };
  if (element.role === "detail_image") return { x: "W-w-56", y: String(Math.round(canvasHeight * 0.62)) };
  return { x: "(W-w)/2", y: String(Math.round(canvasHeight * 0.18)) };
}

function defaultMotionTextPosition(element: VideoMotionElement, _canvasWidth: number, canvasHeight: number): { x: string; y: string } {
  if (element.role === "headline") return { x: "(w-text_w)/2", y: String(Math.round(canvasHeight * 0.18)) };
  if (element.role === "subtitle" || element.role === "caption") return { x: "(w-text_w)/2", y: String(Math.round(canvasHeight * 0.28)) };
  if (element.role === "cta") return { x: "(w-text_w)/2", y: String(Math.round(canvasHeight * 0.72)) };
  return { x: "(w-text_w)/2", y: String(Math.round(canvasHeight * 0.52)) };
}

function clampSeconds(value: number, duration: number): number {
  return Math.max(0, Math.min(duration, value));
}

function buildZoomPanFilter(scene: VideoRenderScene, width: number, height: number, fps: number): string | undefined {
  const zoom = scene.zoom ?? "none";
  const pan = scene.pan ?? "none";
  if (zoom === "none" && pan === "none") return undefined;

  const frames = Math.max(1, Math.round(scene.durationSeconds * fps));
  const zoomStep = 0.15 / frames;

  let zExpr = "1";
  if (zoom === "in") zExpr = `min(zoom+${zoomStep.toFixed(6)},1.15)`;
  if (zoom === "out") zExpr = `if(eq(on,0),1.15,max(zoom-${zoomStep.toFixed(6)},1.0))`;

  let xExpr = "iw/2-(iw/zoom/2)";
  let yExpr = "ih/2-(ih/zoom/2)";
  if (pan === "left_to_right") xExpr = `(iw-iw/zoom)*(on/${Math.max(frames - 1, 1)})`;
  if (pan === "right_to_left") xExpr = `(iw-iw/zoom)*(1-on/${Math.max(frames - 1, 1)})`;

  return `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${width}x${height}:fps=${fps}`;
}

function buildDrawTextFilter(role: VideoOverlayRole, textFilePath: string, fonts: FontFilePaths, canvasHeight: number): string {
  const escapedPath = escapeFfmpegPath(textFilePath);
  const escapedFont = escapeFfmpegPath(role === "headline" || role === "cta" ? fonts.bold : fonts.regular);

  const fontSize = FONT_SIZE_BY_ROLE[role];
  const color = role === "headline" ? HEADLINE_COLOR : role === "cta" ? CTA_COLOR : CAPTION_COLOR;
  const yExpr = role === "headline" ? `(h-text_h)/2-110` : role === "cta" ? `(h-text_h)/2-30` : `(h-text_h)/2+145`;
  const boxOpacity = role === "cta" ? "0.52" : role === "headline" ? "0.48" : "0.42";
  const boxBorderWidth = role === "caption" ? 18 : 24;
  const boxOpts = `:box=1:boxcolor=black@${boxOpacity}:boxborderw=${boxBorderWidth}`;
  const fadeAlpha = "if(lt(t,0.35),t/0.35,1)";

  return (
    // `expansion=none` é essencial: sem isso, o FFmpeg tenta interpretar "%" no texto do usuário
    // como início de uma sequência de expansão de variável (ex.: "100% dos noivos" quebra o parser
    // e o texto inteiro deixa de ser desenhado, silenciosamente). Com `expansion=none`, "%" e "\"
    // no texto do arquivo são sempre tratados como caracteres literais. `text_align=center` garante
    // que cada linha do texto já quebrado por `wrapOverlayText` fique centralizada individualmente.
    `drawtext=fontfile='${escapedFont}':textfile='${escapedPath}':expansion=none:text_align=center:fontsize=${fontSize}:fontcolor=${toDrawtextColor(color)}` +
    `:x=(w-text_w)/2:y=${yExpr}:line_spacing=8:alpha='${fadeAlpha}'${boxOpts}`
  );
}

function buildLogoOverlayFilter(placement: string, width: number, height: number): string {
  const margin = Math.round(Math.min(width, height) * 0.05);
  const positions: Record<string, string> = {
    top_left: `${margin}:${margin}`,
    top_right: `W-w-${margin}:${margin}`,
    bottom_left: `${margin}:H-h-${margin}`,
    bottom_right: `W-w-${margin}:H-h-${margin}`,
    center: `(W-w)/2:(H-h)/2`,
  };
  const position = positions[placement] ?? positions.bottom_right;
  return `overlay=${position}`;
}

function buildTransitionChain(scenes: VideoRenderScene[], sceneLabels: string[]): { filters: string[]; outputLabel: string } {
  if (scenes.length === 0) throw new Error("Nenhuma cena para renderizar.");
  if (scenes.length === 1) return { filters: [], outputLabel: `${sceneLabels[0]}`.replace(/^\[|\]$/g, "") };

  const filters: string[] = [];
  let previousLabel = sceneLabels[0];
  let cumulativeDuration = scenes[0].durationSeconds;

  for (let index = 1; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const previousScene = scenes[index - 1];
    const transitionKind: VideoSceneTransition = previousScene.transitionToNext ?? "fade";
    const xfade = transitionKind === "cut" ? { name: "fade", durationSeconds: CUT_CROSSFADE_SECONDS } : XFADE_TRANSITION_BY_STYLE[transitionKind];
    const xd = Math.max(CUT_CROSSFADE_SECONDS, Math.min(xfade.durationSeconds, previousScene.durationSeconds * 0.4, scene.durationSeconds * 0.4));
    const offset = Math.max(0, cumulativeDuration - xd);
    const outputLabel = `x${index}`;

    filters.push(
      `[${previousLabel}][${sceneLabels[index]}]xfade=transition=${xfade.name}:duration=${xd.toFixed(3)}:offset=${offset.toFixed(3)}[${outputLabel}]`,
    );

    cumulativeDuration = cumulativeDuration + scene.durationSeconds - xd;
    previousLabel = outputLabel;
  }

  return { filters, outputLabel: previousLabel };
}

/**
 * Expressão de ducking automático: soma janelas `between(t, start, start+duração)` (cada uma 0/1)
 * e reduz o volume em `duckAmount` sempre que qualquer janela estiver ativa — `min(1, soma)` evita
 * reduzir mais que uma vez quando duas janelas se sobrepõem. Sem side-chain/compressor, mas
 * automático e determinístico: Diego decide os pontos (cada efeito sonoro), o compilador só
 * traduz para a expressão do FFmpeg.
 */
function buildDuckExpression(duckAtSeconds: number[], duckAmount: number, duckDurationSeconds: number, duckWindows: Array<{ startSeconds: number; durationSeconds: number }> = []): string {
  const windows = [
    ...duckAtSeconds.map((start) => `between(t,${start.toFixed(3)},${(start + duckDurationSeconds).toFixed(3)})`),
    ...duckWindows.map((window) => `between(t,${window.startSeconds.toFixed(3)},${(window.startSeconds + window.durationSeconds).toFixed(3)})`),
  ];
  return `(1-${duckAmount.toFixed(2)}*min(1,${windows.join("+")}))`;
}

/**
 * Cadeia de filtros de áudio de uma única faixa: volume base (com ducking automático embutido na
 * expressão quando `duckAtSeconds` estiver presente), fade-in/fade-out explícitos (`afade`) e o
 * atraso de entrada (`adelay`) por último. `fadeOutSeconds` é medido a partir do fim do vídeo
 * (`totalDurationSeconds`), não da duração do arquivo de áudio em si — assume que a faixa começa
 * em `startSeconds: 0` (sempre o caso para a trilha nesta pipeline).
 */
function buildAudioTrackFilterChain(track: VideoAudioTrack, totalDurationSeconds: number): string {
  const parts: string[] = [];
  const duckAtSeconds = track.duckAtSeconds ?? [];
  const duckWindows = track.duckWindows ?? [];
  if (duckAtSeconds.length > 0 || duckWindows.length > 0) {
    const duckAmount = track.duckAmount ?? DEFAULT_DUCK_AMOUNT;
    const duckDuration = track.duckDurationSeconds ?? DEFAULT_DUCK_DURATION_SECONDS;
    const duckExpr = buildDuckExpression(duckAtSeconds, duckAmount, duckDuration, duckWindows);
    parts.push(`volume='${track.volume.toFixed(2)}*${duckExpr}':eval=frame`);
  } else {
    parts.push(`volume=${track.volume.toFixed(2)}`);
  }

  if (track.fadeInSeconds && track.fadeInSeconds > 0) {
    parts.push(`afade=t=in:st=0:d=${track.fadeInSeconds.toFixed(3)}`);
  }
  if (track.fadeOutSeconds && track.fadeOutSeconds > 0) {
    const fadeOutStart = Math.max(0, totalDurationSeconds - track.fadeOutSeconds);
    parts.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${track.fadeOutSeconds.toFixed(3)}`);
  }

  const delayMs = Math.max(0, Math.round(track.startSeconds * 1000));
  parts.push(`adelay=${delayMs}|${delayMs}`);

  // SHOT RENDER ENGINE — narração e SFX naturalmente têm cauda finita (o arquivo termina). Sem
  // padding, essas tracks acabam antes do fim do vídeo e (com `amix=duration=longest` ou sem
  // `-shortest`) deixariam silêncio de fim de arquivo — o que já vinha causando truncamento
  // do end card no vídeo anterior. `apad=whole_dur` estende cada track com silêncio até bater
  // com `totalDurationSeconds`, garantindo que o áudio JAMAIS termine antes do vídeo. A trilha
  // (music) NÃO precisa de apad porque já entra com `-stream_loop -1` no input FFmpeg.
  if (track.role !== "music") {
    parts.push(`apad=whole_dur=${totalDurationSeconds.toFixed(3)}`);
  }
  return parts.join(",");
}

function buildAudioGraph(
  request: VideoRenderRequest,
  assetsById: Map<string, VideoRenderAsset>,
  inputArgs: string[],
  reserveInputIndex: () => number,
): { filters: string[]; outputLabel?: string } {
  const resolvedTracks = request.audioTracks
    .map((track) => ({ track, asset: assetsById.get(track.assetId) }))
    .filter((entry): entry is { track: (typeof request.audioTracks)[number]; asset: VideoRenderAsset } => Boolean(entry.asset));

  if (resolvedTracks.length === 0) return { filters: [] };

  const mixLabels: string[] = [];
  const filters: string[] = [];

  for (const { track, asset } of resolvedTracks) {
    const index = reserveInputIndex();
    // A trilha (`role: "music"`) sempre entra em loop infinito no input — nunca uma narração nem
    // um efeito sonoro pontual (`role: "sound_effect"`), que devem tocar uma única vez. Combinado com o `-t
    // <totalDurationSeconds>` global já aplicado ao output (ver `compileFfmpegArgs`), isso cobre
    // os dois casos pedidos sem precisar sondar a duração real do arquivo: música mais curta que o
    // vídeo repete até completar a duração; música mais longa é cortada no mesmo ponto exato em
    // que o vídeo termina.
    if (track.role === "music") {
      inputArgs.push("-stream_loop", "-1");
    }
    inputArgs.push("-i", asset.absolutePath);
    const label = `a${index}`;
    const chain = buildAudioTrackFilterChain(track, request.totalDurationSeconds);
    filters.push(`[${index}:a]${chain}[${label}]`);
    mixLabels.push(`[${label}]`);
  }

  if (mixLabels.length === 1) {
    const output = "audio_out";
    filters.push(`${mixLabels[0]}${FINAL_AUDIO_FILTER}[${output}]`);
    return { filters, outputLabel: output };
  }

  const mixOutput = "amix_out";
  const output = "audio_out";
  filters.push(`${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,${FINAL_AUDIO_FILTER}[${output}]`);
  return { filters, outputLabel: output };
}

function toFfmpegColor(hex: string): string {
  const normalized = hex.trim().replace(/^#/, "");
  return `0x${normalized.toUpperCase()}`;
}

function toDrawtextColor(hex: string): string {
  const normalized = hex.trim().replace(/^#/, "");
  return `0x${normalized.toUpperCase()}`;
}

/** Escapa um caminho de arquivo para uso seguro dentro de um valor de opção do filtro do FFmpeg no Windows (":" e "\\"). */
export function escapeFfmpegPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:");
}
