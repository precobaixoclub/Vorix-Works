/**
 * Porta de aplicação para renderização automática local de vídeo. Criada para que Rafa (Skill)
 * consiga transformar o plano técnico de edição de Diego em um MP4 real sem nunca importar
 * `node:child_process`, um binário de renderização específico ou qualquer módulo de
 * infraestrutura diretamente (ADR 0002: isolamento de Skills). Qualquer adaptador real desta
 * porta vive em `src/infrastructure/video-rendering/`.
 *
 * Esta porta cobre exclusivamente motion graphics automatizado (fundos sólidos/gradiente,
 * imagens locais, texto, legendas, CTA, logo, transições simples, zoom/pan suaves, trilha e
 * efeitos sonoros locais opcionais) — nunca geração de vídeo por IA, busca automática de B-roll
 * ou download de música. Ver `docs/video-rendering.md`.
 */

/** "video" cobre clipe real, b-roll e cinemagraph — todos compostos como stream de vídeo real (com trim/loop conforme necessário), nunca como imagem estática. */
export type VideoAssetKind = "image" | "video" | "audio";

/**
 * Um candidato a asset real a ser verificado antes da renderização — nunca uma sugestão em
 * texto livre (essas continuam exclusivamente em `brollSuggestions`/`musicSuggestions`/
 * `requiredAssets` do plano de Bruno/Diego, e nunca são tratadas como caminho de arquivo).
 */
export type VideoAssetCandidate = {
  /** Identificador estável usado para referenciar este asset dentro de `VideoRenderRequest`. */
  id: string;
  kind: VideoAssetKind;
  /** Caminho absoluto candidato no disco local. Caminhos relativos são sempre rejeitados. */
  path: string;
  /** De onde veio este candidato (ex.: "logoUri da Clara", "localAssets.backgroundImagePaths[1]") — só para logs/relatório. */
  sourceDescription: string;
  /** Quando true, a ausência deste asset bloqueia a renderização local (ver Rafa/`localAssets`). */
  required: boolean;
};

export type VideoAssetResolutionRequest = {
  candidates: VideoAssetCandidate[];
};

export type VideoAssetResolved = {
  id: string;
  kind: VideoAssetKind;
  resolved: true;
  absolutePath: string;
  sizeBytes: number;
};

export type VideoAssetUnresolved = {
  id: string;
  kind: VideoAssetKind;
  resolved: false;
  reason: string;
};

export type VideoAssetResolution = VideoAssetResolved | VideoAssetUnresolved;

export type VideoAssetResolutionResult = {
  resolutions: VideoAssetResolution[];
};

export type VideoSceneBackground =
  | { type: "solid"; color: string }
  | { type: "gradient"; colorTop: string; colorBottom: string }
  | { type: "image"; assetId: string };

/**
 * Estilo de transição explícito, decidido por Diego (`EditingSceneDecision.transition`,
 * `src/shared/utils/cinematic-reference-library.ts`) e apenas traduzido por Rafa/pelo compilador
 * de filtros para o nome real do efeito `xfade` do FFmpeg — nunca decidido pelo próprio
 * renderizador. Antes desta evolução, toda transição renderizava como um `fade` genérico,
 * independentemente do que Diego pedisse; ver `docs/video-cinematic-enrichment-report.md`.
 */
export type VideoSceneTransition = "cut" | "fade" | "dissolve" | "slide" | "wipe" | "whip" | "glow";

export type VideoZoomEffect = "none" | "in" | "out";
export type VideoPanEffect = "none" | "left_to_right" | "right_to_left";

export type VideoOverlayRole = "headline" | "caption" | "cta";

export type VideoSceneOverlay = {
  role: VideoOverlayRole;
  text: string;
};

export type VideoLogoPlacement = "top_left" | "top_right" | "bottom_left" | "bottom_right" | "center";

export type VideoMotionEasing = "linear" | "ease_in" | "ease_out" | "ease_in_out" | "back_out";

export type VideoMotionAnimation =
  | "none"
  | "fade"
  | "slide_up"
  | "slide_down"
  | "slide_left"
  | "slide_right"
  | "scale"
  | "pop"
  | "push"
  | "pull"
  | "parallax"
  | "mask_reveal"
  | "blur_reveal"
  | "glow_pulse"
  | "light_sweep"
  | "whip"
  | "floating";

export type VideoMotionLayerRole =
  | "background"
  | "main_image"
  | "mockup"
  | "detail_image"
  | "headline"
  | "subtitle"
  | "caption"
  | "card"
  | "cta"
  | "logo"
  | "overlay"
  | "gradient";

export type VideoMotionElement = {
  id: string;
  role: VideoMotionLayerRole;
  /** Para elementos visuais reais (mockup, imagem principal, logo, card com imagem). */
  assetId?: string;
  /** Para elementos tipográficos/renderizados pelo compositor. */
  text?: string;
  startSeconds: number;
  durationSeconds: number;
  exitStartSeconds?: number;
  exitDurationSeconds?: number;
  entrance: VideoMotionAnimation;
  exit?: VideoMotionAnimation;
  easing: VideoMotionEasing;
  priority: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  rotateDegrees?: number;
  shadow?: boolean;
  glow?: boolean;
  blur?: boolean;
  /** Painel translúcido estilo "glassmorphism" em vez da caixa escura padrão — só para texto do end card. */
  glass?: boolean;
  underline?: boolean;
  syncToBeat?: boolean;
};

export type VideoMotionComposition = {
  rhythm: "fast" | "medium" | "slow" | "impact";
  elements: VideoMotionElement[];
  notes?: string[];
};

export type VideoRenderScene = {
  order: number;
  startSeconds: number;
  durationSeconds: number;
  background: VideoSceneBackground;
  overlays: VideoSceneOverlay[];
  transitionToNext?: VideoSceneTransition;
  zoom?: VideoZoomEffect;
  pan?: VideoPanEffect;
  logo?: { assetId: string; placement: VideoLogoPlacement };
  /** Composição temporal por elemento. Mantém `overlays` como fallback/compatibilidade. */
  motion?: VideoMotionComposition;
  /**
   * SHOT RENDER ENGINE — quando presente, o renderizador usa cada Shot como unidade mínima de
   * renderização em vez da cena inteira. Cada Shot vira um input/subclip FFmpeg independente
   * com motion/transição/asset próprios. A soma das durações dos Shots deve casar com
   * `durationSeconds` da cena. Espelhado 1:1 do `shotTimeline` do plano de edição de Diego —
   * o renderer nunca redefine Shots, apenas obedece.
   */
  shotTimeline?: VideoRenderShot[];
};

/**
 * SHOT RENDER ENGINE — unidade mínima de renderização. Espelhado por convenção do
 * `DiegoShotTimelineEntry`/`Shot` da shared library, sem importar tipos da Skill Diego (ADR 0002).
 * Todos os campos são exigidos pelo renderizador para tratar cada Shot como um clipe
 * independente com asset, motion, texto, transição e sync com narração próprios.
 */
export type VideoRenderShot = {
  /** Id determinístico do Shot ("s{sceneOrder}-shot-{order}"). Nunca repetido no vídeo inteiro. */
  shotId: string;
  /** Ordem do Shot dentro da cena (1-based). */
  shotOrder: number;
  /** Ordem da cena a que este Shot pertence (usada para agrupamento semântico, não para render). */
  sceneOrder: number;
  /**
   * Finalidade narrativa: establishing | detail | human_interaction | product | reaction |
   * closing | hook_beat | cta_beat. Usada para escolher asset compatível quando o Shot não
   * declarou `assetId` explícito.
   */
  purpose: string;
  /** Instante absoluto (segundos) no vídeo em que este Shot começa. */
  startSeconds: number;
  /** Duração do Shot em segundos. Nunca < 0.4s. */
  durationSeconds: number;
  /** Ação/descrição concreta do que acontece no Shot (só para logs/relatórios). */
  action: string;
  /**
   * Asset dedicado a este Shot. Quando ausente, o renderer usa o asset da cena (background)
   * como fallback COM warning explícito — nunca reutiliza silenciosamente.
   */
  assetId?: string;
  /** Vocabulário de motion (do shared `ShotActionStyle`): drift, push_in, pan_left, zoom_in, etc. */
  motionAction?: string;
  /** Vocabulário de entrada (do shared `ShotEntranceStyle`): cut_in, fade_in, slide_in_left, whip_in, mask_reveal, etc. */
  motionEntrance?: string;
  /** Vocabulário de saída (do shared `ShotExitStyle`): cut_out, fade_out, whip_out, mask_hide, etc. */
  motionExit?: string;
  /** Transição de entrada para este Shot (fade/dissolve/cut/wipe/whip/glow). */
  entranceTransition?: VideoSceneTransition;
  /** Transição de saída deste Shot em direção ao próximo. */
  exitTransition?: VideoSceneTransition;
  /** Overlays de texto exclusivos deste Shot — nunca herda texto da cena inteira. */
  overlays?: VideoSceneOverlay[];
  /** Composição temporal específica deste Shot (elements com startSeconds relativo ao Shot). */
  motion?: VideoMotionComposition;
  /** Fio de continuidade herdado do Shot anterior (só para logs). */
  continuityFromPrevious?: string;
  /**
   * SHOT-LEVEL ASSET RESOLUTION — metadados observáveis do asset selecionado para este Shot pelo
   * VisualAssetResolver. Nunca usados pelo compilador FFmpeg (que só precisa de `assetId`); servem
   * para o `shot-render-plan.json` e o `shot-asset-map.json` documentarem o "porquê" da escolha,
   * o que Lucas usa para validar diversidade, continuidade, presença de produto real, etc.
   */
  assetMetadata?: {
    /** Tipo real do asset físico: photo | video | b_roll | cinemagraph | mockup | screenshot | graphic | illustration. */
    assetType: string;
    /** De onde veio o asset: local_library | free_provider | developer_assisted. */
    source: string;
    /** Licença resumida (name + allowsCommercialUse). */
    license: { name: string; allowsCommercialUse: boolean };
    /** Score final da seleção (0-100). */
    score?: number;
    /** Motivo humano-legível da seleção (ver `VisualAssetResolved.selectionReason`). */
    selectionReason?: string;
    /** Id do Shot anterior cujo asset foi reutilizado por este (mesma continuityGroup, ou reuse fallback). */
    reusedFromShotId?: string;
    /** Grupo de continuidade cinematográfica (Shots do mesmo grupo compartilham asset legitimamente). */
    continuityGroup?: string;
    /** Quando true, este asset foi criado via Developer Assisted Mode (não vem da biblioteca local nem de provedor gratuito). */
    wasDeveloperAssisted: boolean;
  };
};

export type VideoAudioTrackRole = "music" | "sound_effect" | "narration";

export type VideoAudioDuckWindow = {
  startSeconds: number;
  durationSeconds: number;
};

export type VideoAudioTrack = {
  assetId: string;
  role: VideoAudioTrackRole;
  startSeconds: number;
  volume: number;
  /** Fade-in em segundos a partir de `startSeconds` — normalmente só usado pela trilha (`role: "music"`). */
  fadeInSeconds?: number;
  /** Fade-out em segundos antes do fim da faixa — normalmente só usado pela trilha. */
  fadeOutSeconds?: number;
  /**
   * Ducking automático: momentos (em segundos, a partir do início do vídeo) em que este volume
   * deve cair temporariamente — usado pela trilha para abrir espaço para cada efeito sonoro
   * pontual, sem precisar de side-chain/compressor. Ignorado quando vazio/ausente.
   */
  duckAtSeconds?: number[];
  /** Janelas explícitas de ducking, usadas principalmente para abaixar a trilha durante a narração. */
  duckWindows?: VideoAudioDuckWindow[];
  /** Quanto reduzir o volume durante cada janela de ducking (0 a 1, fração do volume base). Padrão do compilador: 0.5. */
  duckAmount?: number;
  /** Duração de cada janela de ducking, em segundos. Padrão do compilador: 0.6s. */
  duckDurationSeconds?: number;
};

export type VideoRenderAsset = {
  id: string;
  kind: VideoAssetKind;
  /** Caminho absoluto já validado (existência, extensão, tamanho) — o adaptador nunca revalida. */
  absolutePath: string;
  /** Duração real do arquivo fonte, em segundos — só para `kind: "video"`. Usada para decidir se o clipe precisa de loop (mais curto que o tempo em tela) ou corte (mais longo). */
  sourceDurationSeconds?: number;
};

export type VideoRenderRequest = {
  executionId: string;
  /** Caminho relativo dentro de `artifacts/<executionId>/`, ex.: "videos/final-video.mp4". */
  outputRelativePath: string;
  width: number;
  height: number;
  fps: number;
  totalDurationSeconds: number;
  scenes: VideoRenderScene[];
  assets: VideoRenderAsset[];
  audioTracks: VideoAudioTrack[];
  /**
   * ASSET DIVERSITY GATE — perfil de qualidade sob o qual os assets desta execução foram
   * resolvidos (ver `src/application/ports/asset-quality-profile.ts`). Nunca usado pelo
   * compilador FFmpeg (que já recebeu a timeline final pronta) — só ecoado para
   * `shot-asset-map.json`.
   */
  assetQualityProfile?: string;
  /**
   * ASSET DIVERSITY GATE — snapshot do resultado do gate já calculado por Rafa ANTES desta
   * renderização começar (só chega aqui quando o gate passou — Rafa nunca chama `render()`
   * quando o gate bloqueia). Puramente informativo: o adapter apenas ecoa estes números para
   * `shot-asset-map.json`, nunca recalcula nem decide nada a partir deles.
   */
  assetDiversitySnapshot?: {
    distinctAssetIds: number;
    distinctPhysicalFiles: number;
    physicalFileHashes: string[];
    reuseRatio: number;
    maxUsagePerPhysicalFile: number;
    consecutiveReuseViolations: number;
    videoRatio: number;
    humanAssetCount: number;
    productAssetCount: number;
    contextAssetCount: number;
    diversityGatePassed: boolean;
    diversityGateFailures: string[];
  };
};

export type VideoRenderResult = {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  aspectRatio: string;
  fps: number;
  videoCodec: string;
  audioCodec?: string;
  hasAudio: boolean;
  renderTimeMs: number;
  logsSummary: string[];
  warnings: string[];
  /**
   * SHOT RENDER ENGINE — caminho relativo (dentro de `artifacts/<executionId>/`) do JSON com o
   * plano de renderização por Shot efetivamente compilado, gravado como `videos/shot-render-plan.json`.
   * Presente sempre que o adapter conseguiu gravar o arquivo; usado por Lucas/Rafa para inspecionar
   * quantos Shots foram renderizados, quais transições, qual asset por Shot, etc.
   */
  shotPlanRelativePath?: string;
  /**
   * SHOT-LEVEL ASSET RESOLUTION — caminho relativo do JSON com o mapa de assets por Shot
   * (`videos/shot-asset-map.json`): quantos assets distintos, reusos, DAM, licenças, diversidade.
   * Documenta o "porquê" da seleção de cada asset (nunca usado pelo compilador).
   */
  shotAssetMapRelativePath?: string;
  /**
   * SHOT RENDER ENGINE — resumo do plano de Shots renderizados. Espelhado em `VideoRenderResult`
   * (não no arquivo de plano) para que consumidores (Lucas) possam validar sem ler o arquivo.
   */
  shotPlanSummary?: {
    totalScenes: number;
    totalShots: number;
    renderedClips: number;
    plannedDurationSeconds: number;
    fallbackSceneOrders: number[];
  };
};

export type VideoRenderingPort = {
  /**
   * Verifica quais assets candidatos (imagens/áudio locais) realmente existem no disco, sem
   * renderizar nada. Nunca busca, baixa ou infere um asset — apenas valida caminhos já fornecidos.
   */
  resolveAssets(input: VideoAssetResolutionRequest): Promise<VideoAssetResolutionResult>;

  /** Renderiza o MP4 final localmente a partir de um plano já totalmente resolvido. */
  render(input: VideoRenderRequest): Promise<VideoRenderResult>;
};
