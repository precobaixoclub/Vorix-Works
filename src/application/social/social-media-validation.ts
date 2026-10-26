import type { SocialFormatCapability, SocialMediaItem, SocialMusicSelection, SocialNetwork } from "../../domain/social/social-publishing.model.js";
import { FORMAT_LABEL, NETWORK_LABEL } from "../../domain/social/social-publishing.model.js";
import type { SocialValidationIssue } from "./social-publishing-provider.port.js";

/** Lê metadados reais da mídia (dimensão, duração, tamanho). Implementado na infraestrutura. */
export type SocialMediaProbePort = {
  probe(item: SocialMediaItem): Promise<SocialMediaItem>;
};

/**
 * Valida um destino contra a capability efetiva (provider ∩ conta) ANTES de entrar na fila, para o
 * cliente saber do problema antes do horário agendado — não depois.
 */
export function validateAgainstCapability(input: {
  network: SocialNetwork;
  capability: SocialFormatCapability | undefined;
  caption: string;
  media: readonly SocialMediaItem[];
  music?: SocialMusicSelection;
  embeddedAudio?: boolean;
}): SocialValidationIssue[] {
  const label = NETWORK_LABEL[input.network];
  const capability = input.capability;
  if (!capability) return [{ field: "format", code: "FORMAT_UNSUPPORTED", message: `Este formato não está disponível para esta conta do ${label}.` }];
  const issues: SocialValidationIssue[] = [];
  const formatLabel = FORMAT_LABEL[capability.format];
  const constraints = capability.constraints;
  // maxCaptionLength 0 = formato sem legenda (ex.: Story): o texto é simplesmente não enviado.
  if (capability.maxCaptionLength > 0 && input.caption.length > capability.maxCaptionLength) {
    issues.push({ field: "caption", code: "CAPTION_TOO_LONG", message: `A legenda passa do limite de ${capability.maxCaptionLength} caracteres do ${label}.` });
  }
  if (input.media.length < constraints.minItems) {
    issues.push({ field: "media", code: "MEDIA_MISSING", message: constraints.minItems > 1 ? `${formatLabel} precisa de pelo menos ${constraints.minItems} arquivos.` : `${formatLabel} precisa de uma mídia.` });
  }
  if (input.media.length > constraints.maxItems) {
    issues.push({ field: "media", code: "MEDIA_TOO_MANY", message: `${formatLabel} aceita no máximo ${constraints.maxItems} arquivos no ${label}.` });
  }
  input.media.forEach((item, index) => {
    const position = input.media.length > 1 ? ` (arquivo ${index + 1})` : "";
    if (!constraints.kinds.includes(item.kind)) {
      issues.push({ field: "media", code: "MEDIA_KIND_UNSUPPORTED", message: `${formatLabel} no ${label} não aceita ${item.kind === "video" ? "vídeo" : "imagem"}${position}.` });
      return;
    }
    if (constraints.mimeTypes && item.mimeType && !constraints.mimeTypes.includes(item.mimeType)) {
      issues.push({ field: "media", code: "MEDIA_FORMAT_UNSUPPORTED", message: `Formato de arquivo não aceito pelo ${label}${position}.` });
    }
    if (constraints.maxBytes && item.sizeBytes && item.sizeBytes > constraints.maxBytes) {
      issues.push({ field: "media", code: "MEDIA_TOO_LARGE", message: `Arquivo maior que ${Math.round(constraints.maxBytes / 1_048_576)} MB${position}.` });
    }
    if (item.width && item.height) {
      const ratio = item.width / item.height;
      if (constraints.minAspectRatio && ratio < constraints.minAspectRatio - 0.01) issues.push({ field: "media", code: "MEDIA_ASPECT_RATIO", message: `${formatLabel}: proporção muito vertical para o ${label}${position}.` });
      if (constraints.maxAspectRatio && ratio > constraints.maxAspectRatio + 0.01) issues.push({ field: "media", code: "MEDIA_ASPECT_RATIO", message: `${formatLabel}: proporção muito horizontal para o ${label}${position}.` });
      if (constraints.minWidth && item.width < constraints.minWidth) issues.push({ field: "media", code: "MEDIA_RESOLUTION", message: `Resolução abaixo de ${constraints.minWidth}px de largura${position}.` });
    }
    if (item.kind === "video" && item.durationSec !== undefined) {
      if (constraints.minDurationSec && item.durationSec < constraints.minDurationSec) issues.push({ field: "media", code: "MEDIA_DURATION", message: `Vídeo mais curto que ${constraints.minDurationSec}s${position}.` });
      if (constraints.maxDurationSec && item.durationSec > constraints.maxDurationSec) issues.push({ field: "media", code: "MEDIA_DURATION", message: `Vídeo mais longo que ${formatDuration(constraints.maxDurationSec)} para ${formatLabel.toLowerCase()}${position}.` });
    }
  });
  if (input.music && !capability.features.includes("nativeMusic")) {
    issues.push({ field: "music", code: "MUSIC_UNSUPPORTED", message: `Música do ${label} não está disponível para este formato nesta conta.` });
  }
  if (input.music?.segmentStartSec !== undefined && !capability.features.includes("musicSegment")) {
    issues.push({ field: "music", code: "MUSIC_SEGMENT_UNSUPPORTED", message: `O ${label} não permite escolher o trecho da música neste formato.` });
  }
  if (input.embeddedAudio && !capability.features.includes("embeddedAudio")) {
    issues.push({ field: "media", code: "EMBEDDED_AUDIO_UNSUPPORTED", message: `Áudio no vídeo não é suportado neste formato do ${label}.` });
  }
  return issues;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}min${rest}s` : `${minutes}min`;
}
