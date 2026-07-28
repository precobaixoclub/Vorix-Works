import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CampaignWorkspaceRepositoryPort } from "../../application/campaign-intelligence/campaign-workspace-repository.port.js";
import type { CampaignWorkspace } from "../../domain/campaign-intelligence/campaign-intelligence.model.js";

/** Persistência local em JSON, um Workspace por campanha — mesmo padrão load-once/full-rewrite de `LocalJsonCompanyKnowledgeRepository`. */
export class LocalJsonCampaignWorkspaceRepository implements CampaignWorkspaceRepositoryPort {
  private readonly filePath: string;
  private readonly byCampaignId = new Map<string, CampaignWorkspace>();
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = sanitizeFilePath(filePath);
  }

  async save(workspace: CampaignWorkspace): Promise<void> {
    await this.loadOnce();
    this.byCampaignId.set(workspace.campaignId, workspace);
    await this.persist();
  }

  async findByCampaignId(campaignId: string): Promise<CampaignWorkspace | undefined> {
    await this.loadOnce();
    return this.byCampaignId.get(campaignId);
  }

  async list(): Promise<CampaignWorkspace[]> {
    await this.loadOnce();
    return Array.from(this.byCampaignId.values());
  }

  private async loadOnce(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const workspaces = JSON.parse(raw) as CampaignWorkspace[];
      for (const workspace of workspaces) this.byCampaignId.set(workspace.campaignId, workspace);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(Array.from(this.byCampaignId.values()), null, 2), "utf8");
  }
}

function sanitizeFilePath(filePath: string): string {
  if (!filePath?.trim()) throw new Error("Caminho do arquivo de workspace de campanha é obrigatório.");
  if (filePath.includes("\0")) throw new Error("Caminho do arquivo de workspace de campanha contém caractere inválido.");
  return filePath;
}
