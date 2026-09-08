import useSWR from "swr";
import { getOnboarding } from "./api";

export function useOnboarding(workspaceId: string | undefined) {
  return useSWR(workspaceId ? ["onboarding", workspaceId] : null, () => getOnboarding(workspaceId as string));
}
