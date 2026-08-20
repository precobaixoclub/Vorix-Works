"use client";

import { usePathname } from "next/navigation";
import { useParams } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { EmptyState } from "@/components/EmptyState";
import { RequireAuth } from "@/components/RequireAuth";
import { Spinner } from "@/components/Spinner";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { WorkspaceTopBar } from "@/components/WorkspaceTopBar";
import { BACKSTAGE_NAV, canUseBackstage } from "@/components/workspace-navigation";
import { useAuth } from "@/contexts/auth-context";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { useWorkspace } from "@/features/workspace/hooks";

/**
 * Casca de todo Workspace — Sprint 04, protegida por autenticação real a partir da Sprint 05
 * (`RequireAuth`). Busca o Workspace UMA VEZ aqui (via API real) e o disponibiliza para toda a
 * árvore de rotas abaixo via `WorkspaceProvider`, para que Home/Production/Assets/Campaigns/Knowledge/
 * Calendar nunca precisem buscá-lo de novo. `WorkspaceSidebar` (desktop) e `BottomNav` (mobile) são
 * a navegação fixa entre essas áreas — nunca aparecem fora daqui.
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
  const pathname = usePathname();
  const { state } = useAuth();
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

  const base = `/workspaces/${workspace.id}`;
  const isBackstagePath = BACKSTAGE_NAV.some((item) => pathname.startsWith(`${base}${item.href}`));
  const canSeeBackstage = state.status === "authenticated" && canUseBackstage(state.role);
  const content = isBackstagePath && !canSeeBackstage ? (
    <main className="mx-auto flex min-h-[60dvh] max-w-3xl items-center justify-center px-3 py-10 sm:px-6">
      <EmptyState title="Bastidor restrito" description="Esta área técnica fica disponível apenas para owner e admin do tenant." />
    </main>
  ) : children;

  return (
    <WorkspaceProvider workspace={workspace}>
      <div className="flex min-h-dvh min-w-0 flex-col md:flex-row">
        <WorkspaceSidebar workspaceId={workspace.id} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:min-h-dvh">
          <WorkspaceTopBar workspaceId={workspace.id} name={workspace.name} status={workspace.status} />
          <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-surface-sunken pb-16 md:pb-0">{content}</div>
        </div>
        <BottomNav workspaceId={workspace.id} />
      </div>
    </WorkspaceProvider>
  );
}
