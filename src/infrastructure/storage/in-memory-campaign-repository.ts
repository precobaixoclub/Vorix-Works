import type { CampaignRepositoryPort } from "../../application/campaign/campaign-repository.port.js";
import type { CampaignPlan } from "../../application/campaign/campaign.types.js";

export class InMemoryCampaignRepository implements CampaignRepositoryPort {
  private readonly plans = new Map<string, CampaignPlan>();

  async save(plan: CampaignPlan): Promise<void> {
    this.plans.set(plan.id, clone(plan));
  }

  async findById(id: string): Promise<CampaignPlan | undefined> {
    return clone(this.plans.get(id));
  }

  async list(): Promise<CampaignPlan[]> {
    return Array.from(this.plans.values()).map(clone);
  }

  clear(): void {
    this.plans.clear();
  }
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}
