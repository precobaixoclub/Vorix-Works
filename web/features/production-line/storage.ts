import { DEFAULT_PRODUCTION_CONFIG } from "./defaults";
import type { ContentBlueprint, PostingRule, ProductionFormat, ProductionLineConfig, ProductionWeekday, WeeklyFormatQuota } from "./types";

const WEEKDAYS: ProductionWeekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function productionStorageKey(workspaceId: string) {
  return `vorix.production-line.${workspaceId}`;
}

export function readProductionConfig(workspaceId: string): ProductionLineConfig {
  if (typeof window === "undefined") return DEFAULT_PRODUCTION_CONFIG;
  const raw = window.localStorage.getItem(productionStorageKey(workspaceId));
  if (!raw) return DEFAULT_PRODUCTION_CONFIG;

  try {
    const parsed = JSON.parse(raw) as ProductionLineConfig;
    const hasBlueprintsArray = Array.isArray(parsed.blueprints);
    const originalBlueprints = hasBlueprintsArray ? parsed.blueprints : [];
    const parsedBlueprints = originalBlueprints.length > 0 ? originalBlueprints.map(normalizeBlueprint).filter((idea) => !isBlankDraftIdea(idea)) : [];
    const blueprints = hasBlueprintsArray ? parsedBlueprints : DEFAULT_PRODUCTION_CONFIG.blueprints;
    const nextConfig = {
      blueprints,
      postingRules: Array.isArray(parsed.postingRules) && parsed.postingRules.length > 0 ? parsed.postingRules.map(normalizeRule) : DEFAULT_PRODUCTION_CONFIG.postingRules,
    };
    if (originalBlueprints.length !== parsedBlueprints.length) {
      window.localStorage.setItem(productionStorageKey(workspaceId), JSON.stringify(nextConfig));
    }
    return nextConfig;
  } catch {
    return DEFAULT_PRODUCTION_CONFIG;
  }
}

export function writeProductionConfig(workspaceId: string, config: ProductionLineConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(productionStorageKey(workspaceId), JSON.stringify(config));
}

function normalizeBlueprint(input: ContentBlueprint): ContentBlueprint {
  return {
    ...input,
    ideaText: input.ideaText ?? input.objective ?? "",
    sourceLinks: Array.isArray(input.sourceLinks) ? input.sourceLinks : [],
    referenceImages: Array.isArray(input.referenceImages) ? input.referenceImages : [],
    status: input.status === "used" ? "used" : "available",
    productionMode: input.productionMode === "standalone" ? "standalone" : "routine",
  };
}

function isBlankDraftIdea(input: ContentBlueprint): boolean {
  const textFields = [input.ideaText, input.objective, input.theme, input.captionDirection, input.creativeDirection]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
  const hasReferences = input.sourceLinks.length > 0 || input.referenceImages.length > 0;
  const defaultName = input.name.trim() === "" || input.name.trim().toLowerCase() === "nova ideia";
  return input.status !== "used" && defaultName && textFields.length === 0 && !hasReferences;
}

function normalizeRule(input: PostingRule): PostingRule {
  const times = Array.isArray(input.times) && input.times.length > 0 ? input.times.filter(Boolean) : ["09:00"];
  return {
    ...input,
    times,
    weeklyMix: Array.isArray(input.weeklyMix) && input.weeklyMix.length > 0 ? input.weeklyMix.map((item) => normalizeMixItem(item, times)) : defaultWeeklyMix(),
  };
}

function normalizeMixItem(input: WeeklyFormatQuota, fallbackTimes: string[]): WeeklyFormatQuota {
  const weekdays = Array.isArray(input.weekdays)
    ? input.weekdays.filter((weekday): weekday is ProductionWeekday => WEEKDAYS.includes(weekday as ProductionWeekday))
    : [];
  const times = Array.isArray(input.times) ? input.times.filter(Boolean) : [];
  if (Array.isArray(input.weekdays) && Array.isArray(input.times) && weekdays.length === 0 && times.length === 0 && input.quantity === 0) {
    return {
      id: input.id,
      format: input.format,
      quantity: 0,
      weekdays: [],
      times: [],
    };
  }
  const fallbackWeekdays = defaultWeekdaysForQuantity(input.quantity);
  const fallbackTime = fallbackTimes[0] ?? "09:00";
  const nextWeekdays = weekdays.length > 0 ? weekdays : fallbackWeekdays;
  const nextTimes = times.length > 0 ? times : [fallbackTime];

  return {
    id: input.id,
    format: input.format,
    quantity: nextWeekdays.length * nextTimes.length,
    weekdays: nextWeekdays,
    times: nextTimes,
  };
}

function defaultWeeklyMix(): WeeklyFormatQuota[] {
  return [
    { id: "mix-single-image", format: "single_image" as ProductionFormat, quantity: 2, weekdays: ["mon", "wed"], times: ["09:00"] },
    { id: "mix-carousel", format: "carousel" as ProductionFormat, quantity: 1, weekdays: ["fri"], times: ["18:30"] },
    { id: "mix-video", format: "video" as ProductionFormat, quantity: 1, weekdays: ["tue"], times: ["18:30"] },
  ];
}

function defaultWeekdaysForQuantity(quantity: number): ProductionWeekday[] {
  const count = Number.isFinite(quantity) ? Math.max(1, Math.min(7, Math.round(quantity))) : 1;
  return WEEKDAYS.slice(0, count);
}
