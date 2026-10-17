"use client";

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/Spinner";

/**
 * O catálogo saiu de Configurações e virou o menu Produtos (vitrine) do Conversas. Este endereço
 * continua funcionando (links antigos, notificação de estoque baixo) e leva para lá.
 */
export default function ProductsSettingsRedirect() {
  const router = useRouter();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const searchParams = useSearchParams();
  useEffect(() => {
    const filter = searchParams.get("lowStock") === "1" ? "?filtro=repor" : "";
    router.replace(`/workspaces/${workspaceId}/products${filter}`);
  }, [router, searchParams, workspaceId]);
  return <div className="flex justify-center py-16"><Spinner /></div>;
}
