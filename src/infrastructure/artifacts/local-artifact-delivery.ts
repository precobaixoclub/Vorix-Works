import { mkdir, readFile as readFileBytes, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactDeliveryPort,
  ArtifactFileReadInput,
  ArtifactFileWriteInput,
  ArtifactReadFile,
  ArtifactWrittenFile,
  ArtifactZipEntry,
  ArtifactZipWriteInput,
} from "../../application/ports/artifact-delivery.port.js";
import type { ArtifactProvenance } from "../../shared/utils/artifact-provenance.js";

export type LocalArtifactDeliveryOptions = {
  rootDir?: string;
};

export class LocalArtifactDelivery implements ArtifactDeliveryPort {
  private readonly rootDir: string;

  constructor(options: LocalArtifactDeliveryOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? path.join(process.cwd(), "artifacts"));
  }

  async writeFile(input: ArtifactFileWriteInput): Promise<ArtifactWrittenFile> {
    const absolutePath = resolveArtifactPath(this.rootDir, input.executionId, input.relativePath);
    const content = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : Buffer.from(input.content);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
    await writeFile(provenanceSidecarPath(absolutePath), JSON.stringify(input.provenance));

    return {
      absolutePath,
      relativePath: normalizeRelativePath(input.relativePath),
      sizeBytes: content.byteLength,
      mimeType: input.mimeType,
    };
  }

  async createZip(input: ArtifactZipWriteInput): Promise<ArtifactWrittenFile> {
    const zipBytes = createZipArchive(input.entries);
    return this.writeFile({
      executionId: input.executionId,
      relativePath: input.relativePath,
      content: zipBytes,
      mimeType: "application/zip",
      provenance: input.provenance,
    });
  }

  async readFile(input: ArtifactFileReadInput): Promise<ArtifactReadFile | undefined> {
    const absolutePath = resolveArtifactPath(this.rootDir, input.executionId, input.relativePath);
    try {
      const data = await readFileBytes(absolutePath);
      return {
        absolutePath,
        relativePath: normalizeRelativePath(input.relativePath),
        sizeBytes: data.byteLength,
        data: new Uint8Array(data),
        provenance: await readProvenanceSidecar(provenanceSidecarPath(absolutePath)),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}

/** Sidecar de proveniência — arquivo irmão, nunca embutido no conteúdo (que pode ser binário
 * arbitrário, ex. PNG/WAV). Ausente é o caso normal para conteúdo que chegou por fora do
 * `ArtifactDeliveryPort` (ex.: intervenção assistida de humano/IDE) — nunca um erro. */
function provenanceSidecarPath(absolutePath: string): string {
  return `${absolutePath}.provenance.json`;
}

async function readProvenanceSidecar(sidecarPath: string): Promise<ArtifactProvenance | undefined> {
  try {
    const raw = await readFileBytes(sidecarPath, "utf8");
    return JSON.parse(raw) as ArtifactProvenance;
  } catch {
    // ENOENT (sem sidecar) ou JSON corrompido — em ambos os casos, trata como "proveniência
    // desconhecida" (undefined), nunca lança: leitura de sidecar nunca pode derrubar a leitura do
    // artefato real.
    return undefined;
  }
}

/**
 * Exportada (além de usada internamente) para que outros adaptadores de infraestrutura que
 * também gravam dentro de `artifacts/<executionId>/` — ex. `FfmpegVideoRenderingAdapter` —
 * reaproveitem exatamente esta mesma defesa contra path traversal em vez de duplicá-la.
 */
export function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || path.isAbsolute(normalized)) {
    throw new Error(`Caminho relativo de artefato inválido: ${relativePath}`);
  }
  return normalized;
}

export function sanitizePathSegment(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!sanitized) {
    throw new Error("executionId é obrigatório para gravar artefatos.");
  }
  return sanitized;
}

/** Resolve e valida `artifacts/<executionId>/<relativePath>` — mesma lógica usada por `LocalArtifactDelivery`. */
export function resolveArtifactPath(rootDir: string, executionId: string, relativePath: string): string {
  const safeExecutionId = sanitizePathSegment(executionId);
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(rootDir, safeExecutionId, normalizedRelativePath);
  const executionRoot = path.resolve(rootDir, safeExecutionId);

  if (absolutePath !== executionRoot && !absolutePath.startsWith(`${executionRoot}${path.sep}`)) {
    throw new Error(`Caminho de artefato inválido: ${relativePath}`);
  }

  return absolutePath;
}

function createZipArchive(entries: ArtifactZipEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = normalizeRelativePath(entry.relativePath);
    const fileNameBuffer = Buffer.from(fileName, "utf8");
    const data = Buffer.from(entry.data);
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.byteLength, 18);
    localHeader.writeUInt32LE(data.byteLength, 22);
    localHeader.writeUInt16LE(fileNameBuffer.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, fileNameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.byteLength, 20);
    centralHeader.writeUInt32LE(data.byteLength, 24);
    centralHeader.writeUInt16LE(fileNameBuffer.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, fileNameBuffer);
    offset += localHeader.byteLength + fileNameBuffer.byteLength + data.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localDirectory.byteLength, 16);
  end.writeUInt16LE(0, 20);

  return Uint8Array.from(Buffer.concat([localDirectory, centralDirectory, end]));
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = createCrcTable();

function createCrcTable(): number[] {
  const table: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
