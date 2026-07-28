import type { CampaignScreen, Feature, VideoAnalysis, VideoFrame } from "../../../domain/campaign-intelligence/campaign-intelligence.model.js";

/**
 * Reuse Engine (seção 12): antes de qualquer geração (mockup, print reconstruído), verifica se já
 * existe material oficial cobrindo a mesma funcionalidade. "Existe vídeo oficial mostrando RSVP →
 * usar vídeo, não criar mockup" — `findReusableMaterial` é a implementação literal desse exemplo.
 * Função pura: não decide sozinha o que a Skill faz com o resultado, só responde honestamente
 * "já existe X" ou "nada encontrado" (nunca finge que existe algo que não existe).
 */

export type ReuseLookupResult =
  | { found: true; kind: "screen"; screen: CampaignScreen; reason: string }
  | { found: true; kind: "video_frame"; fileId: string; frame: VideoFrame; reason: string }
  | { found: false; reason: string };

function matchesQuery(haystack: string, query: string): boolean {
  const needle = query.toLowerCase().trim();
  return needle.length > 0 && haystack.toLowerCase().includes(needle);
}

export function findReusableMaterial(input: {
  query: string;
  features: Feature[];
  screens: CampaignScreen[];
  videoAnalyses: VideoAnalysis[];
}): ReuseLookupResult {
  const matchingFeature = input.features.find(
    (feature) => matchesQuery(feature.name, input.query) || feature.keywords.some((keyword) => matchesQuery(input.query, keyword) || matchesQuery(keyword, input.query)),
  );

  if (matchingFeature) {
    const screen = input.screens.find((candidate) => matchingFeature.relatedScreenIds.includes(candidate.id));
    if (screen) {
      return { found: true, kind: "screen", screen, reason: `Material oficial já existe para "${matchingFeature.name}" (${screen.sourceType}, capturado em ${screen.capturedAt}).` };
    }
  }

  for (const analysis of input.videoAnalyses) {
    const entry = analysis.timeline.find((timelineEntry) => matchesQuery(timelineEntry.label, input.query));
    if (entry) {
      const frame = analysis.frames.reduce((closest, candidate) =>
        Math.abs(candidate.timestampSeconds - entry.timestampSeconds) < Math.abs((closest?.timestampSeconds ?? Infinity) - entry.timestampSeconds) ? candidate : closest,
        undefined as VideoFrame | undefined,
      );
      if (frame) {
        return { found: true, kind: "video_frame", fileId: analysis.fileId, frame, reason: `Vídeo oficial já mostra "${entry.label}" em ${formatTimestamp(entry.timestampSeconds)}.` };
      }
    }
  }

  return { found: false, reason: `Nenhum material oficial encontrado para "${input.query}" — geração pode prosseguir.` };
}

export function formatTimestamp(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
