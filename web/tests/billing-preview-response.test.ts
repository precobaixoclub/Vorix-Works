import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api-client";
import { previewCapacity } from "@/features/billing/api";

vi.mock("@/lib/api-client", () => ({ apiClient: { post: vi.fn() } }));
afterEach(() => vi.resetAllMocks());

describe("capacity preview", () => {
  it.each([{}, [], { requestedOnCurrentPlan: { totalMonthlyAmount: NaN, currency: "BRL" }, recommendation: {} }, { requestedOnCurrentPlan: { totalMonthlyAmount: -1, currency: "BRL" }, recommendation: {} }])("rejects an invalid financial response before confirmation", async response => {
    vi.mocked(apiClient.post).mockResolvedValue(response);
    await expect(previewCapacity({ users: 5, whatsappConnections: 2 })).rejects.toThrow("Não foi possível simular");
  });

  it("preserves the amount calculated by the backend", async () => {
    const response = { requestedOnCurrentPlan: { totalMonthlyAmount: 338, currency: "BRL" }, recommendation: { options: [] } };
    vi.mocked(apiClient.post).mockResolvedValue(response);
    await expect(previewCapacity({ users: 6, whatsappConnections: 2 })).resolves.toEqual(response);
  });
});
