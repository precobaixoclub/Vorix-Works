"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWorkspaces } from "@/features/workspace/hooks";

/**
 * Redesign "SaaS moderno + IA-first" — substitui o link "← Espaços" (que antes ocupava uma linha
 * fixa no topo da sidebar em qualquer largura de tela) por um dropdown real na topbar. Mesmo
 * `useWorkspaces()` já usado pela página `/workspaces` — nenhuma consulta nova.
 */
export function WorkspaceSwitcher({ currentWorkspaceId, currentWorkspaceName }: { currentWorkspaceId: string; currentWorkspaceName: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { data: workspaces } = useWorkspaces("active");

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const others = (workspaces ?? []).filter((workspace) => workspace.id !== currentWorkspaceId);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-h-9 max-w-56 items-center gap-2 rounded-md border border-border bg-surface-sunken px-2.5 py-1.5 text-sm font-semibold text-ink hover:bg-surface"
      >
        <span className="truncate">{currentWorkspaceName}</span>
        <span aria-hidden="true" className={`shrink-0 text-[10px] text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open ? (
        <div role="menu" className="absolute left-0 top-full z-40 mt-1.5 w-64 rounded-lg border border-border bg-surface-raised p-1.5 shadow-xl">
          {others.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-ink-faint">Nenhum outro espaço de trabalho.</p>
          ) : (
            others.map((workspace) => (
              <Link
                key={workspace.id}
                href={`/workspaces/${workspace.id}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block truncate rounded-md px-2.5 py-2 text-sm text-ink hover:bg-surface-sunken"
              >
                {workspace.name}
              </Link>
            ))
          )}
          <div className="my-1 border-t border-border" />
          <Link
            href="/workspaces"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-md px-2.5 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            Ver todos os espaços
          </Link>
        </div>
      ) : null}
    </div>
  );
}
