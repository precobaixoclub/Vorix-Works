import type { CampaignScreen, ImageAnalysis, VideoAnalysis } from "../../../domain/campaign-intelligence/campaign-intelligence.model.js";
import { formatTimestamp } from "./reuse-engine.js";
import { classifyCampaignScreen } from "./campaign-screen-classification.js";

/**
 * Frame Search (seção 13) + apoio ao Timeline Index (seção 14): consultas em linguagem natural
 * simples ("Mostrar trecho onde aparece RSVP", "Mostrar tela de Check-in", "Mostrar todas as
 * imagens da Home") sobre tudo que já foi indexado — nunca dispara nova extração, só consulta o
 * que o Workspace já tem.
 */

export type FrameSearchResult = {
  kind: "screen" | "video_timestamp" | "image";
  description: string;
  path: string;
  sourceFileId: string;
  timestampSeconds?: number;
};

function matches(haystack: string, query: string): boolean {
  const needle = query.toLowerCase();
  return haystack.toLowerCase().includes(needle) || needle.includes(haystack.toLowerCase());
}

export function searchFrames(input: {
  query: string;
  screens: CampaignScreen[];
  videoAnalyses: VideoAnalysis[];
  imageAnalyses: ImageAnalysis[];
}): FrameSearchResult[] {
  const results: FrameSearchResult[] = [];
  const query = input.query.toLowerCase();
  // "Mostrar tela de Check-in" precisa achar uma tela de categoria "guest_area" mesmo sem a
  // palavra "guest_area" aparecer na consulta — classifica a própria consulta com o mesmo
  // vocabulário usado para classificar telas, e compara categoria a categoria.
  const queryAsCategory = classifyCampaignScreen(query);

  for (const screen of input.screens) {
    if (matches(screen.category.replace(/_/g, " "), query) || (queryAsCategory !== "unknown" && queryAsCategory === screen.category)) {
      results.push({ kind: "screen", description: `Tela "${screen.category}" capturada de ${screen.sourceType} (arquivo ${screen.sourceFileId}).`, path: screen.imagePath, sourceFileId: screen.sourceFileId, timestampSeconds: screen.sourceTimestampSeconds });
    }
  }

  for (const analysis of input.videoAnalyses) {
    for (const entry of analysis.timeline) {
      if (matches(entry.label, query) || (queryAsCategory !== "unknown" && queryAsCategory === entry.label)) {
        const frame = analysis.frames.find((candidate) => Math.abs(candidate.timestampSeconds - entry.timestampSeconds) < 1);
        results.push({
          kind: "video_timestamp",
          description: `Vídeo (arquivo ${analysis.fileId}) mostra "${entry.label}" em ${formatTimestamp(entry.timestampSeconds)}.`,
          path: frame?.framePath ?? "",
          sourceFileId: analysis.fileId,
          timestampSeconds: entry.timestampSeconds,
        });
      }
    }
  }

  for (const analysis of input.imageAnalyses) {
    const haystack = `${analysis.tags.join(" ")} ${analysis.ocrText} ${analysis.category}`;
    if (matches(haystack, query)) {
      results.push({ kind: "image", description: `Imagem (arquivo ${analysis.fileId}, categoria ${analysis.category}).`, path: "", sourceFileId: analysis.fileId });
    }
  }

  return results;
}

/** Índice temporal completo de um vídeo (seção 14), na ordem cronológica. */
export function buildTimelineIndex(analysis: VideoAnalysis): Array<{ timestamp: string; label: string; confidence: number }> {
  return [...analysis.timeline]
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
    .map((entry) => ({ timestamp: formatTimestamp(entry.timestampSeconds), label: entry.label, confidence: entry.confidence }));
}
