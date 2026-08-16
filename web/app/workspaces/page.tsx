"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { RequireAuth } from "@/components/RequireAuth";
import { ScreenGuide } from "@/components/ScreenGuide";
import { Spinner } from "@/components/Spinner";
import { useAuth } from "@/contexts/auth-context";
import { CreateWorkspaceModal } from "@/features/workspace/components/CreateWorkspaceModal";
import { EditWorkspaceModal } from "@/features/workspace/components/EditWorkspaceModal";
import { WorkspaceCard } from "@/features/workspace/components/WorkspaceCard";
import { useWorkspaces } from "@/features/workspace/hooks";
import type { Workspace } from "@/features/workspace/types";

export default function WorkspacesPage() {
  return (
    <RequireAuth>
      <WorkspacesPageContent />
    </RequireAuth>
  );
}

function WorkspacesPageContent() {
  const { data: workspaces, error, isLoading, mutate } = useWorkspaces();
  const [isCreating, setIsCreating] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | undefined>();
  const router = useRouter();
  const { state, logout } = useAuth();
  const isPlatformAdmin = state.status === "authenticated" && state.user.isPlatformAdmin;
  const user = state.status === "authenticated" ? state.user : null;

  return (
    <main className="mx-auto max-w-5xl px-3 py-5 sm:px-6 sm:py-10">
      {user ? (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <div className="font-medium text-ink">Logado como {user.name}</div>
            <div className="truncate text-xs text-ink-muted">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={async () => {
              await logout();
              router.push("/login");
            }}
            className="min-h-9 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Sair
          </button>
        </div>
      ) : null}

      <PageHeader
        title="Espaços de Trabalho"
        description="Cada Espaço de Trabalho é uma empresa, marca ou cliente — o centro de tudo no Vorix."
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {isPlatformAdmin ? (
              <Link
                href="/admin"
                className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/20"
              >
                Painel administrativo
              </Link>
            ) : null}
            <Button onClick={() => setIsCreating(true)}>+ Novo Espaço de Trabalho</Button>
          </div>
        }
      />

      <ScreenGuide
        title="Por onde começar"
        description="Escolha o espaço da marca que você quer operar. Tudo dentro dele fica separado das outras marcas."
        items={[
          "Crie um espaço para cada cliente ou marca.",
          "Entre no espaço para conectar redes sociais.",
          "Configure produção automática dentro do espaço.",
          "Use o painel administrativo só para conta, plano e chaves.",
        ]}
        aside={<p>O botão Sair fica no topo desta tela caso precise trocar de usuário.</p>}
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-14 text-sm text-ink-muted">
          <Spinner className="h-4 w-4" /> Carregando espaços de trabalho…
        </div>
      ) : error ? (
        <EmptyState
          title="Não foi possível carregar os espaços de trabalho"
          description={error instanceof Error ? error.message : "Verifique se a API está rodando."}
        />
      ) : !workspaces || workspaces.length === 0 ? (
        <EmptyState
          title="Nenhum espaço de trabalho ainda"
          description="Crie o primeiro espaço de trabalho para organizar campanhas, produção e ativos."
          action={<Button onClick={() => setIsCreating(true)}>+ Novo Espaço de Trabalho</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((workspace) => (
            <WorkspaceCard key={workspace.id} workspace={workspace} onEdit={() => setEditingWorkspace(workspace)} />
          ))}
        </div>
      )}

      {isCreating ? (
        <CreateWorkspaceModal
          onClose={() => setIsCreating(false)}
          onCreated={(workspace) => {
            setIsCreating(false);
            mutate();
            router.push(`/workspaces/${workspace.id}`);
          }}
        />
      ) : null}

      {editingWorkspace ? (
        <EditWorkspaceModal
          workspace={editingWorkspace}
          onClose={() => setEditingWorkspace(undefined)}
          onUpdated={() => {
            setEditingWorkspace(undefined);
            mutate();
          }}
        />
      ) : null}
    </main>
  );
}
