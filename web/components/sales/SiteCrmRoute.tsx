"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/Spinner";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useSolutions } from "@/features/solutions/hooks";

/**
 * Rotas `/site/oportunidades`, `/site/propostas` e `/site/products` (Fase 7). Elas sempre mostraram
 * as MESMAS telas do CRM (mesmas entidades); a rota só dava o contexto do Site. Numa conta que tem
 * Conversas, a tela de Vendas é a do CRM — então a rota do Site encaminha para ela (preservando
 * `?dealId=`, `?proposal=` e o resto), em vez de existirem duas cópias em paralelo. Numa conta só
 * com Site, continua mostrando a tela como sempre (as rotas do CRM são do Conversas e ficam
 * bloqueadas lá).
 */
export function SiteCrmRoute({ crmPath, children }: { crmPath: "/deals" | "/proposals" | "/products"; children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Inner crmPath={crmPath}>{children}</Inner>
    </Suspense>
  );
}

function Inner({ crmPath, children }: { crmPath: string; children: ReactNode }) {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const { available, isLoading } = useSolutions();
  const hasCrm = available.includes("conversations");
  useEffect(() => {
    if (isLoading || !hasCrm) return;
    const query = params.toString();
    router.replace(`/workspaces/${workspace.id}${crmPath}${query ? `?${query}` : ""}`);
  }, [crmPath, hasCrm, isLoading, params, router, workspace.id]);
  if (isLoading || hasCrm) return <div className="flex min-h-[40dvh] items-center justify-center"><Spinner className="h-5 w-5 text-muted-foreground" /></div>;
  return <>{children}</>;
}
