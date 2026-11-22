"use client";

import { useSearchParams } from "next/navigation";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { EditorialIdeasBoard } from "@/features/editorial-ideas/EditorialIdeasBoard";

/** Bolsão de ideias do workspace — o único lugar das ideias de post (`?nova=1` abre o cadastro). */
export default function IdeasPage() {
  const workspace = useCurrentWorkspace();
  const searchParams = useSearchParams();
  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <EditorialIdeasBoard workspaceId={workspace.id} openNew={searchParams.get("nova") === "1"} />
    </main>
  );
}
