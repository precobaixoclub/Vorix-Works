"use client";

import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { EditorialIdeasBoard } from "@/features/editorial-ideas/EditorialIdeasBoard";

/** Bolsão de ideias do workspace (menu Marketing → Conteúdo → Bolsão de ideias). */
export default function IdeasPage() {
  const workspace = useCurrentWorkspace();
  return (
    <main className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
      <EditorialIdeasBoard workspaceId={workspace.id} />
    </main>
  );
}
