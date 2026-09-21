import useSWR from "swr";
import { fetchBillingOverview, fetchCapacityState } from "./api";

export function useBillingOverview() {
  return useSWR(["billing", "overview"], () => fetchBillingOverview());
}

export function useCapacityState() {
  return useSWR(["billing", "capacity"], () => fetchCapacityState());
}
