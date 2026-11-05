/**
 * Redução de fotos no navegador antes do envio. Foto de celular (3–8 MB, 4000 px) vira ~300–600 KB
 * em 1920 px: o envio fica várias vezes mais rápido e o servidor (que de qualquer forma gera 1920 px
 * em WEBP) trabalha sobre uma imagem pequena. Sem suporte do navegador, o arquivo original segue.
 */
export const MAX_IMAGE_SIDE = 1920;
/** Abaixo disto e já no tamanho certo, a foto vai como está (recomprimir só perderia qualidade). */
const SMALL_ENOUGH_BYTES = 600_000;

/** Dimensões finais mantendo a proporção, sem ampliar. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function compressImage(file: File, max = MAX_IMAGE_SIDE): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { return file; }
  try {
    if (Math.max(bitmap.width, bitmap.height) <= max && file.size <= SMALL_ENOUGH_BYTES) return file;
    const size = fitWithin(bitmap.width, bitmap.height, max);
    const canvas = document.createElement("canvas");
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
    // Safari antigo devolve PNG quando não sabe gerar WEBP: aí JPEG é o formato leve.
    const usable = blob?.type === "image/webp" ? blob : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!usable || usable.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + (usable.type === "image/webp" ? ".webp" : ".jpg");
    return new File([usable], name, { type: usable.type, lastModified: file.lastModified });
  } finally { bitmap.close(); }
}

/** Executa `task` para cada item com no máximo `limit` ao mesmo tempo. */
export async function forEachLimited<T>(items: T[], limit: number, task: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < items.length) { const index = next++; await task(items[index], index); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
