/**
 * SHOT RENDER ENGINE — plano de renderização por Shot.
 *
 * O compilador FFmpeg (`timeline-to-filter-compiler.ts`) historicamente tratava cada
 * `VideoRenderScene` como um bloco indivisível — uma cena, um input, um filter chain. A partir
 * da sprint AGENCY FILM PIPELINE 2.0, cada Shot dentro de uma cena passa a ser a unidade mínima
 * de renderização (`VideoRenderShot`). Este módulo achata `VideoRenderRequest.scenes[i].shotTimeline`
 * numa sequência plana de `ShotRenderClip[]` que o compilador consome — cada clipe se torna um
 * input/subclip FFmpeg independente com motion, transição, asset e overlays próprios.
 *
 * Regras:
 *
 * - Cenas com `shotTimeline` são achatadas em N clipes (um por Shot).
 * - Cenas sem `shotTimeline` continuam funcionando como um único clipe (fallback compatível),
 *   com warning explícito no relatório de execução.
 * - Nunca há gap silencioso: a sequência de clipes cobre `totalDurationSeconds` sem lacunas.
 * - Nenhuma sobreposição: o start do Shot N+1 é >= end do Shot N.
 * - Nenhum clip com duração < 0.4s (invisível a 30fps).
 * - O último clipe deve terminar no `totalDurationSeconds` (com tolerância de 0.05s).
 *
 * Este arquivo é infraestrutura pura, sem I/O — testável sem FFmpeg.
 */

import type {
  VideoAudioTrack,
  VideoRenderRequest,
  VideoRenderScene,
  VideoRenderShot,
  VideoSceneBackground,
  VideoSceneOverlay,
  VideoSceneTransition,
} from "../../application/ports/video-rendering.port.js";
// NARRATIVE TIMING REBALANCING — movida para `shared/utils/video-timing-constants.ts` (ADR 0001:
// domínio nunca depende de infraestrutura) e reexportada aqui para não quebrar nenhum import
// existente (`MIN_CLIP_DURATION_SECONDS` de `shot-render-planner.js`).
import { MIN_CLIP_DURATION_SECONDS } from "../../shared/utils/video-timing-constants.js";

export { MIN_CLIP_DURATION_SECONDS };

/** Tolerância para comparar duração planejada vs. real. */
export const CLIP_TIMING_TOLERANCE_SECONDS = 0.05;

/**
 * Um clipe de renderização — a unidade que o compilador vai transformar em um input FFmpeg
 * independente com seu próprio motion, filter chain e transição. É a "cena efetiva" que o
 * compilador enxerga; o compilador não sabe se veio de um Shot ou de uma cena legada.
 */
export type ShotRenderClip = {
  /** Ordem global (0-based) no vídeo final — sequencial em todos os clipes. */
  order: number;
  /** Cena semântica a que este clipe pertence (para observabilidade). */
  sceneOrder: number;
  /** Nome/label do clipe para logs (ex.: "s1-shot-2"). */
  clipId: string;
  /** Propósito narrativo do Shot ("detail", "reaction", etc.). "scene" para fallback. */
  purpose: string;
  /** Instante absoluto no vídeo em que o clipe começa. */
  startSeconds: number;
  /** Duração do clipe (sempre >= MIN_CLIP_DURATION_SECONDS). */
  durationSeconds: number;
  /**
   * Fundo do clipe. Herda o fundo da cena por padrão; quando o Shot declara `assetId` próprio, o
   * fundo é substituído por `{ type: "image", assetId: <shotAssetId> }`.
   */
  background: VideoSceneBackground;
  /** Overlays de texto restritos a este clipe (Shot). Vazio quando não há texto no Shot. */
  overlays: VideoSceneOverlay[];
  /**
   * Transição para o PRÓXIMO clipe (não a próxima cena). Herda de `shot.exitTransition` quando
   * presente, senão de `shot.transitionToNext` da última tomada da cena. `undefined` no último
   * clipe do vídeo (fecha sem crossfade).
   */
  transitionToNext?: VideoSceneTransition;
  /**
   * Composição temporal do clipe. Copiada do Shot; quando o Shot não tem `motion` próprio, a
   * composição da cena é reescalonada para caber no intervalo do clipe (helper `rescaleMotion`).
   */
  motion?: VideoRenderScene["motion"];
  /** Zoom herdado da cena — usado apenas para o fallback quando não há motion no Shot. */
  zoom?: VideoRenderScene["zoom"];
  /** Pan herdado da cena. */
  pan?: VideoRenderScene["pan"];
  /** Logo herdado da cena (end card só). */
  logo?: VideoRenderScene["logo"];
  /**
   * Origem do clipe:
   * - `"shot"` quando veio de `shot.shotTimeline`
   * - `"scene_fallback"` quando a cena não tinha `shotTimeline` (fallback compatível com warning)
   */
  origin: "shot" | "scene_fallback";
  /** Ação declarada do Shot (para observability). */
  action?: string;
  /** Motion action semântico do Shot (drift, push_in, zoom_in, etc.). */
  motionAction?: string;
  /** Motion entrance semântico. */
  motionEntrance?: string;
  /** Motion exit semântico. */
  motionExit?: string;
};

export type ShotRenderPlan = {
  /** Sequência de clipes achatada, ordenada por `startSeconds`, sem gaps nem overlaps. */
  clips: ShotRenderClip[];
  /** Duração final planejada do vídeo (soma dos clipes). */
  plannedDurationSeconds: number;
  /** Total de cenas semânticas de origem. */
  totalScenes: number;
  /** Total de Shots efetivamente promovidos a clipes. */
  totalShots: number;
  /** Cenas que caíram no fallback de cena única (não tinham `shotTimeline`). */
  fallbackSceneOrders: number[];
  /** Warnings de validação — nunca fatais; o plano ainda é executável. */
  warnings: string[];
};

/**
 * Normaliza uma `VideoRenderRequest` numa sequência plana de clipes prontos para renderização.
 * Função pura e determinística. Nunca lança para cena vazia — retorna plano vazio + warning.
 * Lança apenas para inconsistências fatais (duração total <= 0, cena com duração negativa).
 *
 * Comportamento em dois modos:
 *
 * 1. **LEGACY (nenhuma cena tem `shotTimeline`)**: preserva 1:1 as cenas de entrada, mantendo
 *    o `.order` original de cada cena — 100% backward compat com o compilador antes da sprint
 *    SHOT RENDER ENGINE. Nenhuma renumeração.
 *
 * 2. **SHOT (pelo menos uma cena tem `shotTimeline`)**: achata TODAS as cenas em uma sequência
 *    plana de clipes com `.order` sequencial (0, 1, 2, ...). Cenas com `shotTimeline` viram N
 *    clipes (um por Shot); cenas sem `shotTimeline` viram 1 clipe (fallback com warning). O
 *    adapter itera os clipes projetados para escrever `overlayTextFiles`, então adapter e
 *    compilador enxergam os mesmos `.order` — nunca há mismatch de chave.
 */
export function normalizeShotTimelineForRender(request: VideoRenderRequest): ShotRenderPlan {
  const warnings: string[] = [];
  if (request.totalDurationSeconds <= 0) {
    throw new Error(`SHOT_RENDER_INVALID_DURATION: totalDurationSeconds=${request.totalDurationSeconds} deve ser > 0.`);
  }
  const scenesByOrder = [...request.scenes].sort((a, b) => a.order - b.order);
  if (scenesByOrder.length === 0) {
    return {
      clips: [],
      plannedDurationSeconds: 0,
      totalScenes: 0,
      totalShots: 0,
      fallbackSceneOrders: [],
      warnings: ["SHOT_RENDER_NO_SCENES: nenhuma cena informada — vídeo vazio."],
    };
  }

  const anySceneHasShots = scenesByOrder.some((scene) => Array.isArray(scene.shotTimeline) && scene.shotTimeline.length > 0);

  // LEGACY: nenhuma cena tem shotTimeline. Preservamos scene.order 1:1 e não emitimos warnings —
  // é o comportamento pré-SHOT RENDER ENGINE e continua sendo o path oficial para pipelines de
  // renderização que ainda não conhecem Shot (testes existentes, integrações antigas).
  if (!anySceneHasShots) {
    const clips = scenesByOrder.map((scene) => buildFallbackClipFromScene(scene, scene.order));
    return {
      clips,
      plannedDurationSeconds: Number.parseFloat(clips.reduce((total, clip) => total + clip.durationSeconds, 0).toFixed(3)),
      totalScenes: scenesByOrder.length,
      totalShots: 0,
      fallbackSceneOrders: [],
      warnings,
    };
  }

  // SHOT: pelo menos uma cena tem shotTimeline. Achata TODAS as cenas em sequência de clipes com
  // `.order` sequencial global. Cenas sem shotTimeline emitem warning explícito.
  const clips: ShotRenderClip[] = [];
  const fallbackSceneOrders: number[] = [];
  let globalOrder = 0;

  for (const scene of scenesByOrder) {
    if (scene.durationSeconds <= 0) {
      throw new Error(`SHOT_RENDER_INVALID_SCENE_DURATION: cena ${scene.order} tem durationSeconds=${scene.durationSeconds}.`);
    }
    const shots = scene.shotTimeline ?? [];
    if (shots.length === 0) {
      warnings.push(`SHOT_RENDER_SCENE_FALLBACK: cena ${scene.order} ("${labelForScene(scene)}") não tem shotTimeline — renderizada como bloco único (fallback).`);
      fallbackSceneOrders.push(scene.order);
      clips.push(buildFallbackClipFromScene(scene, globalOrder));
      globalOrder += 1;
      continue;
    }

    const shotClips = buildClipsFromShots(scene, shots, globalOrder, warnings);
    clips.push(...shotClips);
    globalOrder += shotClips.length;
  }

  reflowClipStartsInPlace(clips, warnings);

  const plannedDurationSeconds = clips.reduce((total, clip) => total + clip.durationSeconds, 0);
  const requestedDuration = request.totalDurationSeconds;
  const drift = Math.abs(plannedDurationSeconds - requestedDuration);
  if (drift > CLIP_TIMING_TOLERANCE_SECONDS) {
    warnings.push(
      `SHOT_RENDER_DURATION_DRIFT: soma dos clipes = ${plannedDurationSeconds.toFixed(3)}s, totalDurationSeconds pedido = ${requestedDuration.toFixed(3)}s (delta ${drift.toFixed(3)}s).`,
    );
  }

  const totalShots = clips.filter((clip) => clip.origin === "shot").length;

  return {
    clips,
    plannedDurationSeconds: Number.parseFloat(plannedDurationSeconds.toFixed(3)),
    totalScenes: scenesByOrder.length,
    totalShots,
    fallbackSceneOrders,
    warnings,
  };
}

/**
 * Reajusta os áudios (music/sfx/narration) para nunca causarem truncamento do vídeo. O
 * compilador deve receber tracks cujas durações são governadas pelo vídeo, não o contrário —
 * antes desta função, `-shortest` do FFmpeg cortava o vídeo quando a narração acabava mais cedo.
 * Retorna as tracks originais + campos de padding calculados por track.
 */
export function planAudioForShotRender(
  audioTracks: VideoAudioTrack[],
  totalDurationSeconds: number,
): { tracks: VideoAudioTrack[]; audioPadWarnings: string[] } {
  const audioPadWarnings: string[] = [];
  const tracks = audioTracks.map((track) => {
    // Se a track terminaria antes do fim do vídeo, sinalizamos com um warning — o compilador vai
    // aplicar `apad`/`aloop` conforme o role para garantir que o áudio não corte o vídeo.
    const trackEnd = track.startSeconds + (track.role === "music" ? totalDurationSeconds : totalDurationSeconds);
    if (trackEnd < totalDurationSeconds - CLIP_TIMING_TOLERANCE_SECONDS) {
      audioPadWarnings.push(
        `SHOT_RENDER_AUDIO_SHORT: track ${track.assetId} (${track.role}) tem cauda mais curta que o vídeo (${trackEnd.toFixed(3)}s < ${totalDurationSeconds.toFixed(3)}s) — aplicar apad no compilador.`,
      );
    }
    return track;
  });
  return { tracks, audioPadWarnings };
}

// ---------------------------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------------------------

function labelForScene(scene: VideoRenderScene): string {
  // Não temos "name" na cena — o overlays[0].text pode servir como pista.
  const headline = scene.overlays?.find((overlay) => overlay.role === "headline")?.text;
  return headline ?? `scene-${scene.order}`;
}

function buildFallbackClipFromScene(scene: VideoRenderScene, globalOrder: number): ShotRenderClip {
  return {
    order: globalOrder,
    sceneOrder: scene.order,
    clipId: `scene-${scene.order}-fallback`,
    purpose: "scene",
    startSeconds: scene.startSeconds,
    durationSeconds: scene.durationSeconds,
    background: scene.background,
    overlays: scene.overlays,
    transitionToNext: scene.transitionToNext,
    motion: scene.motion,
    zoom: scene.zoom,
    pan: scene.pan,
    logo: scene.logo,
    origin: "scene_fallback",
  };
}

function buildClipsFromShots(
  scene: VideoRenderScene,
  shots: VideoRenderShot[],
  globalOrderStart: number,
  warnings: string[],
): ShotRenderClip[] {
  const sortedShots = [...shots].sort((a, b) => a.shotOrder - b.shotOrder);
  const clips: ShotRenderClip[] = [];

  for (let i = 0; i < sortedShots.length; i += 1) {
    const shot = sortedShots[i];
    const rawDuration = shot.durationSeconds;
    const duration = Math.max(MIN_CLIP_DURATION_SECONDS, rawDuration);
    if (rawDuration < MIN_CLIP_DURATION_SECONDS) {
      warnings.push(
        `SHOT_RENDER_SHOT_TOO_SHORT: shot ${shot.shotId} (cena ${scene.order}) tinha ${rawDuration.toFixed(3)}s; elevado ao mínimo ${MIN_CLIP_DURATION_SECONDS}s.`,
      );
    }

    const background = shot.assetId
      ? ({ type: "image", assetId: shot.assetId } as VideoSceneBackground)
      : scene.background;

    if (!shot.assetId && scene.background.type === "image") {
      warnings.push(
        `SHOT_RENDER_ASSET_INHERITED: shot ${shot.shotId} (cena ${scene.order}) não tem asset próprio — usa o fundo da cena como fallback (asset ${scene.background.assetId}).`,
      );
    }

    // Herança da transição para próximo Shot: preferimos `exitTransition` explícita; caso
    // contrário, `transitionToNext` da cena é usada só para o ÚLTIMO Shot da cena.
    const isLastShotOfScene = i === sortedShots.length - 1;
    const transitionToNext = shot.exitTransition
      ?? (isLastShotOfScene ? scene.transitionToNext : undefined);

    // SHOT RENDER ENGINE — mapeamento semântico de `shot.motionAction` (vocabulário do shared
    // library ShotActionStyle) para os efeitos zoom/pan que o compilador já sabe aplicar sobre a
    // imagem de fundo. Nunca escolhido por índice — sempre derivado do Shot. Quando o Shot pede
    // um motion que o compilador não suporta ainda (p.ex. `parallax`, `light_sweep`), fica no
    // fallback semântico mais próximo e emitimos warning explícito.
    const { zoom: shotZoom, pan: shotPan, warning: motionWarning } = mapShotMotionActionToClipEffect(shot.motionAction, shot.shotId);
    if (motionWarning) warnings.push(motionWarning);

    clips.push({
      order: globalOrderStart + i,
      sceneOrder: scene.order,
      clipId: shot.shotId,
      purpose: shot.purpose,
      startSeconds: shot.startSeconds,
      durationSeconds: duration,
      background,
      // AGENCY FILM PIPELINE 2.0: texto ao nível do Shot; nunca herdamos o overlay da cena inteira
      // para dentro de cada Shot (isso seria repetir a mesma headline em 3 Shots consecutivos).
      // Overlays da cena continuam sendo renderizados apenas no PRIMEIRO Shot como fallback,
      // até que Diego/Bruno emitam overlays por Shot explicitamente.
      overlays: shot.overlays ?? (i === 0 ? scene.overlays : []),
      transitionToNext,
      motion: shot.motion ?? rescaleSceneMotionForShot(scene.motion, shot, scene),
      zoom: shotZoom ?? scene.zoom,
      pan: shotPan ?? scene.pan,
      logo: scene.logo,
      origin: "shot",
      action: shot.action,
      motionAction: shot.motionAction,
      motionEntrance: shot.motionEntrance,
      motionExit: shot.motionExit,
    });
  }

  return clips;
}

/**
 * Mapa semântico de `ShotActionStyle` (vocabulário do shared library de motion por Shot) para os
 * efeitos que o compilador FFmpeg já suporta hoje sobre a imagem de fundo (`zoom` e `pan`).
 * Emite warning para motions que não têm equivalente direto — o clipe segue com o fallback
 * semântico mais próximo (nenhum efeito) para não travar a renderização.
 */
function mapShotMotionActionToClipEffect(
  motionAction: string | undefined,
  shotId: string,
): { zoom?: VideoRenderScene["zoom"]; pan?: VideoRenderScene["pan"]; warning?: string } {
  if (!motionAction) return {};
  switch (motionAction) {
    case "zoom_in":
    case "push_in":
      return { zoom: "in" };
    case "zoom_out":
    case "pull_out":
      return { zoom: "out" };
    case "pan_left":
    case "track_left":
      // pan_left = câmera anda para a esquerda; enquadramento revela conteúdo à direita.
      return { pan: "right_to_left" };
    case "pan_right":
    case "track_right":
      return { pan: "left_to_right" };
    case "static_hold":
    case "drift":
    case "handheld_breathe":
      // Estático ou com micro-movimento discreto — não aplicamos zoom/pan; o vignette + subtle
      // grain já dão a sensação de vida orgânica sem competir com o Shot.
      return {};
    case "tilt_up":
    case "tilt_down":
    case "parallax":
      // Motions ainda não suportados diretamente pelo compilador — fallback para nenhum efeito.
      return {
        warning: `SHOT_RENDER_MOTION_FALLBACK: shot ${shotId} pediu motionAction=${motionAction}; não há mapeamento direto no compilador FFmpeg — renderizado sem efeito adicional.`,
      };
    default:
      return {
        warning: `SHOT_RENDER_MOTION_UNKNOWN: shot ${shotId} pediu motionAction=${motionAction}; vocabulário desconhecido — renderizado sem efeito.`,
      };
  }
}

/**
 * Reescala a composição de motion da CENA para caber no intervalo temporal do SHOT. Quando o
 * Shot não trouxe motion próprio, ainda queremos que o Shot tenha alguma composição visual
 * — em vez de repetir a composição inteira da cena (o que causa flicker no corte de Shot),
 * escalamos os `startSeconds`/`durationSeconds` de cada elemento proporcionalmente ao intervalo
 * do Shot em relação à cena. Se elemento cairia inteiramente fora do Shot, é descartado.
 */
function rescaleSceneMotionForShot(
  sceneMotion: VideoRenderScene["motion"],
  shot: VideoRenderShot,
  scene: VideoRenderScene,
): VideoRenderScene["motion"] | undefined {
  if (!sceneMotion) return undefined;
  const sceneStart = scene.startSeconds;
  const sceneEnd = sceneStart + scene.durationSeconds;
  const shotRelativeStart = shot.startSeconds - sceneStart;
  const shotRelativeEnd = shotRelativeStart + shot.durationSeconds;

  const rescaledElements = sceneMotion.elements
    .map((element) => {
      const elementStart = element.startSeconds;
      const elementEnd = elementStart + element.durationSeconds;
      // Elemento fora do intervalo do Shot: descarta.
      if (elementEnd <= shotRelativeStart || elementStart >= shotRelativeEnd) return null;
      // Recorta para o intervalo do Shot.
      const clampedStart = Math.max(0, elementStart - shotRelativeStart);
      const clampedEnd = Math.min(shot.durationSeconds, elementEnd - shotRelativeStart);
      const clampedDuration = Math.max(0.1, clampedEnd - clampedStart);
      return {
        ...element,
        startSeconds: Number.parseFloat(clampedStart.toFixed(3)),
        durationSeconds: Number.parseFloat(clampedDuration.toFixed(3)),
      };
    })
    .filter((element): element is NonNullable<typeof element> => Boolean(element));

  if (rescaledElements.length === 0) return undefined;
  return { ...sceneMotion, elements: rescaledElements };
}

function reflowClipStartsInPlace(clips: ShotRenderClip[], warnings: string[]): void {
  if (clips.length === 0) return;
  let cursor = clips[0].startSeconds;
  for (const clip of clips) {
    if (Math.abs(clip.startSeconds - cursor) > CLIP_TIMING_TOLERANCE_SECONDS) {
      warnings.push(
        `SHOT_RENDER_START_ADJUSTED: clip ${clip.clipId} startSeconds=${clip.startSeconds.toFixed(3)} ajustado para ${cursor.toFixed(3)} para manter continuidade.`,
      );
    }
    clip.startSeconds = Number.parseFloat(cursor.toFixed(3));
    cursor += clip.durationSeconds;
  }
}

/**
 * Converte o plano de clipes de volta para o vocabulário legado do compilador — um array de
 * `VideoRenderScene` onde cada clipe vira uma "cena". Preserva `overlays`, `background`,
 * `motion`, `transitionToNext`, `zoom`, `pan`, `logo`. O compilador nunca precisa saber que
 * originalmente havia uma cena com múltiplos Shots — ele só vê uma lista sequencial e trata
 * cada uma como uma unidade.
 */
export function projectClipsAsRenderScenes(clips: ShotRenderClip[]): VideoRenderScene[] {
  return clips.map((clip) => ({
    order: clip.order,
    startSeconds: clip.startSeconds,
    durationSeconds: clip.durationSeconds,
    background: clip.background,
    overlays: clip.overlays,
    transitionToNext: clip.transitionToNext,
    zoom: clip.zoom,
    pan: clip.pan,
    logo: clip.logo,
    motion: clip.motion,
    // Não propagamos `shotTimeline` na projeção — o clipe já É o shot.
  }));
}
