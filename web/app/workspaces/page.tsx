"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { RequireAuth } from "@/components/RequireAuth";
import { Spinner } from "@/components/Spinner";
import { CreateWorkspaceModal } from "@/features/workspace/components/CreateWorkspaceModal";
import { WorkspaceCard } from "@/features/workspace/components/WorkspaceCard";
import { useWorkspaces } from "@/features/workspace/hooks";

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
  const router = useRouter();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Espaços de Trabalho"
        description="Cada Espaço de Trabalho é uma empresa, marca ou cliente — o centro de tudo no Vorix."
        actions={<Button onClick={() => setIsCreating(true)}>+ Novo Espaço de Trabalho</Button>}
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
          description="Crie o primeiro espaço de trabalho para começar a organizar campanhas, conversas e ativos."
          action={<Button onClick={() => setIsCreating(true)}>+ Novo Espaço de Trabalho</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((workspace) => (
            <WorkspaceCard key={workspace.id} workspace={workspace} />
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
    </main>
  );
}
