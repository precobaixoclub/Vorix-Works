import type { CampaignPlan } from "./campaign.types.js";

export type CampaignRepositoryPort = {
  save(plan: CampaignPlan): Promise<void>;
  findById(id: string): Promise<CampaignPlan | undefined>;
  list(): Promise<CampaignPlan[]>;
};
