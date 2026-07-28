import type {
  DocumentAnalysis,
  ExtractedContent,
  ImageAnalysis,
  VideoAnalysis,
} from "../../../domain/campaign-intelligence/campaign-intelligence.model.js";

/**
 * Converte a saída de cada pipeline (imagem/vídeo/documento) para o mesmo `ExtractedContent` que
 * o Company Intelligence já usa — para poder reusar `discoverFeatures` (seção 6/7) sem reescrevê-lo.
 * `pageUrl` é reaproveitado como identificador do arquivo de origem (`file:<fileId>`), não uma URL
 * real — mesmo truque estrutural de reuso do tipo, documentado aqui para não confundir.
 */

function empty(pageUrl: string): ExtractedContent {
  return { pageUrl, headlines: [], subheadlines: [], paragraphs: [], lists: [], faq: [], benefits: [], features: [], ctas: [], testimonials: [], plans: [], differentiators: [] };
}

export function documentAnalysisToExtractedContent(analysis: DocumentAnalysis): ExtractedContent {
  return {
    ...empty(`file:${analysis.fileId}`),
    headlines: analysis.headlines,
    paragraphs: analysis.paragraphs,
    lists: analysis.lists,
    features: [...analysis.headlines, ...analysis.lists.flat()],
    benefits: analysis.paragraphs,
  };
}

export function imageAnalysisToExtractedContent(analysis: ImageAnalysis): ExtractedContent {
  return {
    ...empty(`file:${analysis.fileId}`),
    paragraphs: analysis.detectedTexts,
    features: analysis.buttons.length > 0 ? analysis.buttons : analysis.detectedTexts,
    benefits: analysis.detectedTexts,
  };
}

export function videoAnalysisToExtractedContent(analysis: VideoAnalysis): ExtractedContent {
  const frameTexts = analysis.frames.map((frame) => frame.ocrText).filter(Boolean);
  return {
    ...empty(`file:${analysis.fileId}`),
    paragraphs: frameTexts,
    features: analysis.timeline.map((entry) => entry.label),
    benefits: frameTexts,
  };
}
