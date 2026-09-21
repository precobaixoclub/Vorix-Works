"use client";

import { usePathname } from "next/navigation";
import { useParams } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { EmptyState } from "@/components/EmptyState";
import { RequireAuth } from "@/components/RequireAuth";
import { Spinner } from "@/components/Spinner";
import { WorkspaceReadOnlyBanner } from "@/components/WorkspaceReadOnlyBanner";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { WorkspaceTopBar } from "@/components/WorkspaceTopBar";
import { BACKSTAGE_NAV, canUseBackstage } from "@/components/workspace-navigation";
import { useAuth } from "@/contexts/auth-context";
import { SidebarProvider } from "@/contexts/sidebar-context";
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

  // Onboarding guiado usa um shell simplificado (só a própria página) — mostrar os 15+ módulos
  // da sidebar enquanto a pessoa ainda está configurando a conta é ruído, não ajuda (seção 21 do
  // pedido de Onboarding). Mesmo padrão de detecção por pathname já usado acima pro Bastidor.
  const isOnboardingPath = pathname === `${base}/onboarding`;
  if (isOnboardingPath) {
    return (
      <WorkspaceProvider workspace={workspace}>
        <div className="min-h-dvh bg-surface-sunken">{content}</div>
      </WorkspaceProvider>
    );
  }

  // Conversas e Kanban entram em "modo foco": sem scroll na PÁGINA (o scroll fica dentro de cada
  // painel do Inbox / de cada coluna do board), preenchendo 100% da altura restante em vez do
  // padding/scroll padrão de página comum. Kanban entrou aqui no ajuste de ergonomia pedido pelo
  // usuário — "hoje a página inteira desce pra ver os cards" era exatamente este wrapper de layout
  // (fora do controle de `kanban/page.tsx`) tendo `overflow-y-auto` sem altura travada, então o
  // scroll por coluna do board nunca tinha um viewport limitado pra funcionar dentro dele.
  const isConversasPath = pathname === `${base}/conversas`;
  const isKanbanPath = pathname === `${base}/kanban`;
  const isFocusPath = isConversasPath || isKanbanPath;

  return (
    <WorkspaceProvider workspace={workspace}>
      <SidebarProvider>
        <div className="flex min-h-dvh min-w-0 flex-col md:flex-row">
          <WorkspaceSidebar workspaceId={workspace.id} />
          <div
            className={
              isFocusPath
                ? // `md:flex-1` (não `flex-1` incondicional) de propósito: no mobile o eixo principal
                  // deste flex é vertical (flex-col) — `flex-1` ali reinterpretaria como
                  // flex-basis:0% na ALTURA, entrando em conflito com o `h-dvh` explícito e inflando
                  // o container para o tamanho do conteúdo (achado real via Playwright, mobile-390).
                  // A partir de `md:` o eixo vira horizontal (flex-row) e `flex-1` volta a fazer o
                  // que sempre fez: crescer na LARGURA ao lado da sidebar (`shrink-0`).
                  "flex h-dvh min-w-0 flex-col overflow-hidden md:flex-1"
                : "flex min-h-0 min-w-0 flex-1 flex-col md:min-h-dvh"
            }
          >
            <WorkspaceTopBar workspaceId={workspace.id} name={workspace.name} status={workspace.status} hideBreadcrumb={isFocusPath} />
            <WorkspaceReadOnlyBanner workspaceId={workspace.id} />
            <div
              className={
                isFocusPath
                  ? "min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-sunken pb-16 md:pb-0"
                  : "min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-surface-sunken pb-24 md:pb-0"
              }
            >
              {content}
            </div>
          </div>
          <BottomNav workspaceId={workspace.id} />
        </div>
      </SidebarProvider>
    </WorkspaceProvider>
  );
}
