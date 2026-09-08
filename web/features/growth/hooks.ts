import useSWR from "swr";
import { fetchGrowthDashboard } from "./api";

export function useGrowthDashboard() {
  return useSWR(["growth", "dashboard"], () => fetchGrowthDashboard());
}
