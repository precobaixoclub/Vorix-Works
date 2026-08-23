"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { RequireAuth } from "@/components/RequireAuth";
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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "archived">("all");
  const router = useRouter();
  const { state, logout } = useAuth();
  const isPlatformAdmin = state.status === "authenticated" && state.user.isPlatformAdmin;
  const user = state.status === "authenticated" ? state.user : null;
  const workspaceList = workspaces ?? [];
  const hasWorkspaces = workspaceList.length > 0;
  const filteredWorkspaces = workspaceList.filter((workspace) => {
    const matchesQuery = workspace.name.toLowerCase().includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === "all" || workspace.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-10">
      <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-accent">Vorix Works</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-ink">Espaços de trabalho</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
            Escolha a empresa, marca ou cliente que você quer operar.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          {hasWorkspaces ? <Button onClick={() => setIsCreating(true)}>+ Novo espaço</Button> : null}
          {user ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((open) => !open)}
                className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-left hover:bg-surface"
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-xs font-semibold text-accent">
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-36 truncate text-sm font-medium text-ink sm:block">{user.name}</span>
                <span className="text-xs text-ink-faint">▾</span>
              </button>
              {accountMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-border bg-surface-raised p-2 shadow-xl"
                >
                  <div className="border-b border-border px-2 py-2">
                    <p className="truncate text-sm font-medium text-ink">{user.name}</p>
                    <p className="truncate text-xs text-ink-muted">{user.email}</p>
                  </div>
                  {isPlatformAdmin ? (
                    <Link
                      href="/admin"
                      className="mt-2 flex min-h-9 items-center rounded-lg px-2 text-sm font-medium text-ink hover:bg-surface-sunken"
                      onClick={() => setAccountMenuOpen(false)}
                    >
                      Painel administrativo
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      await logout();
                      router.push("/login");
                    }}
                    className="mt-1 flex min-h-9 w-full cursor-pointer items-center rounded-lg px-2 text-left text-sm font-medium text-ink hover:bg-surface-sunken"
                  >
                    Sair
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 py-14 text-sm text-ink-muted">
          <Spinner className="h-4 w-4" /> Carregando espaços de trabalho…
        </div>
      ) : error ? (
        <EmptyState
          title="Não foi possível carregar os espaços de trabalho"
          description={error instanceof Error ? error.message : "Verifique se a API está rodando."}
        />
      ) : !hasWorkspaces ? (
        <section className="rounded-2xl border border-border bg-surface-raised p-5 sm:p-7">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-accent">Primeiro acesso</p>
            <h2 className="mt-2 text-xl font-semibold text-ink">Crie o primeiro espaço da marca</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Cada espaço separa produção, conexões, materiais e publicações de uma empresa ou cliente.
            </p>
            <Button className="mt-5 min-h-12 px-5 text-base" onClick={() => setIsCreating(true)}>
              + Criar primeiro espaço de trabalho
            </Button>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["1", "Dê um nome ao espaço", "Use o nome da empresa, marca ou cliente."],
              ["2", "Entre no espaço", "Conecte redes, materiais e configurações."],
              ["3", "Trabalhe separado", "Tudo fica organizado dentro daquele espaço."],
            ].map(([step, title, description]) => (
              <div key={step} className="rounded-xl border border-border bg-surface p-4">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                  {step}
                </span>
                <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">{description}</p>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-border bg-surface-raised">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h2 className="text-base font-semibold text-ink">Seus espaços</h2>
              <p className="mt-1 text-sm text-ink-muted">
                {workspaceList.length} espaço(s) criado(s). A logo ajuda a identificar a marca rapidamente.
              </p>
            </div>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-h-10 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft sm:max-w-xs"
              placeholder="Buscar espaço"
            />
          </div>
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <div className="flex flex-wrap gap-2">
              {[
                ["all", "Todos"],
                ["active", "Ativos"],
                ["inactive", "Inativos"],
                ["archived", "Arquivados"],
              ].map(([value, label]) => {
                const selected = statusFilter === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value as typeof statusFilter)}
                    className={`min-h-9 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      selected
                        ? "border-accent bg-accent text-white"
                        : "border-border bg-surface text-ink-muted hover:bg-surface-sunken hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="p-4 sm:p-5">
            {filteredWorkspaces.length === 0 ? (
              <EmptyState title="Nenhum espaço encontrado" description="Ajuste a busca ou o filtro para ver outros espaços." />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredWorkspaces.map((workspace) => (
                  <WorkspaceCard key={workspace.id} workspace={workspace} onEdit={() => setEditingWorkspace(workspace)} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {isCreating ? (
        <CreateWorkspaceModal
          onClose={() => setIsCreating(false)}
          onCreated={() => {
            setIsCreating(false);
            mutate();
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
