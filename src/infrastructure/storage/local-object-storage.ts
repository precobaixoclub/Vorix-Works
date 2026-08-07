import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { ObjectStoragePort, ObjectStoragePutInput } from "../../application/ports/object-storage.port.js";

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
