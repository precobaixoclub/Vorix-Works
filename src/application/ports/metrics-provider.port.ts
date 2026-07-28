export type MetricsQuery = {
  channel: string;
  accountId?: string;
  campaignId?: string;
  from: string;
  to: string;
};

export type MetricsSnapshot = {
  source: string;
  metrics: Record<string, number>;
  collectedAt: string;
};

export type MetricsProviderPort = {
  collect(query: MetricsQuery): Promise<MetricsSnapshot>;
};
