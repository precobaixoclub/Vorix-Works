import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SkillDiscoveryPort } from "../../application/skills/helena.ports.js";
import type { DiscoveredSkillSource } from "../../application/skills/helena.types.js";

export type FileSystemSkillDiscoveryOptions = {
  rootDirectories: string[];
  manifestFileName?: string;
  ignoreDirectoriesStartingWith?: string;
};

export class FileSystemSkillDiscovery implements SkillDiscoveryPort {
  private readonly rootDirectories: string[];
  private readonly manifestFileName: string;
  private readonly ignoreDirectoriesStartingWith: string;

  constructor(options: FileSystemSkillDiscoveryOptions) {
    this.rootDirectories = options.rootDirectories.map((directory) => resolve(directory));
    this.manifestFileName = options.manifestFileName ?? "skill.manifest.json";
    this.ignoreDirectoriesStartingWith = options.ignoreDirectoriesStartingWith ?? "_";
  }

  async discover(): Promise<DiscoveredSkillSource[]> {
    const sources: DiscoveredSkillSource[] = [];
    for (const rootDirectory of this.rootDirectories) {
      sources.push(...await this.discoverInside(rootDirectory));
    }
    return sources;
  }

  private async discoverInside(directory: string): Promise<DiscoveredSkillSource[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const sources: DiscoveredSkillSource[] = [];

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(this.ignoreDirectoriesStartingWith)) continue;
        sources.push(...await this.discoverInside(fullPath));
        continue;
      }

      if (!entry.isFile() || entry.name !== this.manifestFileName) continue;

      const raw = await readFile(fullPath, "utf8");
      const manifest = JSON.parse(raw) as Record<string, unknown>;
      const entrypoint = readEntrypoint(manifest);
      sources.push({
        sourceId: typeof manifest.id === "string" ? manifest.id : fullPath,
        location: fullPath,
        manifest,
        modulePath: entrypoint ? resolve(directory, entrypoint) : undefined,
      });
    }

    return sources;
  }
}

function readEntrypoint(manifest: Record<string, unknown>): string | undefined {
  const runtime = manifest.runtime;
  if (typeof runtime !== "object" || runtime === null || Array.isArray(runtime)) return undefined;
  const entrypoint = (runtime as Record<string, unknown>).entrypoint;
  return typeof entrypoint === "string" ? entrypoint : undefined;
}
