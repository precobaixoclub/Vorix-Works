/**
 * Aplica a direção audiovisual a um plano já montado (sem mudar tempos): intensidade de movimento pela
 * emoção e pela marca, parâmetros de movimento/composição/linha do tempo nas cenas animadas (Remotion),
 * trilha de reenquadramento nas falas, efeitos sonoros nos eventos visuais e as verificações objetivas.
 */

import type { EditClip, VideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";
import { audiovisualChecks, SFX_SECONDS, PLATFORM_SAFE_ZONE, planSfx, sceneDirection, type BrandMotion, type Emotion, type SfxKind, type VisualEvent, EMOTIONS } from "./audiovisual-direction.js";
import { smoothReframeTrack, type RoiSample } from "./reframe-track.js";

/** Frações da linha do tempo de cada template (o MESMO valor vai para o Remotion e para o som). */
export const TEMPLATE_TIMELINE: Record<string, Record<string, number>> = {
  product_hero: { reveal: 0.04, callout: 0.45 },
  detail_reveal: { openStart: 0.38, openEnd: 0.82, label: 0.72 },
  lineup: { first: 0.05, stagger: 0.1 },
  software_focus: { moveStart: 0.12, click: 0.32, zoomStart: 0.38, zoomEnd: 0.6, callout: 0.58 },
  title_card: { lines: 0.05, cta: 0.45 },
  speech_captions: {},
};

/** Altura da janela de vídeo das gravações de tela no template de fala (fração do quadro). */
export const SCREEN_WINDOW = 0.5;

const asEmotion =(value: string | undefined): Emotion | undefined => (EMOTIONS as readonly string[]).includes(value ?? "") ? (value as Emotion) : undefined;

function designEvents(clip: EditClip, index: number): VisualEvent[] {
  const t0 = clip.recordStartSeconds;
  const D = clip.durationSeconds;
  const tl = TEMPLATE_TIMELINE[clip.design?.template ?? ""] ?? {};
  const at = (fraction: number) => t0 + fraction * D;
  switch (clip.design?.template) {
    case "product_hero": return [{ atSeconds: at(tl.reveal!), kind: "reveal", strength: 0.8, clipIndex: index }, ...(clip.design.props.detail ? [{ atSeconds: at(tl.callout!), kind: "text" as const, strength: 0.5, clipIndex: index }] : [])];
    case "detail_reveal": return [{ atSeconds: at(tl.openStart!), kind: "move", strength: 0.7, clipIndex: index }, { atSeconds: at(tl.label!), kind: "reveal", strength: 0.6, clipIndex: index }];
    case "lineup": return [{ atSeconds: at(tl.first!), kind: "reveal", strength: 0.6, clipIndex: index }];
    case "software_focus": return [{ atSeconds: at(tl.click!), kind: "click", strength: 1, clipIndex: index }, { atSeconds: at(tl.zoomStart!), kind: "move", strength: 0.6, clipIndex: index }, { atSeconds: at(tl.callout!), kind: "text", strength: 0.45, clipIndex: index }];
    case "title_card": return [{ atSeconds: at(tl.lines!), kind: "text", strength: 0.5, clipIndex: index }, ...(clip.design.props.cta ? [{ atSeconds: at(tl.cta!), kind: "impact" as const, strength: 0.7, clipIndex: index }] : [])];
    default: return [];
  }
}

const TRANSITION_STRENGTH: Record<string, number> = { cut: 0.25, cross_dissolve: 0.35, dip_to_black: 0.4, smooth_left: 0.65, push_left: 0.75, push_up: 0.7, wipe: 0.7, zoom_in: 0.75, blur: 0.5, circle_open: 0.65, flash: 0.9 };

export type DirectionInput = {
  brandMotion: BrandMotion;
  story?: string;
  roi?: Record<string, { samples: RoiSample[]; aspect: number }>;
  sfx?: { enabled: boolean; assetFor: (kind: SfxKind) => { id: string; fileName: string } };
  beat?: { bpm: number; snapped: number; cuts: number };
};

export function applyAudiovisualDirection(plan: VideoEditPlan, input: DirectionInput): string[] {
  const warnings: string[] = [];
  const brand = input.brandMotion;
  plan.clips.forEach((clip, index) => {
    const emotion = asEmotion(clip.emotion);
    const direction = sceneDirection(brand, emotion);
    // Movimento de câmera pela emoção e pela marca (fala e aparelho já vêm limitados pelo construtor).
    // Teto: mídia com fidelidade protegida em tela cheia não passa de 0,6 (não corta produto/tela).
    if (emotion && clip.motion.intensity > 0 && !clip.keepSourceAudio) {
      const asset = plan.assets.find((item) => item.id === clip.assetId);
      const cap = asset?.protectedFidelity && clip.framing.fit === "fill" ? Math.max(clip.motion.intensity, 0.6) : 1;
      clip.motion = { ...clip.motion, intensity: Math.round(Math.min(cap, clip.motion.intensity * direction.intensity) * 1000) / 1000 };
    }
    if (!clip.design) return;
    const props = clip.design.props;
    props.motion = { personality: brand.personality, easing: direction.easing, intensity: direction.intensity, overshoot: direction.overshoot, radius: brand.radius, textCase: brand.textCase, letterSpacing: brand.letterSpacing, grain: brand.grain, glow: brand.glow, composition: direction.composition };
    if (emotion) props.emotion = emotion;
    props.safe = PLATFORM_SAFE_ZONE;
    props.timeline = TEMPLATE_TIMELINE[clip.design.template] ?? {};
    // Reenquadramento inteligente: trilha suave da região de interesse no trecho desta fala.
    if (clip.design.template === "speech_captions" && input.roi?.[clip.assetId]) {
      const { samples, aspect } = input.roi[clip.assetId]!;
      const start = clip.sourceInSeconds;
      const segment = samples.filter((s) => s.t >= start - 0.25 && s.t <= start + clip.durationSeconds + 0.25).map((s) => ({ ...s, t: Math.max(0, s.t - start) }));
      if (segment.length >= 2 && aspect > 1.05) {
        // Gravação de tela: janela de cima (58% da altura, legendas embaixo); pessoa: quadro inteiro.
        const screen = props.fit === "contain";
        const targetAspect = screen ? plan.width / (plan.height * SCREEN_WINDOW) : plan.width / plan.height;
        props.reframe = smoothReframeTrack(segment, { sourceAspect: aspect, targetAspect, zoom: 1 });
        props.reframeAspect = Math.round(targetAspect * 1000) / 1000;
        props.screen = screen;
        props.fit = "reframe";
      } else warnings.push(`cena ${index + 1}: sem dados de interesse para reenquadrar; quadro inteiro`);
    }
  });

  // Efeitos sonoros: transições e eventos das cenas animadas, densidade pela emoção, paleta pela marca.
  const speech = plan.clips.filter((clip) => clip.keepSourceAudio).map((clip) => ({ start: clip.recordStartSeconds, end: clip.recordStartSeconds + clip.durationSeconds }));
  let cues: ReturnType<typeof planSfx> = [];
  if (input.sfx?.enabled) {
    const events: VisualEvent[] = [];
    plan.clips.forEach((clip, index) => {
      if (index > 0) events.push({ atSeconds: Math.max(0, clip.recordStartSeconds - 0.12), kind: "transition", strength: TRANSITION_STRENGTH[clip.transitionIn.type] ?? 0.4, clipIndex: index });
      events.push(...designEvents(clip, index));
      for (const overlay of clip.overlays) if (overlay.role === "hook" || overlay.role === "cta") events.push({ atSeconds: clip.recordStartSeconds + overlay.startOffsetSeconds, kind: "text", strength: 0.45, clipIndex: index });
    });
    cues = planSfx({ events, durationSeconds: plan.durationSeconds, density: (i) => sceneDirection(brand, asEmotion(plan.clips[i]?.emotion)).sfxDensity, palette: brand.sfxPalette, speech });
    plan.sfx = cues.filter((cue) => cue.atSeconds < plan.durationSeconds - 0.1).map((cue) => {
      const asset = input.sfx!.assetFor(cue.kind);
      if (!plan.assets.some((item) => item.id === asset.id)) plan.assets.push({ id: asset.id, kind: "audio", role: "sfx", fileName: asset.fileName, sourceDurationSeconds: SFX_SECONDS[cue.kind] });
      return { assetId: asset.id, atSeconds: cue.atSeconds, gainDb: Math.round(cue.gainDb * 10) / 10 };
    });
  }

  plan.direction = {
    ...(input.story ? { story: input.story.slice(0, 300) } : {}),
    brandMotion: { ...brand },
    ...(input.beat ? { beat: input.beat } : {}),
    checks: audiovisualChecks({
      durationSeconds: plan.durationSeconds,
      clips: plan.clips.map((clip) => ({ durationSeconds: clip.durationSeconds, ...(clip.design ? { design: { template: clip.design.template } } : {}), transition: clip.transitionIn.type, texts: [...clip.overlays.map((o) => o.text), ...((clip.design?.props.lines as string[] | undefined) ?? []), ...[clip.design?.props.headline, clip.design?.props.label, clip.design?.props.kicker].filter((t): t is string => typeof t === "string")], emotion: clip.emotion })),
      sfx: cues,
      speech,
      ...(plan.music ? { music: { gainDb: plan.music.gainDb, duck: plan.music.duckUnderSpeech } } : {}),
      ...(input.beat ? { beats: { snapped: input.beat.snapped, cuts: input.beat.cuts } } : {}),
    }),
  };
  return warnings;
}
