import { pathToFileURL } from "node:url";
import type { Skill } from "../../domain/skills/skill.contract.js";
import type { SkillModuleLoaderPort } from "../../application/skills/helena.ports.js";
import type { DiscoveredSkillSource } from "../../application/skills/helena.types.js";
import { LocalArtifactDelivery } from "../artifacts/local-artifact-delivery.js";

export type FileSystemSkillModuleLoaderOptions = {
  runtimeDependencies?: Record<string, unknown>;
};

export class FileSystemSkillModuleLoader implements SkillModuleLoaderPort {
  private readonly runtimeDependencies: Record<string, unknown>;

  constructor(options: FileSystemSkillModuleLoaderOptions = {}) {
    this.runtimeDependencies = { ...(options.runtimeDependencies ?? {}) };
    if (!("artifactDelivery" in this.runtimeDependencies)) {
      this.runtimeDependencies.artifactDelivery = new LocalArtifactDelivery();
    }
  }

  async load(source: DiscoveredSkillSource): Promise<Skill> {
    if (!source.modulePath) {
      throw new Error(`Skill ${source.sourceId} não possui runtime.entrypoint.`);
    }

    const moduleUrl = pathToFileURL(source.modulePath).href;
    const loaded = await import(moduleUrl) as { skill?: Skill; default?: Skill; createSkill?: (dependencies: Record<string, unknown>) => Skill };
    const skill = loaded.skill ?? loaded.default ?? loaded.createSkill?.(this.runtimeDependencies);

    if (!skill || typeof skill.execute !== "function" || !skill.manifest) {
      throw new Error(`Módulo da Skill ${source.sourceId} não exporta uma Skill válida.`);
    }

    return skill;
  }
}
