"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentWorkspace } from "@/contexts/workspace-context";

/**
 * Rota antiga do "Calendário de publicações" (Fase 5 da Reorganização de UX). Tudo o que ela fazia
 * — mês/lista, estado por rede e as ações do post (aprovar, publicar agora, tentar de novo,
 * reagendar, cancelar, resolver resultado incerto) — vive no Calendário único, com o MESMO detalhe
 * (`PostDetail`). Encaminha preservando `?post=` (links do Início, do compositor e de notificações)
 * com `replace`, para o Voltar não cair aqui de novo.
 */
export default function SocialCalendarRedirectPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[520px] w-full rounded-xl" />}>
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
    router.replace(`/workspaces/${workspace.id}/calendar${query ? `?${query}` : ""}`);
  }, [router, params, workspace.id]);
  return <Skeleton className="h-[520px] w-full rounded-xl" />;
}
