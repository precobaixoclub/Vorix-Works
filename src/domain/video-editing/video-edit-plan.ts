/**
 * Plano de edição de vídeo (EDL estruturada) — o contrato entre a IA planejadora e o motor de
 * execução audiovisual (DaVinci Resolve, via `infrastructure/davinci-resolve/`).
 *
 * Regras deste contrato:
 * - É DADO, nunca código: nenhum campo carrega Lua, Python, comando de sistema ou caminho
 *   absoluto. Mídia é referenciada por `assetId`, e cada asset aponta para um nome de arquivo
 *   simples dentro da pasta isolada do job (o adaptador monta o caminho, nunca o plano).
 * - Tudo é validado por `validateVideoEditPlan` antes de qualquer operação no DaVinci. Um plano
 *   inválido nunca chega à ponte.
 * - Tempos em segundos no plano; a conversão para quadros acontece no compilador de operações,
 *   com o fps do próprio plano.
 */

export const VIDEO_EDIT_PLAN_VERSION = 1 as const;

export type VideoAspect = "9:16" | "1:1" | "16:9";

/** Resoluções de entrega por proporção. Todas dentro do limite do DaVinci gratuito (≤ UHD, ≤ 60 fps). */
export const VIDEO_FORMATS: Record<VideoAspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export const SUPPORTED_FPS = [24, 25, 30] as const;
export type VideoFps = (typeof SUPPORTED_FPS)[number];

/** Limites do DaVinci Resolve gratuito para entrega (documentados em docs/davinci-resolve-integration.md). */
export const FREE_EDITION_LIMITS = { maxWidth: 3840, maxHeight: 2160, maxFps: 60 } as const;

export const MAX_PLAN_DURATION_SECONDS = 180;
export const MAX_CLIPS = 60;
export const MAX_TEXT_LENGTH = 140;
export const MIN_CLIP_SECONDS = 0.4;

export type VideoEditMode = "edit_footage" | "images_ad";

export type EditMediaKind = "video" | "image" | "audio";

export type EditMediaRole = "footage" | "product_photo" | "screenshot" | "logo" | "music" | "reference";

export type EditMediaAsset = {
  id: string;
  kind: EditMediaKind;
  role: EditMediaRole;
  /** Nome de arquivo simples (sem pasta) dentro da pasta do job. Ex.: "clip-01.mp4". */
  fileName: string;
  /** Duração real da mídia de origem — obrigatória para vídeo e áudio. */
  sourceDurationSeconds?: number;
  width?: number;
  height?: number;
  /**
   * Fidelidade protegida (produto, logo, tela real): o motor pode mover/escalar o quadro, mas nunca
   * recortar além do enquadramento seguro, cobrir com texto ou alterar cor.
   */
  protectedFidelity?: boolean;
};

export type EditTransitionType = "cut" | "cross_dissolve" | "dip_to_black" | "push_left" | "push_up" | "zoom_in";

export type EditTransition = { type: EditTransitionType; durationSeconds: number };

export type EditMotionType = "static" | "push_in" | "pull_out" | "pan_left" | "pan_right" | "pan_up" | "pan_down";

/** Movimento de câmera sobre o quadro (Ken Burns). `intensity` 0–1 mapeia para no máximo 18% de zoom/deslocamento. */
export type EditMotion = { type: EditMotionType; intensity: number };

/** Enquadramento: `fill` preenche o quadro (pode cortar bordas); `fit` mostra a mídia inteira sobre fundo preto. */
export type EditFraming = { fit: "fill" | "fit"; focusX: number; focusY: number };

export type EditTextRole = "hook" | "headline" | "caption" | "cta" | "price" | "subtitle";
export type EditTextPosition = "top" | "center" | "bottom" | "lower_third";
export type EditTextAnimation = "fade" | "slide_up" | "pop" | "none";

export type EditTextStyle = {
  /** Altura da fonte como fração da altura do quadro (0.02–0.12). */
  size: number;
  colorHex: string;
  /** Faixa atrás do texto para legibilidade. */
  backgroundHex?: string;
  bold?: boolean;
  fontFamily?: string;
};

export type EditTextOverlay = {
  id: string;
  role: EditTextRole;
  text: string;
  /** Relativo ao início do clipe. */
  startOffsetSeconds: number;
  durationSeconds: number;
  position: EditTextPosition;
  animation: EditTextAnimation;
  style: EditTextStyle;
};

export type EditClip = {
  id: string;
  assetId: string;
  /** Finalidade narrativa (abertura, detalhe, prova, CTA…) — só para histórico/revisão. */
  purpose: string;
  /** Vídeo: ponto de entrada na mídia de origem. Imagem: ignorado (0). */
  sourceInSeconds: number;
  /** Tempo do clipe na timeline. */
  durationSeconds: number;
  /** Início do clipe na timeline final. */
  recordStartSeconds: number;
  motion: EditMotion;
  framing: EditFraming;
  /** Transição de entrada (a do primeiro clipe é sempre tratada como corte/fade da abertura). */
  transitionIn: EditTransition;
  overlays: EditTextOverlay[];
  /** Vídeo com fala: manter o áudio original do trecho. */
  keepSourceAudio: boolean;
};

export type EditCaptionSegment = { startSeconds: number; endSeconds: number; text: string };

export type EditCaptions = {
  enabled: boolean;
  style: EditTextStyle;
  position: EditTextPosition;
  segments: EditCaptionSegment[];
};

export type EditMusic = {
  assetId: string;
  /** Ganho da trilha em dB (negativo abaixa). */
  gainDb: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  /** Abaixar a trilha enquanto há fala do vídeo de origem. */
  duckUnderSpeech: boolean;
};

export type EditLogo = {
  assetId: string;
  placement: "top_left" | "top_right" | "bottom_left" | "bottom_right" | "center";
  /** Largura do logo como fração da largura do quadro (0.08–0.5). */
  scale: number;
  startSeconds: number;
  durationSeconds: number;
};

export type VideoEditPlan = {
  version: typeof VIDEO_EDIT_PLAN_VERSION;
  planId: string;
  workspaceId: string;
  mode: VideoEditMode;
  aspect: VideoAspect;
  width: number;
  height: number;
  fps: VideoFps;
  durationSeconds: number;
  assets: EditMediaAsset[];
  clips: EditClip[];
  captions?: EditCaptions;
  music?: EditMusic;
  logo?: EditLogo;
  /** Ganho do áudio de origem (fala) em dB. */
  sourceAudioGainDb: number;
  /** Rótulo da estratégia de composição escolhida pela IA (para variar entre peças). */
  strategy: string;
  /** Pedido original do usuário, guardado para histórico — nunca interpretado pelo executor. */
  prompt: string;
};

export type PlanIssue = { path: string; message: string };
export type PlanValidation = { valid: boolean; issues: PlanIssue[] };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Nome de arquivo simples: sem separador de pasta, sem "..", extensão de mídia conhecida. */
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(mp4|mov|m4v|webm|mkv|png|jpe?g|webp|wav|mp3|m4a|aac)$/i;
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const KIND_EXTENSIONS: Record<EditMediaKind, RegExp> = {
  video: /\.(mp4|mov|m4v|webm|mkv)$/i,
  image: /\.(png|jpe?g|webp)$/i,
  audio: /\.(wav|mp3|m4a|aac)$/i,
};
/** Texto que vai para a tela: sem caracteres de controle. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const EPSILON = 1e-6;

export function isSafeMediaFileName(fileName: string): boolean {
  return FILE_NAME_PATTERN.test(fileName) && !fileName.includes("..");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function checkStyle(style: EditTextStyle | undefined, path: string, issues: PlanIssue[]): void {
  if (!style) {
    issues.push({ path, message: "estilo de texto ausente" });
    return;
  }
  if (!finite(style.size) || style.size < 0.02 || style.size > 0.12) issues.push({ path: `${path}.size`, message: "tamanho fora de 0.02–0.12 da altura" });
  if (!HEX_PATTERN.test(style.colorHex)) issues.push({ path: `${path}.colorHex`, message: "cor inválida (use #RRGGBB)" });
  if (style.backgroundHex !== undefined && !HEX_PATTERN.test(style.backgroundHex)) issues.push({ path: `${path}.backgroundHex`, message: "cor de fundo inválida" });
  if (style.fontFamily !== undefined && !/^[A-Za-z0-9 ._-]{1,48}$/.test(style.fontFamily)) issues.push({ path: `${path}.fontFamily`, message: "nome de fonte inválido" });
}

function checkText(text: string, path: string, issues: PlanIssue[]): void {
  if (typeof text !== "string" || text.trim().length === 0) issues.push({ path, message: "texto vazio" });
  else if (text.length > MAX_TEXT_LENGTH) issues.push({ path, message: `texto acima de ${MAX_TEXT_LENGTH} caracteres` });
  else if (CONTROL_CHARS.test(text)) issues.push({ path, message: "texto com caracteres de controle" });
}

/**
 * Valida o plano inteiro. Determinístico e sem I/O. Retorna todos os problemas de uma vez para
 * que a IA planejadora possa corrigir numa única rodada.
 */
export function validateVideoEditPlan(plan: VideoEditPlan): PlanValidation {
  const issues: PlanIssue[] = [];
  if (!plan || typeof plan !== "object") return { valid: false, issues: [{ path: "", message: "plano ausente" }] };

  if (plan.version !== VIDEO_EDIT_PLAN_VERSION) issues.push({ path: "version", message: "versão de plano não suportada" });
  if (!ID_PATTERN.test(plan.planId ?? "")) issues.push({ path: "planId", message: "id inválido" });
  if (!ID_PATTERN.test(plan.workspaceId ?? "")) issues.push({ path: "workspaceId", message: "workspace inválido" });
  if (plan.mode !== "edit_footage" && plan.mode !== "images_ad") issues.push({ path: "mode", message: "modo inválido" });

  const format = VIDEO_FORMATS[plan.aspect];
  if (!format) issues.push({ path: "aspect", message: "proporção não suportada" });
  else if (plan.width !== format.width || plan.height !== format.height) issues.push({ path: "width", message: `resolução deve ser ${format.width}x${format.height} para ${plan.aspect}` });
  if (plan.width > FREE_EDITION_LIMITS.maxWidth || plan.height > FREE_EDITION_LIMITS.maxWidth) issues.push({ path: "width", message: "resolução acima do limite do DaVinci gratuito" });
  if (!(SUPPORTED_FPS as readonly number[]).includes(plan.fps)) issues.push({ path: "fps", message: "fps não suportado" });
  if (!finite(plan.durationSeconds) || plan.durationSeconds < 3 || plan.durationSeconds > MAX_PLAN_DURATION_SECONDS) issues.push({ path: "durationSeconds", message: `duração deve estar entre 3 e ${MAX_PLAN_DURATION_SECONDS}s` });
  if (!finite(plan.sourceAudioGainDb) || plan.sourceAudioGainDb < -30 || plan.sourceAudioGainDb > 12) issues.push({ path: "sourceAudioGainDb", message: "ganho fora de -30..12 dB" });
  if (typeof plan.prompt !== "string" || plan.prompt.length > 4000) issues.push({ path: "prompt", message: "pedido ausente ou longo demais" });

  // Assets
  const assets = new Map<string, EditMediaAsset>();
  const fileNames = new Set<string>();
  (plan.assets ?? []).forEach((asset, index) => {
    const path = `assets[${index}]`;
    if (!ID_PATTERN.test(asset.id ?? "")) issues.push({ path: `${path}.id`, message: "id inválido" });
    if (assets.has(asset.id)) issues.push({ path: `${path}.id`, message: "id repetido" });
    assets.set(asset.id, asset);
    if (!isSafeMediaFileName(asset.fileName ?? "")) issues.push({ path: `${path}.fileName`, message: "nome de arquivo inseguro (somente nome simples dentro do job)" });
    else if (!KIND_EXTENSIONS[asset.kind]?.test(asset.fileName)) issues.push({ path: `${path}.fileName`, message: `extensão não corresponde ao tipo ${asset.kind}` });
    if (fileNames.has(asset.fileName)) issues.push({ path: `${path}.fileName`, message: "arquivo repetido" });
    fileNames.add(asset.fileName);
    if ((asset.kind === "video" || asset.kind === "audio") && (!finite(asset.sourceDurationSeconds) || asset.sourceDurationSeconds <= 0)) {
      issues.push({ path: `${path}.sourceDurationSeconds`, message: "duração da mídia de origem obrigatória" });
    }
  });

  // Clipes
  const clips = plan.clips ?? [];
  if (clips.length === 0) issues.push({ path: "clips", message: "plano sem clipes" });
  if (clips.length > MAX_CLIPS) issues.push({ path: "clips", message: `mais de ${MAX_CLIPS} clipes` });
  const clipIds = new Set<string>();
  let expectedStart = 0;
  clips.forEach((clip, index) => {
    const path = `clips[${index}]`;
    if (!ID_PATTERN.test(clip.id ?? "")) issues.push({ path: `${path}.id`, message: "id inválido" });
    if (clipIds.has(clip.id)) issues.push({ path: `${path}.id`, message: "id repetido" });
    clipIds.add(clip.id);
    const asset = assets.get(clip.assetId);
    if (!asset) issues.push({ path: `${path}.assetId`, message: "asset inexistente" });
    else if (asset.kind === "audio") issues.push({ path: `${path}.assetId`, message: "clipe de vídeo não pode usar asset de áudio" });

    if (!finite(clip.durationSeconds) || clip.durationSeconds < MIN_CLIP_SECONDS) issues.push({ path: `${path}.durationSeconds`, message: `clipe com menos de ${MIN_CLIP_SECONDS}s` });
    if (!finite(clip.sourceInSeconds) || clip.sourceInSeconds < 0) issues.push({ path: `${path}.sourceInSeconds`, message: "ponto de entrada inválido" });
    if (asset?.kind === "video" && finite(asset.sourceDurationSeconds) && clip.sourceInSeconds + clip.durationSeconds > asset.sourceDurationSeconds + 0.05) {
      issues.push({ path: `${path}.durationSeconds`, message: "trecho ultrapassa o fim da mídia de origem" });
    }

    const transition = clip.transitionIn ?? { type: "cut", durationSeconds: 0 };
    const overlap = transition.type === "cross_dissolve" || transition.type === "push_left" || transition.type === "push_up" || transition.type === "zoom_in" ? transition.durationSeconds : 0;
    if (!["cut", "cross_dissolve", "dip_to_black", "push_left", "push_up", "zoom_in"].includes(transition.type)) issues.push({ path: `${path}.transitionIn.type`, message: "transição desconhecida" });
    if (!finite(transition.durationSeconds) || transition.durationSeconds < 0 || transition.durationSeconds > 1.5) issues.push({ path: `${path}.transitionIn.durationSeconds`, message: "duração de transição fora de 0–1.5s" });
    if (index > 0 && overlap * 2 > Math.min(clip.durationSeconds, clips[index - 1]!.durationSeconds) + EPSILON) issues.push({ path: `${path}.transitionIn`, message: "transição longa demais para os clipes vizinhos" });

    // Continuidade: cada clipe começa onde o anterior termina, menos a sobreposição da transição.
    const start = index === 0 ? 0 : expectedStart - overlap;
    if (!finite(clip.recordStartSeconds) || Math.abs(clip.recordStartSeconds - start) > 0.02) {
      issues.push({ path: `${path}.recordStartSeconds`, message: `deveria começar em ${start.toFixed(2)}s (sem buracos nem sobreposição fora de transição)` });
    }
    expectedStart = (finite(clip.recordStartSeconds) ? clip.recordStartSeconds : start) + clip.durationSeconds;

    if (!clip.motion || !["static", "push_in", "pull_out", "pan_left", "pan_right", "pan_up", "pan_down"].includes(clip.motion.type)) issues.push({ path: `${path}.motion`, message: "movimento desconhecido" });
    else if (!finite(clip.motion.intensity) || clip.motion.intensity < 0 || clip.motion.intensity > 1) issues.push({ path: `${path}.motion.intensity`, message: "intensidade fora de 0–1" });
    if (!clip.framing || (clip.framing.fit !== "fill" && clip.framing.fit !== "fit")) issues.push({ path: `${path}.framing`, message: "enquadramento inválido" });
    else {
      for (const key of ["focusX", "focusY"] as const) {
        if (!finite(clip.framing[key]) || clip.framing[key] < 0 || clip.framing[key] > 1) issues.push({ path: `${path}.framing.${key}`, message: "foco fora de 0–1" });
      }
    }
    if (asset?.protectedFidelity && clip.framing?.fit === "fill" && clip.motion?.intensity > 0.6) {
      issues.push({ path: `${path}.motion.intensity`, message: "movimento forte demais para mídia com fidelidade protegida (corta o produto)" });
    }
    if (clip.keepSourceAudio && asset?.kind !== "video") issues.push({ path: `${path}.keepSourceAudio`, message: "só vídeo tem áudio de origem" });

    (clip.overlays ?? []).forEach((overlay, overlayIndex) => {
      const opath = `${path}.overlays[${overlayIndex}]`;
      if (!ID_PATTERN.test(overlay.id ?? "")) issues.push({ path: `${opath}.id`, message: "id inválido" });
      checkText(overlay.text, `${opath}.text`, issues);
      checkStyle(overlay.style, `${opath}.style`, issues);
      if (!finite(overlay.startOffsetSeconds) || overlay.startOffsetSeconds < 0 || !finite(overlay.durationSeconds) || overlay.durationSeconds < 0.3 || overlay.startOffsetSeconds + overlay.durationSeconds > clip.durationSeconds + EPSILON) {
        issues.push({ path: opath, message: "texto fora do intervalo do clipe" });
      }
      if (asset?.protectedFidelity && overlay.position === "center") issues.push({ path: `${opath}.position`, message: "texto no centro cobre o produto/tela protegida" });
    });
  });

  if (clips.length > 0 && Math.abs(expectedStart - plan.durationSeconds) > 0.05) {
    issues.push({ path: "durationSeconds", message: `soma da timeline (${expectedStart.toFixed(2)}s) difere da duração declarada (${plan.durationSeconds}s)` });
  }

  if (plan.captions?.enabled) {
    checkStyle(plan.captions.style, "captions.style", issues);
    let lastEnd = -1;
    plan.captions.segments.forEach((segment, index) => {
      const path = `captions.segments[${index}]`;
      checkText(segment.text, `${path}.text`, issues);
      if (!finite(segment.startSeconds) || !finite(segment.endSeconds) || segment.endSeconds - segment.startSeconds < 0.25 || segment.startSeconds < lastEnd - EPSILON || segment.endSeconds > plan.durationSeconds + EPSILON) {
        issues.push({ path, message: "legenda fora de ordem, curta demais ou além do fim" });
      }
      lastEnd = segment.endSeconds;
    });
  }

  if (plan.music) {
    const asset = assets.get(plan.music.assetId);
    if (!asset || asset.kind !== "audio") issues.push({ path: "music.assetId", message: "trilha deve ser um asset de áudio" });
    if (!finite(plan.music.gainDb) || plan.music.gainDb < -40 || plan.music.gainDb > 0) issues.push({ path: "music.gainDb", message: "ganho da trilha fora de -40..0 dB" });
    for (const key of ["fadeInSeconds", "fadeOutSeconds"] as const) {
      if (!finite(plan.music[key]) || plan.music[key] < 0 || plan.music[key] > 5) issues.push({ path: `music.${key}`, message: "fade fora de 0–5s" });
    }
  }

  if (plan.logo) {
    const asset = assets.get(plan.logo.assetId);
    if (!asset || asset.kind !== "image") issues.push({ path: "logo.assetId", message: "logo deve ser uma imagem" });
    if (!finite(plan.logo.scale) || plan.logo.scale < 0.08 || plan.logo.scale > 0.5) issues.push({ path: "logo.scale", message: "escala do logo fora de 0.08–0.5" });
    if (!finite(plan.logo.startSeconds) || plan.logo.startSeconds < 0 || !finite(plan.logo.durationSeconds) || plan.logo.durationSeconds < 0.5 || plan.logo.startSeconds + plan.logo.durationSeconds > plan.durationSeconds + EPSILON) {
      issues.push({ path: "logo", message: "intervalo do logo fora do vídeo" });
    }
  }

  return { valid: issues.length === 0, issues };
}
