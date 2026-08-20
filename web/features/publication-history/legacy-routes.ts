export type LegacyPublishNetwork = "facebook" | "instagram" | "tiktok";

export function legacyNetworkPublishHref(workspaceId: string, network: LegacyPublishNetwork) {
  return `/workspaces/${encodeURIComponent(workspaceId)}/publish?network=${network}`;
}
