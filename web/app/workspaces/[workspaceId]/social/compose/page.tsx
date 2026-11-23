"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { composeRedirectHref } from "@/features/marketing/create-routes";

/**
 * Rota antiga de "Criar publicação" (Fase 4 da Reorganização de UX). O compositor agora vive em
 * "Criar conteúdo › Publicar conteúdo pronto" — é o MESMO componente (`SocialComposer`), então o
 * encaminhamento é seguro. Mantém todos os parâmetros (mídia, legenda e origem vindos da Revisão) e
 * usa `replace`: o Voltar do navegador não cai de novo nesta rota.
 */
export default function SocialComposeRedirectPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[480px] w-full rounded-xl" />}>
      <Redirect />
    </Suspense>
  );
}

function Redirect() {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    router.replace(composeRedirectHref(workspace.id, params.toString()));
  }, [router, params, workspace.id]);
  return <Skeleton className="h-[480px] w-full rounded-xl" />;
}
