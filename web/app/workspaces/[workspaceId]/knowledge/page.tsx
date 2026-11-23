"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";

/**
 * Rota antiga de "Marca" (Fase 5 da Reorganização de UX): a tela agora é Configurações › Marca e
 * identidade (`/settings/marca`), com as mesmas abas. Encaminha preservando a aba (`?tab=`) e com
 * `replace`, para o Voltar não ficar preso aqui.
 */
export default function KnowledgeRedirectPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[420px] w-full rounded-xl" />}>
      <Redirect />
    </Suspense>
  );
}

function Redirect() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const query = params.toString();
    router.replace(`/workspaces/${workspace.id}/settings/marca${query ? `?${query}` : ""}`);
  }, [router, params, workspace.id]);
  return <Skeleton className="h-[420px] w-full rounded-xl" />;
}
