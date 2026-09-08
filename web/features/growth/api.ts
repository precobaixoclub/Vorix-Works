import { apiClient } from "@/lib/api-client";
import type { GrowthDashboard } from "./types";

/** `GET /v1/admin/growth-dashboard` — ADMIN-only (401/403 fora disso). */
export async function fetchGrowthDashboard(): Promise<GrowthDashboard> {
  return apiClient.get<GrowthDashboard>("/v1/admin/growth-dashboard");
}
