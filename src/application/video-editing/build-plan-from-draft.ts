/**
 * Rascunho da IA → plano de edição completo e validado. Determinístico e sem I/O.
 *
 * A IA decide o QUÊ (ordem, ritmo, movimento, transições, textos); aqui se decide o COMO de forma
 * previsível: trechos de fala a partir das frases (sem partir palavra), enquadramento por formato,
 * duração ajustada à pedida, transições compatíveis com fala, estilos de texto da marca, legendas da
 * transcrição, trilha e logo. O que a IA pedir e for incompatível vira aviso, nunca erro silencioso.
 */

import type { EditClip, EditMediaAsset, EditTextOverlay, EditTextPosition, EditTextRole, EditTextStyle, EditTransitionType, VideoAspect, VideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";
import { OVERLAP_TRANSITIONS, VIDEO_FORMATS, validateVideoEditPlan } from "../../domain/video-editing/video-edit-plan.js";
import type { VideoEditDraft } from "../ai-gateway/schemas/video-edit-draft.v1.js";
import { captionsFromTranscript, chooseFraming, snapRangeToWords, transcriptWords, type BrandGlossary, type Transcript, type TranscriptSentence } from "./transcript-tools.js";

export type PlanningMaterialRole = "footage" | "screen_recording" | "product_photo" | "screenshot" | "logo" | "music" | "narration" | "reference" | "generated";

export type PlanningMaterial = {
  /** Id exposto à IA ("M1", "M2"…); vira o id do asset no plano. */
  id: string;
  /** Nome simples do arquivo na pasta do job. */
  fileName: string;
  kind: "video" | "image" | "audio";
  role: PlanningMaterialRole;
  label?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  hasSpeech?: boolean;
  colors?: string[];
};

export type BrandStyle = {
  name: string;
  tone?: string;
  primaryHex: string;
  accentHex: string;
  lightHex: string;
  darkHex: string;
  displayFont?: string;
  bodyFont?: string;
  /** Cor do cartão final quando não é a primária (a logo disponível pede outro fundo). */
  cardHex?: string;
  glossary?: BrandGlossary;
  ctaExamples?: string[];
};

export type VideoStyleOptions = {
  editing: "dinamico" | "elegante" | "direto";
  transitions: "suaves" | "moderadas" | "marcantes";
  captions: boolean;
  music: boolean;
};

export type BuildPlanContext = {
  planId: string;
  workspaceId: string;
  aspect: VideoAspect;
  request: string;
  targetDurationSeconds?: number;
  style: VideoStyleOptions;
  materials: PlanningMaterial[];
  transcripts: Record<string, Transcript>;
  sentences: TranscriptSentence[];
  brand: BrandStyle;
  logoMaterialId?: string;
  musicMaterialId?: string;
};

export type BuildPlanResult = { ok: true; plan: VideoEditPlan; warnings: string[] } | { ok: false; issues: string[]; warnings: string[] };

const FPS = 30;
const OVERLAP = new Set<EditTransitionType>(OVERLAP_TRANSITIONS);
// Movimento visível (Ken Burns de ~6% a ~15% na cena): abaixo disso a peça parece apresentação de fotos.
const INTENSITY = { subtle: 0.35, medium: 0.6, strong: 0.85 } as const;
const TRANSITION_SECONDS = { suaves: 0.6, moderadas: 0.45, marcantes: 0.3 } as const;
const FOCUS = { center: [0.5, 0.5], top: [0.5, 0.3], bottom: [0.5, 0.7], left: [0.3, 0.5], right: [0.7, 0.5] } as const;

const frame = (seconds: number) => Math.round(seconds * FPS) / FPS;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastText(background: string, brand: BrandStyle): string {
  // Cruzamento do WCAG: escolhe sempre a cor de texto com maior contraste (dourado pede texto escuro).
  return luminance(background) > 0.179 ? brand.darkHex : "#FFFFFF";
}
function mix(hex: string, other: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  return `#${a.map((v, i) => Math.round(v * (1 - amount) + b[i]! * amount).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
function darken(hex: string, amount: number): string {
  return `#${hexToRgb(hex).map((v) => Math.round(v * (1 - amount)).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function textStyle(role: EditTextRole, context: BuildPlanContext): EditTextStyle {
  const { brand, aspect, style } = context;
  const scale = aspect === "9:16" ? 1 : aspect === "1:1" ? 1.08 : 1.3;
  const display = brand.displayFont ?? (style.editing === "elegante" ? "DM Serif Display" : "Barlow Condensed");
  const base: Record<EditTextRole, { size: number; background?: string; font: string }> = {
    hook: { size: 0.056, background: brand.primaryHex, font: display },
    headline: { size: 0.044, background: brand.darkHex, font: display },
    cta: { size: 0.05, background: brand.accentHex, font: display },
    price: { size: 0.05, background: brand.lightHex, font: display },
    subtitle: { size: 0.038, background: brand.darkHex, font: brand.bodyFont ?? display },
    // Legenda da fala: sans bold, sempre (serifa com contorno embola as letras no celular).
    caption: { size: 0.05, background: "#141414", font: "Barlow Condensed" },
  };
  const spec = base[role];
  return { size: Math.min(0.12, round3(spec.size * scale)), colorHex: spec.background ? contrastText(spec.background, brand) : "#FFFFFF", backgroundHex: spec.background, bold: spec.font !== "DM Serif Display", fontFamily: spec.font };
}

export function buildPlanFromDraft(draft: VideoEditDraft, context: BuildPlanContext): BuildPlanResult {
  const warnings: string[] = [...draft.warnings.map((warning) => `IA: ${warning}`)];
  const issues: string[] = [];
  const materials = new Map(context.materials.map((material) => [material.id, material]));
  const sentences = new Map(context.sentences.map((sentence) => [sentence.id, sentence]));
  const { width, height } = VIDEO_FORMATS[context.aspect];

  const assets: EditMediaAsset[] = [];
  const addAsset = (asset: EditMediaAsset) => {
    if (!assets.some((existing) => existing.id === asset.id)) assets.push(asset);
  };
  const cardId = "CARD";

  type Built = { clip: Omit<EditClip, "recordStartSeconds">; speech: boolean; flexible: boolean };
  const built: Built[] = [];

  draft.scenes.forEach((scene, index) => {
    const path = `cena ${index + 1}`;
    let asset: EditMediaAsset;
    let sourceIn = 0;
    let duration = scene.durationSeconds;
    let speech = false;
    if (scene.materialId === cardId) {
      // Cartão: cor principal da marca. O cartão FINAL com logo usa a cor que a logo oficial pede (cardHex);
      // preto puro ganha um toque da cor de destaque (nunca "tela preta").
      const closing = index === draft.scenes.length - 1 && draft.logo === "end" && Boolean(context.logoMaterialId) && Boolean(context.brand.cardHex);
      const base = closing ? context.brand.cardHex! : context.brand.primaryHex;
      const cardColor = luminance(base) < 0.012 ? mix(base, context.brand.accentHex, 0.22) : base.toUpperCase();
      asset = { id: closing ? "CARDEND" : cardId, kind: "card", role: "card", card: { colorHex: cardColor, gradientToHex: darken(cardColor, luminance(cardColor) > 0.5 ? 0.14 : 0.38) } };
    } else {
      const material = materials.get(scene.materialId);
      if (!material || material.kind === "audio") {
        issues.push(`${path}: material "${scene.materialId}" inválido`);
        return;
      }
      asset = { id: material.id, kind: material.kind, role: material.role === "product_photo" ? "product_photo" : material.role === "screenshot" || material.role === "screen_recording" ? "screenshot" : material.role === "logo" ? "logo" : material.role === "generated" && material.kind === "image" ? "generated" : "footage", fileName: material.fileName, width: material.width, height: material.height, sourceDurationSeconds: material.durationSeconds, protectedFidelity: material.role === "product_photo" || material.role === "screenshot" || material.role === "screen_recording" };
      if (material.kind === "video") {
        if (scene.sentenceIds?.length) {
          const picked = scene.sentenceIds.map((id) => sentences.get(id)).filter((sentence): sentence is TranscriptSentence => Boolean(sentence));
          const words = transcriptWords(context.transcripts[material.id] ?? { segments: [] });
          const range = picked.length ? snapRangeToWords(words, picked[0]!.start, picked[picked.length - 1]!.end) : null;
          if (!range) {
            issues.push(`${path}: frases não encontradas na transcrição`);
            return;
          }
          sourceIn = range.start;
          duration = range.end - range.start;
          speech = Boolean(material.hasSpeech);
        } else {
          sourceIn = Math.max(0, Math.min(scene.sourceStartSeconds ?? 0, (material.durationSeconds ?? duration) - duration));
          duration = Math.min(duration, (material.durationSeconds ?? duration) - sourceIn);
        }
      }
    }
    addAsset(asset);

    // Enquadramento: produto/tela inteiros quando o formato cortaria demais; gravação de tela no
    // vertical ganha zoom para leitura; pessoa falando em 16:9 → corte central no 9:16.
    const material = materials.get(scene.materialId);
    let fit = chooseFraming(asset, context.aspect);
    let zoom: number | undefined;
    if (material?.role === "footage" && context.aspect !== "16:9") fit = "fill";
    if (material?.role === "screen_recording" && fit === "fit" && context.aspect === "9:16") zoom = 1.4;
    // Vídeo com composição pedida (framed/split/aparelho): mostrar o quadro inteiro (gravação de tela não
    // pode perder as laterais no vertical), com aproximação para leitura.
    const videoWhole = asset.kind === "video" && scene.layout && scene.layout !== "full" && scene.layout !== "parallax" && scene.layout !== "inset";
    if (videoWhole) {
      fit = "fit";
      zoom = context.aspect === "9:16" && (asset.width ?? 0) > (asset.height ?? 0) ? 1.3 : undefined;
    }
    const [focusX, focusY] = FOCUS[scene.focus];

    const protectedMedia = asset.protectedFidelity === true;
    let intensity: number = INTENSITY[scene.motionIntensity];
    if (speech) intensity = Math.min(intensity, 0.2);
    if (protectedMedia && fit === "fill") intensity = Math.min(intensity, 0.6);

    // Composição: só imagem; aparelho só para captura real; lupa só para produto.
    let layout = scene.layout ?? "full";
    if (layout !== "full" && asset.kind !== "image") {
      if (!videoWhole) warnings.push(`${path}: composição ${layout} é só para imagem; usada tela cheia`);
      layout = "full";
    }
    if ((layout === "device_phone" || layout === "device_laptop") && asset.role !== "screenshot") layout = "framed";
    // Aparelho pela orientação da captura: tela horizontal (desktop) nunca é recortada num celular.
    const landscape = (asset.width ?? 1) >= (asset.height ?? 1);
    if (layout === "inset" && asset.role === "screenshot") layout = landscape ? "device_laptop" : "device_phone";
    if (layout === "device_phone" && landscape) layout = "device_laptop";

    // Aparelho/painel: a câmera anda pouco (o aparelho não pode sair do quadro).
    if (layout === "device_phone" || layout === "device_laptop" || layout === "split") intensity = Math.min(intensity, 0.35);
    // Foto parada não existe em Reels: "static" em imagem vira deriva lenta (cartão com texto continua parado).
    let motionType = scene.motion;
    if (motionType === "static" && asset.kind === "image") {
      motionType = "drift";
      intensity = Math.max(intensity, 0.3);
    }

    const overlays: EditTextOverlay[] = scene.texts.map((text, textIndex) => {
      let position: EditTextPosition = text.position;
      // No split o texto vai para o painel da marca, nunca sobre o produto.
      if (protectedMedia && position === "center" && layout !== "split") {
        position = "top";
        warnings.push(`${path}: texto movido do centro para o topo (não cobre o produto)`);
      }
      return { id: `t${index + 1}-${textIndex + 1}`, role: text.role, text: text.text.trim(), startOffsetSeconds: 0, durationSeconds: 0, position, animation: text.animation, style: textStyle(text.role, context) };
    });
    if (overlays.length === 2 && overlays[0]!.position === overlays[1]!.position) overlays[1]!.position = overlays[0]!.position === "top" ? "bottom" : "top";
    // Painel do split com dois textos: um em cima e outro embaixo (no centro e no topo eles se encostam).
    if (layout === "split" && overlays.length === 2) {
      overlays[0]!.position = "top";
      overlays[1]!.position = "bottom";
    }

    built.push({
      speech,
      flexible: asset.kind !== "video",
      clip: { id: `c${index + 1}`, assetId: asset.id, purpose: scene.purpose, sourceInSeconds: round3(sourceIn), durationSeconds: duration, motion: { type: motionType, intensity }, framing: { fit: asset.kind === "card" ? "fill" : fit, focusX, focusY, ...(zoom ? { zoom } : {}) }, transitionIn: { type: scene.transitionIn, durationSeconds: 0 }, overlays, keepSourceAudio: speech, ...(layout !== "full" ? { layout } : {}) },
    });
  });
  if (issues.length > 0) return { ok: false, issues, warnings };
  if (built.length === 0) return { ok: false, issues: ["nenhuma cena utilizável"], warnings };

  // Transições: duração pela intensidade pedida; fala → fala é sempre corte (vozes não se sobrepõem).
  const transitionSeconds = TRANSITION_SECONDS[context.style.transitions];
  built.forEach((item, index) => {
    const t = item.clip.transitionIn;
    if (index === 0) {
      if (t.type !== "cut") item.clip.transitionIn = { type: "dip_to_black", durationSeconds: 0.4 };
      return;
    }
    const previous = built[index - 1]!;
    if (item.speech && previous.speech && t.type !== "cut") {
      item.clip.transitionIn = { type: "cut", durationSeconds: 0 };
      return;
    }
    item.clip.transitionIn = { type: t.type, durationSeconds: t.type === "cut" ? 0 : t.type === "dip_to_black" ? Math.max(0.3, transitionSeconds) : transitionSeconds };
  });

  // Duração pedida: só cenas flexíveis (foto/cartão) esticam ou encolhem; fala mantém o tempo real.
  const overlapOf = (index: number) => (index > 0 && OVERLAP.has(built[index]!.clip.transitionIn.type) ? built[index]!.clip.transitionIn.durationSeconds : 0);
  const total = () => built.reduce((sum, item, index) => sum + item.clip.durationSeconds - overlapOf(index), 0);
  if (context.targetDurationSeconds) {
    const flexible = built.filter((item) => item.flexible);
    const fixed = total() - flexible.reduce((sum, item) => sum + item.clip.durationSeconds, 0);
    const available = context.targetDurationSeconds - fixed;
    const current = flexible.reduce((sum, item) => sum + item.clip.durationSeconds, 0);
    if (flexible.length > 0 && current > 0 && available > 0) {
      const factor = available / current;
      for (const item of flexible) item.clip.durationSeconds = Math.max(1.2, Math.min(item.clip.assetId === cardId || item.clip.assetId === "CARDEND" ? 5 : 6, item.clip.durationSeconds * factor));
    }
    const final = total();
    if (Math.abs(final - context.targetDurationSeconds) / context.targetDurationSeconds > 0.15) warnings.push(`duração final ${final.toFixed(1)}s difere da pedida (${context.targetDurationSeconds}s): a fala escolhida tem esse tempo`);
  }

  // Alinha ao quadro, ajusta transições longas demais e encadeia na linha do tempo.
  let cursor = 0;
  const clips: EditClip[] = built.map((item, index) => {
    const clip = item.clip;
    clip.durationSeconds = frame(clip.durationSeconds);
    if (index > 0 && OVERLAP.has(clip.transitionIn.type)) {
      const limit = Math.min(clip.durationSeconds, built[index - 1]!.clip.durationSeconds) / 2 - 0.05;
      clip.transitionIn.durationSeconds = frame(Math.min(clip.transitionIn.durationSeconds, Math.max(0.1, limit)));
    }
    const overlap = index > 0 && OVERLAP.has(clip.transitionIn.type) ? clip.transitionIn.durationSeconds : 0;
    const start = index === 0 ? 0 : round3(cursor - overlap);
    cursor = start + clip.durationSeconds;
    // Textos: entram logo após a transição e saem antes do fim da cena.
    clip.overlays = clip.overlays.map((overlay, textIndex) => {
      const enter = Math.min(clip.durationSeconds / 3, (overlap || 0) + (overlay.role === "hook" ? 0.15 : 0.25) + textIndex * 0.25);
      return { ...overlay, startOffsetSeconds: round3(enter), durationSeconds: round3(Math.max(0.6, clip.durationSeconds - enter - 0.2)) };
    });
    return { ...clip, recordStartSeconds: start };
  });
  const durationSeconds = round3(cursor);

  // Legendas: sempre da transcrição, com o glossário da marca.
  let captions: VideoEditPlan["captions"];
  if (draft.captions && context.style.captions && clips.some((clip) => clip.keepSourceAudio)) {
    const segments = [...new Set(clips.filter((clip) => clip.keepSourceAudio).map((clip) => clip.assetId))]
      .flatMap((assetId) => captionsFromTranscript(clips, assetId, context.transcripts[assetId] ?? { segments: [] }, { glossary: context.brand.glossary }))
      .sort((a, b) => a.startSeconds - b.startSeconds);
    const style = textStyle("caption", context);
    captions = { enabled: true, style: { ...style, colorHex: "#FFFFFF", bold: true }, position: "bottom", segments };
  }

  // Trilha.
  let music: VideoEditPlan["music"];
  const musicMaterial = context.musicMaterialId ? materials.get(context.musicMaterialId) : undefined;
  if (musicMaterial && context.style.music && draft.music !== "none") {
    const hasSpeech = clips.some((clip) => clip.keepSourceAudio);
    addAsset({ id: musicMaterial.id, kind: "audio", role: "music", fileName: musicMaterial.fileName, sourceDurationSeconds: musicMaterial.durationSeconds });
    music = { assetId: musicMaterial.id, gainDb: draft.music === "subtle" ? (hasSpeech ? -18 : -14) : hasSpeech ? -14 : -8, fadeInSeconds: 0.5, fadeOutSeconds: 1.2, duckUnderSpeech: hasSpeech };
  } else if (draft.music !== "none" && context.style.music) warnings.push("trilha pedida, mas não há música disponível para esta marca");

  // Logo.
  let logo: VideoEditPlan["logo"];
  const logoMaterial = context.logoMaterialId ? materials.get(context.logoMaterialId) : undefined;
  if (logoMaterial && draft.logo !== "none" && logoMaterial.width && logoMaterial.height) {
    addAsset({ id: logoMaterial.id, kind: "image", role: "logo", fileName: logoMaterial.fileName, width: logoMaterial.width, height: logoMaterial.height });
    const last = clips[clips.length - 1]!;
    if (draft.logo === "end" && (last.assetId === cardId || last.assetId === "CARDEND")) {
      logo = { assetId: logoMaterial.id, placement: "center", scale: context.aspect === "16:9" ? 0.28 : context.aspect === "1:1" ? 0.4 : 0.46, startSeconds: round3(last.recordStartSeconds + 0.3), durationSeconds: round3(last.durationSeconds - 0.3) };
      last.overlays = last.overlays.map((overlay) => (overlay.position === "center" ? { ...overlay, position: "bottom" } : overlay));
    } else {
      const span = Math.min(3, durationSeconds - 0.5);
      logo = { assetId: logoMaterial.id, placement: "top_right", scale: 0.16, startSeconds: round3(draft.logo === "corner" ? 0.5 : durationSeconds - span), durationSeconds: round3(draft.logo === "corner" ? durationSeconds - 0.5 : span) };
    }
  } else if (draft.logo !== "none") warnings.push("logo pedido, mas a marca não tem logo cadastrado");

  const plan: VideoEditPlan = {
    version: 1,
    planId: context.planId,
    workspaceId: context.workspaceId,
    mode: clips.some((clip) => clip.keepSourceAudio) ? "edit_footage" : "images_ad",
    aspect: context.aspect,
    width,
    height,
    fps: FPS,
    durationSeconds,
    assets,
    clips,
    ...(captions ? { captions } : {}),
    ...(music ? { music } : {}),
    ...(logo ? { logo } : {}),
    sourceAudioGainDb: 0,
    strategy: draft.strategy,
    look: { backgroundHex: context.brand.primaryHex.toUpperCase(), accentHex: context.brand.accentHex.toUpperCase(), panelTextHex: contrastText(context.brand.primaryHex, context.brand).toUpperCase() },
    prompt: context.request.slice(0, 4000),
  };
  const validation = validateVideoEditPlan(plan);
  if (!validation.valid) return { ok: false, issues: validation.issues.map((issue) => `${issue.path}: ${issue.message}`), warnings };
  return { ok: true, plan, warnings };
}
