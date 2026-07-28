import type { CampaignWorkspace } from "../../domain/campaign-intelligence/campaign-intelligence.model.js";

/** Mesmo espírito de `CompanyKnowledgeRepositoryPort`: a Campaign Intelligence Engine (infraestrutura) depende só desta interface. */
export type CampaignWorkspaceRepositoryPort = {
  save(workspace: CampaignWorkspace): Promise<void>;
  findByCampaignId(campaignId: string): Promise<CampaignWorkspace | undefined>;
  list(): Promise<CampaignWorkspace[]>;
};
