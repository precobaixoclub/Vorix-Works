"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Workspace } from "@/features/workspace/types";

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({ workspace, children }: { workspace: Workspace; children: ReactNode }) {
  return <WorkspaceContext.Provider value={workspace}>{children}</WorkspaceContext.Provider>;
}

/** Só pode ser chamado dentro de `app/workspaces/[workspaceId]/layout.tsx` (ou seus filhos) — nunca fora de um Workspace. */
export function useCurrentWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("useCurrentWorkspace() chamado fora de um WorkspaceProvider.");
  return workspace;
}
