import useSWR from "swr";
import { fetchBillingOverview } from "./api";

export function useBillingOverview() {
  return useSWR(["billing", "overview"], () => fetchBillingOverview());
}
