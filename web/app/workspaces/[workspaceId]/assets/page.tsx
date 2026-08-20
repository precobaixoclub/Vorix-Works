"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";

/**
 * Migração "Marca & Materiais" — Materiais deixou de ser uma tela própria e passou a ser uma aba
 * dentro da central "Marca" (`/knowledge`). Esta rota continua existindo só para não quebrar
 * links/favoritos antigos — redireciona imediatamente para a aba equivalente.
 */
export default function AssetsRedirectPage() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/workspaces/${workspace.id}/knowledge?tab=materials`);
  }, [router, workspace.id]);

  return (
    <main className="flex items-center justify-center gap-2 py-20 text-sm text-ink-muted">
      <Spinner className="h-4 w-4" /> Redirecionando para Marca…
    </main>
  );
}
