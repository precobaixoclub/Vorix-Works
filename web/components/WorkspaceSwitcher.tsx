"use client";

import Link from "next/link";
import { Check, ChevronDown, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useWorkspaces } from "@/features/workspace/hooks";
import { useSolutions } from "@/features/solutions/hooks";
import { WORKSPACE_SEARCH_MIN, buildGlobalNavigation, organizeWorkspaces, workspaceInitials, workspaceSwitchHref } from "@/components/global-navigation";
import { cn } from "@/lib/utils";

/** Selo com as iniciais do workspace — identifica a empresa de relance (mesma cor para todos: só forma, não status). */
function WorkspaceBadge({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-solution/15 font-bold text-solution",
        size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs",
      )}
    >
      {workspaceInitials(name)}
    </span>
  );
}

/**
 * Seletor de espaço de trabalho (Reorganização de UX — Fase 2). Mostra a empresa ativa, lista
 * TODOS os espaços (o atual marcado, os outros em ordem alfabética) e ganha busca quando há
 * muitos. Trocar leva à mesma área no outro espaço — só o caminho da tela de lista, nunca filtros,
 * busca ou registros do anterior (`workspaceSwitchHref`). A lista vem de `GET /v1/workspaces`: o
 * servidor decide o que a pessoa pode ver.
 */
export function WorkspaceSwitcher({ currentWorkspaceId, currentWorkspaceName }: { currentWorkspaceId: string; currentWorkspaceName: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const pathname = usePathname();
  const { data: workspaces, isLoading } = useWorkspaces("active");
  const { available } = useSolutions();
  const areas = useMemo(() => buildGlobalNavigation(available), [available]);
  const currentBase = `/workspaces/${currentWorkspaceId}`;
  const all = workspaces ?? [];
  const showSearch = all.length >= WORKSPACE_SEARCH_MIN;
  const visible = organizeWorkspaces(all, currentWorkspaceId, query);

  function close(restoreFocus = true) {
    setOpen(false);
    setQuery("");
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Com busca, o foco vai direto para ela (só em tela com mouse — no celular não abre o teclado sozinho).
  useEffect(() => {
    if (open && showSearch && window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus();
  }, [open, showSearch]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Espaço de trabalho: ${currentWorkspaceName}. Trocar de espaço`}
        data-testid="workspace-switcher"
        className="flex min-h-[44px] min-w-0 max-w-[min(16rem,100%)] md:min-h-[38px] items-center gap-2 rounded-lg border border-border bg-surface-sunken py-1 pl-1 pr-2 text-left text-sm font-semibold text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
      >
        <WorkspaceBadge name={currentWorkspaceName} size="sm" />
        <span className="min-w-0 truncate">{currentWorkspaceName}</span>
        <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-150", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-40 mt-1.5 flex max-h-[min(28rem,calc(100dvh-5rem))] w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-xl">
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Espaços de trabalho</p>
          {showSearch ? (
            <label className="mx-2 mb-1 flex h-[44px] items-center gap-2 rounded-lg border border-border bg-surface-sunken px-2.5 focus-within:ring-2 focus-within:ring-ring/45">
              <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" />
              <span className="sr-only">Buscar espaço de trabalho</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar espaço"
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </label>
          ) : null}
          <ul id={listId} aria-label="Espaços de trabalho" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
            {isLoading && !workspaces ? <li className="px-2.5 py-2 text-xs text-ink-faint">Carregando espaços…</li> : null}
            {!isLoading && visible.length === 0 ? <li className="px-2.5 py-2 text-xs text-ink-faint">{query ? "Nenhum espaço encontrado com esse nome." : "Nenhum espaço de trabalho ativo."}</li> : null}
            {visible.map((workspace) => {
              const isCurrent = workspace.id === currentWorkspaceId;
              return (
                <li key={workspace.id}>
                  {isCurrent ? (
                    <button
                      type="button"
                      onClick={() => close()}
                      aria-current="true"
                      data-workspace-option={workspace.id}
                      className="flex min-h-[44px] w-full min-w-0 items-center gap-2.5 rounded-lg bg-solution/10 px-2 text-left text-sm font-semibold text-ink"
                    >
                      <WorkspaceBadge name={workspace.name} />
                      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-solution">
                        <Check aria-hidden="true" className="h-3.5 w-3.5" /> Atual
                      </span>
                    </button>
                  ) : (
                    <Link
                      href={workspaceSwitchHref(pathname, currentBase, workspace.id, areas)}
                      onClick={() => close(false)}
                      data-workspace-option={workspace.id}
                      className="flex min-h-[44px] min-w-0 items-center gap-2.5 rounded-lg px-2 text-sm text-ink transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
                    >
                      <WorkspaceBadge name={workspace.name} />
                      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border p-1.5">
            <Link
              href="/workspaces"
              onClick={() => close(false)}
              className="flex min-h-[44px] items-center rounded-lg px-2.5 text-sm font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
            >
              Gerenciar espaços de trabalho
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
