/**
 * Dimensões/duração lidas no navegador só para a prévia e a validação imediata. O servidor relê a
 * mídia de verdade antes de agendar — o que vem daqui nunca é a fonte final.
 */
export async function readMediaMetadata(file: File): Promise<{ width?: number; height?: number; durationSec?: number }> {
  if (typeof window === "undefined") return {};
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("video/")) {
      return await new Promise((resolve) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => resolve({ width: video.videoWidth || undefined, height: video.videoHeight || undefined, durationSec: Number.isFinite(video.duration) ? video.duration : undefined });
        video.onerror = () => resolve({});
        video.src = url;
      });
    }
    return await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth || undefined, height: image.naturalHeight || undefined });
      image.onerror = () => resolve({});
      image.src = url;
    });
  } finally {
    // Libera depois que o elemento terminou de ler os metadados.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
