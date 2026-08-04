import useSWR from "swr";
import { listAssets } from "./api";
import type { AssetKind } from "./types";

export function useAssets(workspaceId: string, filter?: { kind?: AssetKind; search?: string }) {
  return useSWR(["assets", workspaceId, filter?.kind, filter?.search], () => listAssets(workspaceId, filter));
}
