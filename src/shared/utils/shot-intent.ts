import type { MediaAssetType, MediaShotDeviceOrientation, MediaShotDeviceType, MediaShotPlanEntry } from "../../application/ports/media-catalog.port.js";

/**
 * INTENT-BASED FOOTAGE ACQUISITION — a menor unidade de aquisição deixa de ser o tema da campanha
 * e passa a ser o objetivo real do Shot. Módulo puro (sem I/O), mesmo espírito de
 * `production-readiness.ts`/`asset-diversity-gate.ts`: vive em `src/shared/utils` para ser
 * importável tanto pela infraestrutura de aquisição quanto (futuramente) por qualquer Skill sem
 * violar ADR 0002, mas nenhuma Skill é alterada nesta sprint para consumi-lo.
 */
export type ShotIntent = {
  shotId?: string;
  sceneOrder: number;
  narrativeGoal: string;
  mainAction: string;
  secondaryAction?: string;
  protagonist?: string;
  mainObject?: string;
  device: MediaShotDeviceType;
  deviceOrientation: MediaShotDeviceOrientation;
  screenVisibleRequired: boolean;
  emotion?: string;
  framing?: string;
  movement?: string;
  minDurationSeconds: number;
  assetType: MediaAssetType;
  compositingRequired: boolean;
};

const DEFAULT_MIN_DURATION_SECONDS = 1;

/** Deriva um `ShotIntent` estruturado a partir da entrada (já enriquecida) de Shot Plan — nunca inventa um campo sem sinal real; usa fallbacks textuais claros ("não especificado") em vez de valores fabricados. */
export function deriveShotIntent(entry: MediaShotPlanEntry, gapDescription?: string): ShotIntent {
  const mainAction = entry.action ?? gapDescription ?? "ação não especificada";
  return {
    shotId: entry.shotId,
    sceneOrder: entry.sceneOrder,
    narrativeGoal: entry.narrativeGoal ?? (entry.themes.length > 0 ? entry.themes.join(" ") : "objetivo não especificado"),
    mainAction,
    secondaryAction: entry.secondaryAction,
    protagonist: entry.subjectLabel,
    mainObject: entry.mainObject,
    device: entry.device ?? "none",
    deviceOrientation: entry.deviceOrientationRequired ?? "any",
    screenVisibleRequired: entry.screenVisibleRequired ?? false,
    emotion: entry.emotion,
    framing: entry.framing,
    movement: entry.movement,
    minDurationSeconds: entry.minDurationSeconds ?? DEFAULT_MIN_DURATION_SECONDS,
    assetType: entry.desiredType,
    compositingRequired: entry.compositingRequired ?? false,
  };
}

// Ordem importa: quando o texto do tema menciona mais de um dispositivo ("celular ou notebook",
// caso real encontrado na validação desta sprint), o primeiro padrão que casar decide. `phone`
// vem primeiro porque é o dispositivo dominante nas campanhas já validadas (todas as 5 telas de
// produto aprovadas no catálogo são `deviceTarget: "phone"`; nenhuma é notebook) — nunca uma
// escolha arbitrária, é o sinal mais forte disponível quando o Shot Plan em si é ambíguo.
const DEVICE_KEYWORDS: Array<{ pattern: RegExp; device: MediaShotDeviceType }> = [
  { pattern: /celular|smartphone|phone/i, device: "phone" },
  { pattern: /tablet/i, device: "tablet" },
  { pattern: /notebook|laptop/i, device: "notebook" },
  { pattern: /desktop|computador/i, device: "desktop" },
];

/** Infere o dispositivo a partir de texto livre (tema/tags/requiredTags) — usado por `mediaGapAnalysisForExecution` ao montar `MediaShotPlanEntry` a partir do Shot Plan bruto de Bruno/Vanessa. Nunca inventa: sem correspondência, devolve `"none"`. */
export function inferDeviceFromText(text: string): MediaShotDeviceType {
  for (const { pattern, device } of DEVICE_KEYWORDS) {
    if (pattern.test(text)) return device;
  }
  return "none";
}
