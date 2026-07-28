import { createWorker } from "tesseract.js";

/**
 * OCR real via `tesseract.js` (WASM, sem binário nativo) — único motor de OCR instalado no
 * projeto. Reusado por `image-understanding.ts` e `video-understanding.ts` (um frame extraído de
 * vídeo é só mais uma imagem para o OCR). Falha nunca propaga: um arquivo ilegível/corrompido
 * retorna texto vazio em vez de derrubar a ingestão inteira de uma campanha inteira por causa de
 * um único arquivo.
 */

let sharedWorkerPromise: ReturnType<typeof createWorker> | undefined;

async function getWorker() {
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = createWorker("por");
  }
  return sharedWorkerPromise;
}

export async function recognizeText(absoluteImagePath: string): Promise<string> {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(absoluteImagePath);
    return (data.text ?? "").trim();
  } catch {
    return "";
  }
}

export async function shutdownOcrWorker(): Promise<void> {
  if (!sharedWorkerPromise) return;
  const worker = await sharedWorkerPromise;
  sharedWorkerPromise = undefined;
  await worker.terminate().catch(() => {});
}
