export type CampaignLogAction =
  | "ValidationFailed"
  | "CampaignCreated"
  | "CampaignListed"
  | "ExecutionPlanRequested"
  | "ExecutionPlanGenerated"
  | "ExecutionPlanGenerationFailed"
  | "StatusUpdated"
  | "StatusUpdateFailed"
  | "SummaryRequested";

export type CampaignLogEntry = {
  id: string;
  occurredAt: string;
  action: CampaignLogAction;
  message: string;
  campaignId?: string;
  contentId?: string;
  clientId?: string;
  metadata?: Record<string, unknown>;
};

export type CampaignLoggerPort = {
  record(entry: CampaignLogEntry): Promise<void>;
};
