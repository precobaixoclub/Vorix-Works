import useSWR from "swr";
import { getBrandProfile } from "./api";

export function useBrandProfile(workspaceId: string) {
  return useSWR(["brand-profile", workspaceId], () => getBrandProfile(workspaceId));
}
