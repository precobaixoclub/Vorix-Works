import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { InboxMediaStorageGetResult, InboxMediaStoragePort, InboxMediaStoragePutInput } from "../../application/ports/inbox-media-storage.port.js";

export type LocalInboxMediaStorageConfig = {
  /** Diretório PRIVADO, nunca servido estaticamente pelo Fastify — só o proxy autenticado
   * (`GET /v1/inbox/media/:messageId`) lê daqui. Deve ser diferente do `rootDir` do
   * `ObjectStoragePort` público. */
  rootDir: string;
};

/** Mesma lógica de path-safety de `LocalObjectStorage` (`resolveObjectPath`), mas sem
 * `resolvePublicUrl` — este storage nunca produz uma URL, só bytes através do proxy. */
export class LocalInboxMediaStorage implements InboxMediaStoragePort {
  private readonly rootDir: string;

  constructor(config: LocalInboxMediaStorageConfig) {
    this.rootDir = resolve(config.rootDir);
  }

  async health(): Promise<{ ok: boolean; safeMessage?: string }> {
    await mkdir(this.rootDir, { recursive: true });
    return { ok: true, safeMessage: "Storage local de mídia de conversas configurado." };
  }

  async put(input: InboxMediaStoragePutInput): Promise<void> {
    const absolutePath = this.resolvePath(input.key);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.body);
    await writeFile(`${absolutePath}.contenttype`, input.contentType, "utf8");
  }

  async get(key: string): Promise<InboxMediaStorageGetResult | undefined> {
    const absolutePath = this.resolvePath(key);
    try {
      const [body, contentType] = await Promise.all([
        readFile(absolutePath),
        readFile(`${absolutePath}.contenttype`, "utf8").catch(() => "application/octet-stream"),
      ]);
      return { body, contentType };
    } catch {
      return undefined;
    }
  }

  async delete(key: string): Promise<void> {
    const absolutePath = this.resolvePath(key);
    await rm(absolutePath, { force: true });
    await rm(`${absolutePath}.contenttype`, { force: true });
  }

  private resolvePath(key: string): string {
    const normalizedKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalizedKey || normalizedKey.includes("..")) throw new Error("INVALID_OBJECT_KEY");
    const root = this.rootDir;
    const target = resolve(root, normalizedKey);
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("INVALID_OBJECT_KEY");
    return target;
  }
}
