import useSWR from "swr";
import { getBrandIdentity } from "./api";

export function useBrandIdentity(workspaceId: string) {
  return useSWR(["brand-identity", workspaceId], () => getBrandIdentity(workspaceId));
}
