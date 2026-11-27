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

/** `card` = fundo de cor/gradiente gerado pelo executor (abertura, encerramento com CTA); não tem arquivo. */
export type EditMediaKind = "video" | "image" | "audio" | "card";

/** `generated` = imagem criada por IA (cena conceitual): nunca produto nem tela de software. */
export type EditMediaRole = "footage" | "product_photo" | "screenshot" | "logo" | "music" | "narration" | "reference" | "card" | "generated" | "sfx";

export type EditMediaAsset = {
  id: string;
  kind: EditMediaKind;
  role: EditMediaRole;
  /** Nome de arquivo simples (sem pasta) dentro da pasta do job. Ex.: "clip-01.mp4". Ausente só em `card`. */
  fileName?: string;
  /** Somente `card`: cor sólida ou gradiente vertical. */
  card?: { colorHex: string; gradientToHex?: string };
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

export const OVERLAP_TRANSITIONS = ["cross_dissolve", "push_left", "push_up", "zoom_in", "blur", "circle_open", "wipe", "flash", "smooth_left"] as const;
export type EditTransitionType = "cut" | "dip_to_black" | (typeof OVERLAP_TRANSITIONS)[number];
const TRANSITION_TYPES: readonly string[] = ["cut", "dip_to_black", ...OVERLAP_TRANSITIONS];

export type EditTransition = { type: EditTransitionType; durationSeconds: number };

/** `punch_in`: aproximação rápida no início (gancho) e quase parada depois; `drift`: deriva diagonal lenta. */
export type EditMotionType = "static" | "push_in" | "pull_out" | "pan_left" | "pan_right" | "pan_up" | "pan_down" | "punch_in" | "drift";
const MOTION_TYPES: readonly string[] = ["static", "push_in", "pull_out", "pan_left", "pan_right", "pan_up", "pan_down", "punch_in", "drift"];

/**
 * Composição da cena (só imagem/cartão; vídeo é sempre `full`):
 * - `full`: a mídia ocupa o quadro (preencher ou inteira sobre fundo desfocado);
 * - `framed`: a foto inteira num cartão com cantos arredondados e sombra, sobre o fundo da marca;
 * - `split`: foto de um lado e painel da marca do outro — textos da cena vão para o painel;
 * - `parallax`: fundo e foto em camadas que se movem em velocidades diferentes (profundidade);
 * - `inset`: foto inteira + lupa circular ampliando o detalhe no ponto de foco;
 * - `device_phone`/`device_laptop`: captura real dentro de um celular/notebook desenhado.
 */
export const SCENE_LAYOUTS = ["full", "framed", "split", "parallax", "inset", "device_phone", "device_laptop", "stage"] as const;
export type EditSceneLayout = (typeof SCENE_LAYOUTS)[number];

/** Cores da marca usadas pelas composições (fundos, painéis, molduras). */
export type EditLook = { backgroundHex: string; accentHex: string; panelTextHex: string };

/** Movimento de câmera sobre o quadro (Ken Burns). `intensity` 0–1 mapeia para no máximo 18% de zoom/deslocamento. */
export type EditMotion = { type: EditMotionType; intensity: number };

/** Enquadramento: `fill` preenche o quadro (pode cortar bordas); `fit` mostra a mídia inteira sobre um fundo desfocado da própria mídia. */
/** `zoom` (1–2.5) aproxima além do enquadramento base, mantendo o foco — ex.: gravação de tela no 9:16. */
export type EditSourceRegion = { x: number; y: number; width: number; height: number; start?: { x: number; y: number; scale: number } };
export type EditFraming = { fit: "fill" | "fit"; focusX: number; focusY: number; zoom?: number; region?: EditSourceRegion };

export function validSourceRegion(region: EditSourceRegion): boolean {
  const { x, y, width, height, start } = region;
  return [x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0
    && width >= 0.1 && height >= 0.1 && x + width <= 1 && y + height <= 1
    && (start === undefined || (Boolean(start) && [start.x, start.y, start.scale].every(Number.isFinite)
      && start.x >= 0 && start.x <= 1 && start.y >= 0 && start.y <= 1 && start.scale >= 0.28 && start.scale <= 0.95));
}

export type EditTextRole = "hook" | "headline" | "caption" | "cta" | "price" | "subtitle";
export type EditTextPosition = "top" | "center" | "bottom" | "lower_third";
/** `kinetic`: as palavras entram uma a uma. */
export type EditTextAnimation = "fade" | "slide_up" | "pop" | "kinetic" | "countdown" | "none";

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
  /** Intenção emocional da cena (Emotion Engine): já aplicada em ritmo, movimento, transição e som. */
  emotion?: string;
  /** Composição da cena; ausente = `full`. */
  layout?: EditSceneLayout;
  /**
   * Cena de MOTION DESIGN renderizada pelo Remotion (template + props) antes da montagem. O clipe resultante
   * entra na timeline como vídeo; o FFmpeg continua cuidando de transições, áudio, legendas e exportação.
   * Props referenciam arquivos do job pelo nome (os mesmos `fileName` dos assets).
   */
  design?: EditDesign;
};

export const DESIGN_TEMPLATES = ["product_hero", "detail_reveal", "lineup", "software_focus", "title_card", "speech_captions"] as const;
export type EditDesignTemplate = (typeof DESIGN_TEMPLATES)[number];
export type EditSfxCue = { assetId: string; atSeconds: number; gainDb: number };
export type EditDesign = { template: EditDesignTemplate; props: Record<string, unknown> };

export type EditCaptionWord = { text: string; startSeconds: number; endSeconds: number };

/** `words` (opcional, da transcrição) permite destacar a palavra falada no momento certo. */
export type EditCaptionSegment = { startSeconds: number; endSeconds: number; text: string; words?: EditCaptionWord[] };

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
  /** Abaixar a trilha enquanto há fala (áudio original ou narração). */
  duckUnderSpeech: boolean;
};

/** Narração já gravada/gerada (arquivo de áudio). O executor não sintetiza voz. */
export type EditNarration = { assetId: string; startSeconds: number; gainDb: number };

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
  narration?: EditNarration;
  logo?: EditLogo;
  /** Ganho do áudio de origem (fala) em dB. */
  sourceAudioGainDb: number;
  /** Rótulo da estratégia de composição escolhida pela IA (para variar entre peças). */
  strategy: string;
  /** Cores da marca para as composições `framed`/`split`/`parallax`/`device_*`. */
  look?: EditLook;
  /** Efeitos sonoros sincronizados com eventos visuais (Sound Design Engine). */
  sfx?: EditSfxCue[];
  /** Registro da direção audiovisual (identidade de movimento, batida, verificações objetivas). */
  direction?: { story?: string; brandMotion?: Record<string, unknown>; beat?: { bpm: number; snapped: number; cuts: number }; checks?: { id: string; label: string; kind: string; status: string; detail: string }[] };
  /** Pedido original do usuário, guardado para histórico — nunca interpretado pelo executor. */
  prompt: string;
};

export type PlanIssue = { path: string; message: string };
export type PlanValidation = { valid: boolean; issues: PlanIssue[] };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Nome de arquivo simples: sem separador de pasta, sem "..", extensão de mídia conhecida. */
const FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(mp4|mov|m4v|webm|mkv|png|jpe?g|webp|wav|mp3|m4a|aac)$/i;
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const KIND_EXTENSIONS: Record<Exclude<EditMediaKind, "card">, RegExp> = {
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
    if (!["video", "image", "audio", "card"].includes(asset.kind)) issues.push({ path: `${path}.kind`, message: "tipo de mídia desconhecido" });
    if (asset.kind === "card") {
      if (asset.fileName !== undefined) issues.push({ path: `${path}.fileName`, message: "cartão não tem arquivo" });
      if (!asset.card || !HEX_PATTERN.test(asset.card.colorHex) || (asset.card.gradientToHex !== undefined && !HEX_PATTERN.test(asset.card.gradientToHex))) issues.push({ path: `${path}.card`, message: "cartão sem cor válida (#RRGGBB)" });
      return;
    }
    if (asset.card !== undefined) issues.push({ path: `${path}.card`, message: "só assets do tipo card têm cor" });
    if (!isSafeMediaFileName(asset.fileName ?? "")) issues.push({ path: `${path}.fileName`, message: "nome de arquivo inseguro (somente nome simples dentro do job)" });
    else if (!KIND_EXTENSIONS[asset.kind as Exclude<EditMediaKind, "card">]?.test(asset.fileName!)) issues.push({ path: `${path}.fileName`, message: `extensão não corresponde ao tipo ${asset.kind}` });
    if (asset.fileName && fileNames.has(asset.fileName)) issues.push({ path: `${path}.fileName`, message: "arquivo repetido" });
    if (asset.fileName) fileNames.add(asset.fileName);
    if ((asset.kind === "video" || asset.kind === "audio") && (!finite(asset.sourceDurationSeconds) || asset.sourceDurationSeconds <= 0)) {
      issues.push({ path: `${path}.sourceDurationSeconds`, message: "duração da mídia de origem obrigatória" });
    }
  });

  if (plan.look) {
    for (const key of ["backgroundHex", "accentHex", "panelTextHex"] as const) if (!HEX_PATTERN.test(plan.look[key] ?? "")) issues.push({ path: `look.${key}`, message: "cor inválida" });
  }
  for (const [index, asset] of (plan.assets ?? []).entries()) {
    if (asset.role === "generated" && (asset.kind !== "image" || asset.protectedFidelity)) issues.push({ path: `assets[${index}]`, message: "imagem gerada por IA não pode representar produto nem tela" });
  }

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
    const overlap = (OVERLAP_TRANSITIONS as readonly string[]).includes(transition.type) ? transition.durationSeconds : 0;
    if (!TRANSITION_TYPES.includes(transition.type)) issues.push({ path: `${path}.transitionIn.type`, message: "transição desconhecida" });
    if (!finite(transition.durationSeconds) || transition.durationSeconds < 0 || transition.durationSeconds > 1.5) issues.push({ path: `${path}.transitionIn.durationSeconds`, message: "duração de transição fora de 0–1.5s" });
    if (index > 0 && overlap * 2 > Math.min(clip.durationSeconds, clips[index - 1]!.durationSeconds) + EPSILON) issues.push({ path: `${path}.transitionIn`, message: "transição longa demais para os clipes vizinhos" });

    // Continuidade: cada clipe começa onde o anterior termina, menos a sobreposição da transição.
    const start = index === 0 ? 0 : expectedStart - overlap;
    if (!finite(clip.recordStartSeconds) || Math.abs(clip.recordStartSeconds - start) > 0.02) {
      issues.push({ path: `${path}.recordStartSeconds`, message: `deveria começar em ${start.toFixed(2)}s (sem buracos nem sobreposição fora de transição)` });
    }
    expectedStart = (finite(clip.recordStartSeconds) ? clip.recordStartSeconds : start) + clip.durationSeconds;

    if (!clip.motion || !MOTION_TYPES.includes(clip.motion.type)) issues.push({ path: `${path}.motion`, message: "movimento desconhecido" });
    else if (!finite(clip.motion.intensity) || clip.motion.intensity < 0 || clip.motion.intensity > 1) issues.push({ path: `${path}.motion.intensity`, message: "intensidade fora de 0–1" });
    if (!clip.framing || (clip.framing.fit !== "fill" && clip.framing.fit !== "fit")) issues.push({ path: `${path}.framing`, message: "enquadramento inválido" });
    else {
      if (clip.framing.zoom !== undefined && (!finite(clip.framing.zoom) || clip.framing.zoom < 1 || clip.framing.zoom > 2.5)) issues.push({ path: `${path}.framing.zoom`, message: "zoom de enquadramento fora de 1–2,5" });
      if (asset?.protectedFidelity && (clip.framing.zoom ?? 1) > 1.6) issues.push({ path: `${path}.framing.zoom`, message: "zoom forte demais para produto/tela protegidos" });
      if (clip.framing.region !== undefined && (!clip.framing.region || !validSourceRegion(clip.framing.region) || (clip.layout ?? "full") !== "full"
        || !asset || !["image", "video"].includes(asset.kind) || (clip.framing.region.start && asset.kind !== "image")
        || clip.framing.fit !== "fit" || clip.framing.zoom !== undefined || clip.motion?.type !== "static")) {
        issues.push({ path: `${path}.framing.region`, message: "região inválida ou incompatível com o quadro de detalhe" });
      }
      for (const key of ["focusX", "focusY"] as const) {
        if (!finite(clip.framing[key]) || clip.framing[key] < 0 || clip.framing[key] > 1) issues.push({ path: `${path}.framing.${key}`, message: "foco fora de 0–1" });
      }
    }
    if (asset?.protectedFidelity && clip.framing?.fit === "fill" && clip.motion?.intensity > 0.6) {
      issues.push({ path: `${path}.motion.intensity`, message: "movimento forte demais para mídia com fidelidade protegida (corta o produto)" });
    }
    if (asset?.kind === "card" && clip.framing?.fit === "fit") issues.push({ path: `${path}.framing`, message: "cartão sempre preenche o quadro" });
    const layout = clip.layout ?? "full";
    if (!(SCENE_LAYOUTS as readonly string[]).includes(layout)) issues.push({ path: `${path}.layout`, message: "composição desconhecida" });
    else if (layout !== "full") {
      if (asset?.kind !== "image") issues.push({ path: `${path}.layout`, message: "composição só para imagem (vídeo e cartão usam full)" });
      if ((layout === "device_phone" || layout === "device_laptop") && asset?.role !== "screenshot") issues.push({ path: `${path}.layout`, message: "moldura de aparelho só para captura de tela real" });
      if (layout === "inset" && asset?.role === "screenshot") issues.push({ path: `${path}.layout`, message: "lupa de detalhe é para produto, não para tela" });
      if (layout === "stage" && asset?.role !== "product_photo") issues.push({ path: `${path}.layout`, message: "entrada de produto exige foto original do produto" });
      if (!plan.look) issues.push({ path: `${path}.layout`, message: "composição exige as cores da marca (look)" });
    }
    if (clip.keepSourceAudio && asset?.kind !== "video") issues.push({ path: `${path}.keepSourceAudio`, message: "só vídeo tem áudio de origem" });
    if (clip.design) {
      if (!(DESIGN_TEMPLATES as readonly string[]).includes(clip.design.template)) issues.push({ path: `${path}.design`, message: "template de motion design desconhecido" });
      if (!clip.design.props || typeof clip.design.props !== "object" || JSON.stringify(clip.design.props).length > 20_000) issues.push({ path: `${path}.design`, message: "props do motion design inválidas" });
      if (clip.durationSeconds > 12) issues.push({ path: `${path}.design`, message: "cena de motion design de até 12 s" });
      const files = new Set(plan.assets.map((item) => item.fileName).filter(Boolean));
      for (const value of Object.values(clip.design.props ?? {}).flatMap((item) => (Array.isArray(item) ? item : [item]))) {
        if (typeof value === "string" && /.(png|jpe?g|webp|mp4|mov)$/i.test(value) && !files.has(value)) issues.push({ path: `${path}.design`, message: `arquivo ${value} não pertence ao plano` });
      }
    }

    (clip.overlays ?? []).forEach((overlay, overlayIndex) => {
      const opath = `${path}.overlays[${overlayIndex}]`;
      if (!ID_PATTERN.test(overlay.id ?? "")) issues.push({ path: `${opath}.id`, message: "id inválido" });
      checkText(overlay.text, `${opath}.text`, issues);
      if (overlay.animation === "countdown" && (overlay.text !== "3 2 1" || overlay.durationSeconds < 1.2)) {
        issues.push({ path: opath, message: "a contagem deve ter texto '3 2 1' e durar ao menos 1,2 s" });
      }
      checkStyle(overlay.style, `${opath}.style`, issues);
      if (!finite(overlay.startOffsetSeconds) || overlay.startOffsetSeconds < 0 || !finite(overlay.durationSeconds) || overlay.durationSeconds < 0.3 || overlay.startOffsetSeconds + overlay.durationSeconds > clip.durationSeconds + EPSILON) {
        issues.push({ path: opath, message: "texto fora do intervalo do clipe" });
      }
      if (asset?.protectedFidelity && overlay.position === "center" && clip.layout !== "split") issues.push({ path: `${opath}.position`, message: "texto no centro cobre o produto/tela protegida" });
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
      if (segment.words !== undefined) {
        if (!Array.isArray(segment.words) || segment.words.length > 60) issues.push({ path: `${path}.words`, message: "palavras inválidas" });
        else {
          let lastWord = segment.startSeconds - 0.05;
          for (const word of segment.words) {
            if (typeof word.text !== "string" || word.text.trim().length === 0 || word.text.length > 40 || CONTROL_CHARS.test(word.text) || !finite(word.startSeconds) || !finite(word.endSeconds) || word.startSeconds < lastWord - 0.05 || word.endSeconds < word.startSeconds || word.endSeconds > segment.endSeconds + 0.3) {
              issues.push({ path: `${path}.words`, message: "palavra fora da ordem ou do intervalo da legenda" });
              break;
            }
            lastWord = word.startSeconds;
          }
        }
      }
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

  if (plan.narration) {
    const asset = assets.get(plan.narration.assetId);
    if (!asset || asset.kind !== "audio") issues.push({ path: "narration.assetId", message: "narração deve ser um asset de áudio" });
    if (!finite(plan.narration.startSeconds) || plan.narration.startSeconds < 0 || plan.narration.startSeconds >= plan.durationSeconds) issues.push({ path: "narration.startSeconds", message: "início da narração fora do vídeo" });
    if (!finite(plan.narration.gainDb) || plan.narration.gainDb < -20 || plan.narration.gainDb > 12) issues.push({ path: "narration.gainDb", message: "ganho da narração fora de -20..12 dB" });
  }

  if (plan.logo) {
    const asset = assets.get(plan.logo.assetId);
    if (!asset || asset.kind !== "image") issues.push({ path: "logo.assetId", message: "logo deve ser uma imagem" });
    if (!finite(plan.logo.scale) || plan.logo.scale < 0.08 || plan.logo.scale > 0.5) issues.push({ path: "logo.scale", message: "escala do logo fora de 0.08–0.5" });
    if (!finite(plan.logo.startSeconds) || plan.logo.startSeconds < 0 || !finite(plan.logo.durationSeconds) || plan.logo.durationSeconds < 0.5 || plan.logo.startSeconds + plan.logo.durationSeconds > plan.durationSeconds + EPSILON) {
      issues.push({ path: "logo", message: "intervalo do logo fora do vídeo" });
    }
  }

  for (const [index, cue] of (plan.sfx ?? []).entries()) {
    const asset = plan.assets.find((item) => item.id === cue.assetId);
    if (!asset || asset.kind !== "audio" || asset.role !== "sfx") issues.push({ path: `sfx[${index}]`, message: "efeito sonoro sem asset de áudio" });
    if (!(cue.atSeconds >= 0 && cue.atSeconds < plan.durationSeconds)) issues.push({ path: `sfx[${index}]`, message: "efeito fora do vídeo" });
    if (!(cue.gainDb <= 0 && cue.gainDb >= -40)) issues.push({ path: `sfx[${index}]`, message: "ganho do efeito fora de -40..0 dB" });
  }
  return { valid: issues.length === 0, issues };
}
