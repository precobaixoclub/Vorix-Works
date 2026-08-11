"use client";

import { useParams } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { RequireAuth } from "@/components/RequireAuth";
import { Spinner } from "@/components/Spinner";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { WorkspaceTopBar } from "@/components/WorkspaceTopBar";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { useWorkspace } from "@/features/workspace/hooks";

/**
 * Casca de todo Workspace — Sprint 04, protegida por autenticação real a partir da Sprint 05
 * (`RequireAuth`). Busca o Workspace UMA VEZ aqui (via API real) e o disponibiliza para toda a
 * árvore de rotas abaixo via `WorkspaceProvider`, para que Home/Chat/Assets/Campaigns/Knowledge/
 * Calendar nunca precisem buscá-lo de novo. `WorkspaceSidebar` é a navegação fixa entre essas
 * áreas — nunca aparece fora daqui.
 */
export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <WorkspaceShell>{children}</WorkspaceShell>
    </RequireAuth>
  );
}

function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const params = useParams<{ workspaceId: string }>();
  const { data: workspace, isLoading, error } = useWorkspace(params.workspaceId);

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-5 w-5 text-ink-muted" />
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <EmptyState
          title="Espaço de Trabalho não encontrado"
          description="Ele pode ter sido removido, arquivado ou você não tem acesso a ele."
        />
      </div>
    );
  }

  return (
    <WorkspaceProvider workspace={workspace}>
      <div className="flex min-h-dvh min-w-0 flex-col md:flex-row">
        <WorkspaceSidebar workspaceId={workspace.id} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:min-h-dvh">
          <WorkspaceTopBar name={workspace.name} status={workspace.status} />
          <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-surface-sunken">{children}</div>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
