export type CampaignDraft = {
  name: string;
  channel: string;
  objective: string;
  budget?: number;
  audience?: Record<string, unknown>;
  creatives?: string[];
};

export type CampaignProviderPort = {
  createDraft(campaign: CampaignDraft): Promise<{ externalId: string; status: string }>;
  pause(externalId: string): Promise<void>;
  resume(externalId: string): Promise<void>;
};
