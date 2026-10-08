import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ObjectStoragePort, ObjectStoragePutInput } from "../../application/ports/object-storage.port.js";
import { ReferenceAssetError } from "../../application/assets/reference-asset-policy.js";

export type LocalObjectStorageConfig = {
  rootDir: string;
  publicBaseUrl: string;
};

export class LocalObjectStorage implements ObjectStoragePort {
  private readonly rootDir: string;

  constructor(private readonly config: LocalObjectStorageConfig) {
    this.rootDir = resolve(config.rootDir);
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string }> {
    await mkdir(this.rootDir, { recursive: true });
    return { ok: true, safeMessage: "Object storage local configurado." };
  }

  async put(input: ObjectStoragePutInput): Promise<{ url: string }> {
    const absolutePath = resolveObjectPath(this.rootDir, input.key);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.body);
    return { url: `${this.config.publicBaseUrl.replace(/\/$/, "")}/${encodeKey(input.key)}` };
  }

  async delete(key: string): Promise<void> {
    const absolutePath = resolveObjectPath(this.rootDir, key);
    await import("node:fs/promises").then((fs) => fs.rm(absolutePath, { force: true }));
  }

  resolvePublicUrl(key: string): string {
    return `${this.config.publicBaseUrl.replace(/\/$/, "")}/${encodeKey(key)}`;
  }

  async read(key: string, options: { maxBytes: number }): Promise<Buffer> {
    let absolutePath: string;
    try {
      absolutePath = resolveObjectPath(this.rootDir, key);
    } catch {
      throw new ReferenceAssetError("REFERENCE_ASSET_INVALID", "path_traversal");
    }
    // Contenção canônica: resolve symlinks do alvo E da raiz antes de comparar — um symlink dentro
    // do storage apontando para fora nunca é seguido.
    const [realRoot, realTarget] = await Promise.all([
      realpath(this.rootDir).catch(() => undefined),
      realpath(absolutePath).catch(() => undefined),
    ]);
    if (!realRoot || !realTarget) throw new ReferenceAssetError("REFERENCE_ASSET_NOT_FOUND", "object_missing");
    if (!realTarget.startsWith(`${realRoot}${sep}`)) throw new ReferenceAssetError("REFERENCE_ASSET_INVALID", "symlink_escape");
    const fileStat = await stat(realTarget).catch(() => undefined);
    if (!fileStat?.isFile()) throw new ReferenceAssetError("REFERENCE_ASSET_NOT_FOUND", "object_missing");
    if (fileStat.size > options.maxBytes) throw new ReferenceAssetError("REFERENCE_ASSET_TOO_LARGE", "size_limit");
    return readFile(realTarget);
  }
}

export function resolveObjectPath(rootDir: string, key: string): string {
  const normalizedKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedKey || normalizedKey.includes("..")) {
    throw new Error("INVALID_OBJECT_KEY");
  }
  const root = resolve(rootDir);
  const target = resolve(root, normalizedKey);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("INVALID_OBJECT_KEY");
  }
  return target;
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}
