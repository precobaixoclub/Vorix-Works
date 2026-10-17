import useSWR from "swr";
import { fetchBillingOverview, fetchCapacityState, fetchAiCredits } from "./api";

export function useBillingOverview() {
  return useSWR(["billing", "overview"], () => fetchBillingOverview());
}

export function useAiCredits() {
  return useSWR(["billing", "ai-credits"], () => fetchAiCredits());
}

export function useCapacityState() {
  return useSWR(["billing", "capacity"], () => fetchCapacityState());
}
