import { readdir, stat } from "node:fs/promises";
import { extname, join, relative, basename } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readRasterDimensions, readVideoMetadata, isVideoExtension, normalizeAspectRatio } from "../visual-assets/visual-asset-metadata.js";
import { resolveFfmpegBinaryPath } from "../video-rendering/ffmpeg-binary.js";
import { computeFileHash, computePerceptualHash, hammingDistance, NEAR_DUPLICATE_HAMMING_THRESHOLD } from "./media-hash.js";
import { classifyVideoFootage } from "./footage-classifier.js";
import type { MediaAssetRecord, MediaAssetType, MediaScanResult } from "../../application/ports/media-catalog.port.js";

/**
 * MEDIA INTELLIGENCE ENGINE — varredura de disco. Nunca apaga arquivos, nunca sobrescreve tags ou
 * aprovação manual já registradas, nunca inventa autor/origem/licença. Localiza arquivos físicos,
 * calcula hash, extrai metadados técnicos reais (via os mesmos leitores já usados pelo
 * VisualAssetResolver, sem duplicar a lógica de leitura de PNG/JPEG/vídeo), classifica filmagem
 * procedural quando detectável com confiança, e mescla com o catálogo existente preservando tudo
 * que já era humano/manual.
 */

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);

const FOLDER_TYPE_HINTS: Array<{ token: string; type: MediaAssetType }> = [
  { token: "mockup", type: "mockup" },
  { token: "screenshot", type: "screenshot" },
  { token: "overlay", type: "overlay" },
  { token: "logo", type: "logo" },
  { token: "music", type: "music" },
  { token: "sfx", type: "sfx" },
  { token: "narration", type: "narration" },
  { token: "b_roll", type: "b_roll" },
  { token: "broll", type: "b_roll" },
  { token: "cinemagraph", type: "cinemagraph" },
];

function normalizeToken(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function inferTypeFromPath(absolutePath: string, extension: string): MediaAssetType {
  const pathTokens = normalizeToken(absolutePath.replace(/\\/g, "/"));
  for (const hint of FOLDER_TYPE_HINTS) {
    if (pathTokens.includes(hint.token)) return hint.type;
  }
  if (AUDIO_EXTENSIONS.has(extension)) return "music";
  if (isVideoExtension(extension)) return "video";
  return "photo";
}

function inferTagsFromPath(rootRelativePath: string): string[] {
  return normalizeToken(rootRelativePath.replace(/\\/g, "/"))
    .split(/[\/_\-.\s]+/)
    .filter((token) => token.length > 2 && !["png", "jpg", "jpeg", "mp4", "mov", "webm", "mp3", "wav", "m4a", "aac"].includes(token));
}

async function readAudioMetadata(absolutePath: string): Promise<{ durationSeconds?: number; sampleRateHz?: number; audioChannels?: number }> {
  const binaryPath = resolveFfmpegBinaryPath();
  const stderr = await new Promise<string>((resolvePromise) => {
    const child = spawn(binaryPath, ["-hide_banner", "-i", absolutePath], { windowsHide: true });
    let output = "";
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.on("close", () => resolvePromise(output));
    child.on("error", () => resolvePromise(output));
  });
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  const audioMatch = stderr.match(/Audio:.*?(\d+)\s*Hz,\s*(mono|stereo|[\d.]+ channels)/);
  const durationSeconds = durationMatch ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]) : undefined;
  const sampleRateHz = audioMatch ? Number(audioMatch[1]) : undefined;
  const audioChannels = audioMatch ? (audioMatch[2] === "mono" ? 1 : audioMatch[2] === "stereo" ? 2 : Number.parseFloat(audioMatch[2])) : undefined;
  return { durationSeconds, sampleRateHz, audioChannels };
}

async function walkDirectory(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkDirectory(fullPath)));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

export type ScanFileOutcome = { record: MediaAssetRecord; isNew: boolean; isDuplicate: boolean };

/**
 * Metadados JÁ CONHECIDOS (nunca inventados) de um asset físico, tipicamente vindos do manifesto
 * legado da biblioteca visual (`assets/visual/library/manifest.json`, autorado à mão por um
 * humano/IA desenvolvedora em sprints anteriores) — a varredura usa isto como semente inicial de
 * autor/licença/tags/tema/emoção quando o arquivo é descoberto pela primeira vez, para nunca
 * reportar `licenseStatus: "unknown"` quando a licença real já está documentada em algum lugar do
 * projeto. Nunca sobrescreve dados manuais já presentes no catálogo (`existing`).
 */
export type MediaManifestSeed = {
  absolutePath: string;
  author?: string;
  sourceUrl?: string;
  license?: MediaAssetRecord["license"];
  tags?: string[];
  themes?: string[];
  emotion?: string;
  origin?: MediaAssetRecord["origin"];
  type?: MediaAssetType;
};

/**
 * Varre `roots` (caminhos absolutos), processa cada arquivo com extensão reconhecida e devolve os
 * registros resultantes já mesclados com `existingRecords` (indexados por caminho físico
 * normalizado). Não persiste nada — só o repositório (`media-catalog.repository.ts`) grava.
 */
export async function scanMediaFiles(input: {
  roots: string[];
  existingRecords: MediaAssetRecord[];
  manifestSeeds?: MediaManifestSeed[];
}): Promise<{ records: MediaAssetRecord[]; result: MediaScanResult }> {
  const warnings: string[] = [];
  const existingByPath = new Map(input.existingRecords.map((record) => [record.absolutePath.replace(/\\/g, "/").toLowerCase(), record]));
  const existingByHash = new Map(input.existingRecords.filter((record) => record.hash).map((record) => [record.hash, record]));
  const seedByPath = new Map((input.manifestSeeds ?? []).map((seed) => [seed.absolutePath.replace(/\\/g, "/").toLowerCase(), seed]));
  const seenPaths = new Set<string>();

  let scanned = 0;
  let added = 0;
  let updated = 0;
  let duplicatesFound = 0;
  const outcomes: MediaAssetRecord[] = [];

  for (const root of input.roots) {
    const files = await walkDirectory(root);
    for (const absolutePath of files) {
      const extension = extname(absolutePath).toLowerCase();
      const isImage = IMAGE_EXTENSIONS.has(extension);
      const isVideo = isVideoExtension(extension);
      const isAudio = AUDIO_EXTENSIONS.has(extension);
      if (!isImage && !isVideo && !isAudio) continue;

      scanned += 1;
      const normalizedPath = absolutePath.replace(/\\/g, "/").toLowerCase();
      seenPaths.add(normalizedPath);
      const existing = existingByPath.get(normalizedPath);

      try {
        const fileStat = await stat(absolutePath);
        const hash = await computeFileHash(absolutePath);
        const duplicateOfExisting = existingByHash.get(hash);
        const isDuplicate = Boolean(duplicateOfExisting && duplicateOfExisting.absolutePath.replace(/\\/g, "/").toLowerCase() !== normalizedPath);
        if (isDuplicate) duplicatesFound += 1;

        let width: number | undefined;
        let height: number | undefined;
        let durationSeconds: number | undefined;
        let footageClassification: MediaAssetRecord["footageClassification"];
        let sampleRateHz: number | undefined;
        let audioChannels: number | undefined;
        let perceptualHash: string | undefined;

        if (isImage) {
          try {
            const dimensions = await readRasterDimensions(absolutePath);
            width = dimensions.width;
            height = dimensions.height;
            perceptualHash = await computePerceptualHash(absolutePath);
          } catch (error) {
            warnings.push(`${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else if (isVideo) {
          try {
            const metadata = await readVideoMetadata(absolutePath);
            width = metadata.width;
            height = metadata.height;
            durationSeconds = metadata.durationSeconds;
            const classification = await classifyVideoFootage(absolutePath);
            footageClassification = classification.classification;
            perceptualHash = await computePerceptualHash(absolutePath);
          } catch (error) {
            warnings.push(`${absolutePath}: ${error instanceof Error ? error.message : String(error)}`);
          }
        } else {
          const audioMetadata = await readAudioMetadata(absolutePath);
          durationSeconds = audioMetadata.durationSeconds;
          sampleRateHz = audioMetadata.sampleRateHz;
          audioChannels = audioMetadata.audioChannels;
        }

        const relativePath = relative(process.cwd(), absolutePath).replace(/\\/g, "/");
        const type = inferTypeFromPath(absolutePath, extension);
        const inferredTags = inferTagsFromPath(relative(root, absolutePath));
        const seed = seedByPath.get(normalizedPath);

        let nearDuplicates: string[] = existing?.duplicate.visualNearDuplicateOf ?? [];
        if (perceptualHash) {
          nearDuplicates = input.existingRecords
            .filter((record) => record.perceptualHash && record.assetId !== existing?.assetId && hammingDistance(record.perceptualHash, perceptualHash) <= NEAR_DUPLICATE_HAMMING_THRESHOLD)
            .map((record) => record.assetId);
        }

        const record: MediaAssetRecord = {
          assetId: existing?.assetId ?? randomUUID(),
          absolutePath,
          relativePath,
          name: basename(absolutePath),
          // O manifesto legado é a fonte MAIS confiável para `type` (autorado à mão) — tem
          // prioridade sobre a heurística de pasta/nome mesmo em rescans, já que não existe hoje
          // nenhum comando manual de correção de tipo (diferente de tags/aprovação, que sim têm).
          type: seed?.type ?? existing?.type ?? type,
          subtype: existing?.subtype,
          format: extension.replace(".", ""),
          durationSeconds: durationSeconds ?? existing?.durationSeconds,
          width: width ?? existing?.width,
          height: height ?? existing?.height,
          aspectRatio: width && height ? normalizeAspectRatio(width, height) : existing?.aspectRatio,
          fps: existing?.fps,
          videoCodec: existing?.videoCodec,
          audioChannels: audioChannels ?? existing?.audioChannels,
          sampleRateHz: sampleRateHz ?? existing?.sampleRateHz,
          sizeBytes: fileStat.size,
          hash,
          perceptualHash: perceptualHash ?? existing?.perceptualHash,
          createdAt: existing?.createdAt ?? fileStat.birthtime.toISOString(),
          indexedAt: new Date().toISOString(),
          origin: existing?.origin ?? seed?.origin ?? "unknown",
          author: existing?.author ?? seed?.author,
          license: existing?.license ?? seed?.license,
          // Derivado, nunca um campo manual independente: sempre "known" quando há dados reais de
          // licença (existentes ou vindos do manifesto legado), "unknown" caso contrário — assim um
          // re-scan sempre consegue promover "unknown" -> "known" ao encontrar a licença real, em
          // vez de travar no valor persistido da primeira varredura.
          licenseStatus: (existing?.license ?? seed?.license) ? "known" : "unknown",
          sourceUrl: existing?.sourceUrl ?? seed?.sourceUrl,
          client: existing?.client,
          campaign: existing?.campaign,
          themes: existing?.themes && existing.themes.length > 0 ? existing.themes : (seed?.themes ?? []),
          people: existing?.people ?? [],
          actions: existing?.actions ?? [],
          objects: existing?.objects ?? [],
          location: existing?.location,
          emotion: existing?.emotion ?? seed?.emotion,
          style: existing?.style,
          lighting: existing?.lighting,
          colorTemperature: existing?.colorTemperature,
          framing: existing?.framing,
          cameraMovement: existing?.cameraMovement,
          dominantPalette: existing?.dominantPalette,
          tags: existing?.tags && existing.tags.length > 0 ? existing.tags : (seed?.tags && seed.tags.length > 0 ? seed.tags : inferredTags),
          footageClassification: footageClassification ?? existing?.footageClassification,
          scores: existing?.scores ?? {},
          approvalStatus: existing?.approvalStatus ?? "discovered",
          usageHistory: existing?.usageHistory ?? [],
          duplicate: {
            duplicateOf: isDuplicate ? duplicateOfExisting?.assetId : existing?.duplicate.duplicateOf,
            visualNearDuplicateOf: nearDuplicates.length > 0 ? nearDuplicates : undefined,
            derivedFrom: existing?.duplicate.derivedFrom,
          },
          available: true,
          notes: existing?.notes,
        };

        if (existing) updated += 1; else added += 1;
        outcomes.push(record);
        if (!existingByHash.has(hash)) existingByHash.set(hash, record);
      } catch (error) {
        warnings.push(`${absolutePath}: falha ao processar — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  let unavailable = 0;
  for (const record of input.existingRecords) {
    const key = record.absolutePath.replace(/\\/g, "/").toLowerCase();
    if (seenPaths.has(key)) continue;
    if (!record.available) { outcomes.push(record); continue; }
    unavailable += 1;
    outcomes.push({ ...record, available: false });
  }

  return {
    records: outcomes,
    result: { scanned, added, updated, unavailable, duplicatesFound, warnings },
  };
}

export function mediaFolderTypeHintsForTest(): Array<{ token: string; type: MediaAssetType }> {
  return FOLDER_TYPE_HINTS;
}
