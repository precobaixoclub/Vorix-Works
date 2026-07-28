import { realpath, stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import type {
  VideoAssetCandidate,
  VideoAssetResolution,
  VideoAssetResolutionRequest,
  VideoAssetResolutionResult,
} from "../../application/ports/video-rendering.port.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

/**
 * Resolve candidatos a assets locais (logo, imagens de fundo, trilha, efeitos sonoros) SEM nunca
 * buscar, baixar ou inferir um arquivo — apenas valida caminhos já fornecidos explicitamente
 * (por `RafaVideoRenderingRequestInput.localAssets` ou por `IdentityContext.logoUri` da Clara).
 * Sugestões em texto livre de Bruno/Diego (`brollSuggestions`, `musicSuggestions`,
 * `requiredAssets`) nunca passam por aqui — não são caminhos de arquivo.
 *
 * Defesa contra path traversal: como estes candidatos podem legitimamente apontar para fora da
 * pasta `artifacts/<executionId>/` (ex.: a logo da marca pode estar em qualquer lugar do disco),
 * não faz sentido restringi-los a uma única raiz fixa como `LocalArtifactDelivery` faz. Em vez
 * disso: (1) exige caminho absoluto (nunca relativo — remove qualquer ambiguidade de "relativo a
 * quê"); (2) resolve o caminho real via `fs.realpath` (segue e neutraliza symlinks manipulados);
 * (3) confirma que é um arquivo regular; (4) valida extensão contra uma lista fechada por tipo;
 * (5) valida tamanho máximo plausível, para nunca aceitar um arquivo enorme por engano/abuso.
 */
export async function resolveVideoAssets(input: VideoAssetResolutionRequest): Promise<VideoAssetResolutionResult> {
  const resolutions: VideoAssetResolution[] = [];
  for (const candidate of input.candidates) {
    resolutions.push(await resolveOne(candidate));
  }
  return { resolutions };
}

async function resolveOne(candidate: VideoAssetCandidate): Promise<VideoAssetResolution> {
  const { id, kind, path: candidatePath } = candidate;

  if (!candidatePath || typeof candidatePath !== "string") {
    return { id, kind, resolved: false, reason: "Caminho de asset vazio ou inválido." };
  }
  if (!isAbsolute(candidatePath)) {
    return { id, kind, resolved: false, reason: `Caminho de asset precisa ser absoluto: "${candidatePath}".` };
  }
  if (candidatePath.includes("..")) {
    return { id, kind, resolved: false, reason: `Caminho de asset rejeitado por conter segmento de path traversal: "${candidatePath}".` };
  }

  let realPath: string;
  try {
    realPath = await realpath(candidatePath);
  } catch {
    return { id, kind, resolved: false, reason: `Arquivo não encontrado em "${candidatePath}".` };
  }

  const extension = extname(realPath).toLowerCase();
  const allowedExtensions = kind === "image" ? IMAGE_EXTENSIONS : AUDIO_EXTENSIONS;
  if (!allowedExtensions.has(extension)) {
    return {
      id,
      kind,
      resolved: false,
      reason: `Extensão "${extension || "(sem extensão)"}" não permitida para asset do tipo ${kind}. Permitidas: ${[...allowedExtensions].join(", ")}.`,
    };
  }

  let fileStat;
  try {
    fileStat = await stat(realPath);
  } catch {
    return { id, kind, resolved: false, reason: `Não foi possível ler os metadados de "${realPath}".` };
  }

  if (!fileStat.isFile()) {
    return { id, kind, resolved: false, reason: `"${realPath}" não é um arquivo regular.` };
  }

  const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (fileStat.size > maxBytes) {
    return {
      id,
      kind,
      resolved: false,
      reason: `Arquivo "${realPath}" tem ${fileStat.size} bytes, acima do limite de ${maxBytes} bytes para ${kind}.`,
    };
  }
  if (fileStat.size === 0) {
    return { id, kind, resolved: false, reason: `Arquivo "${realPath}" está vazio.` };
  }

  return { id, kind, resolved: true, absolutePath: realPath, sizeBytes: fileStat.size };
}
