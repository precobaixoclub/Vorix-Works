export const CAMPAIGN_STATUSES = ["draft", "scheduled", "in_progress", "completed", "cancelled"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export type CampaignFormat = "image" | "video" | "carousel" | "story" | "reel";
export type CampaignOrigin = "manual" | "ai_suggested";

export type Campaign = {
  id: string;
  workspaceId: string;
  name: string;
  status: CampaignStatus;
  format: CampaignFormat;
  scheduledDate?: string;
  origin: CampaignOrigin;
  createdAt: string;
};
