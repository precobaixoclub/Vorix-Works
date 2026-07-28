import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CampaignRepositoryPort } from "../../application/campaign/campaign-repository.port.js";
import type { CampaignPlan } from "../../application/campaign/campaign.types.js";
import { InMemoryCampaignRepository } from "./in-memory-campaign-repository.js";

export class LocalJsonCampaignRepository implements CampaignRepositoryPort {
  private readonly filePath: string;
  private readonly memory = new InMemoryCampaignRepository();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = sanitizeFilePath(filePath);
  }

  async save(plan: CampaignPlan): Promise<void> {
    await this.loadOnce();
    await this.memory.save(plan);
    await this.persist();
  }

  async findById(id: string): Promise<CampaignPlan | undefined> {
    await this.loadOnce();
    return this.memory.findById(id);
  }

  async list(): Promise<CampaignPlan[]> {
    await this.loadOnce();
    return this.memory.list();
  }

  private async loadOnce(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const plans = JSON.parse(raw) as CampaignPlan[];
      for (const plan of plans) await this.memory.save(plan);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const plans = await this.memory.list();
    await writeFile(this.filePath, JSON.stringify(plans, null, 2), "utf8");
  }
}

function sanitizeFilePath(filePath: string): string {
  if (!filePath?.trim()) throw new Error("Caminho do arquivo de campanhas local é obrigatório.");
  if (filePath.includes("\0")) throw new Error("Caminho do arquivo de campanhas local contém caractere inválido.");
  return filePath;
}
