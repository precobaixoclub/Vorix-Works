"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Spinner } from "./Spinner";

/**
 * Proteção de rotas no cliente (Sprint 05, Fase 5) — segunda camada, depois de `proxy.ts` (que já
 * bloqueia no servidor quem não tem o cookie do refresh token). Esta camada cobre o caso em que o
 * cookie existe mas o refresh silencioso falha (token revogado/expirado além do prazo) — só se
 * descobre isso depois de uma chamada assíncrona, daí o estado "loading" precisar de UI própria
 * em vez de decidir sincronamente.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "unauthenticated") router.replace("/login");
  }, [state.status, router]);

  if (state.status !== "authenticated") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-5 w-5 text-ink-muted" />
      </div>
    );
  }

  return <>{children}</>;
}
