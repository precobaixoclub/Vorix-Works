"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Spinner } from "./Spinner";

/**
 * Segunda linha de defesa do painel `/admin` — a primeira é o backend (`requirePlatformAdmin`
 * devolve 403 se o JWT não tiver a flag). Este guard evita renderizar o painel para usuários
 * comuns e redireciona para `/workspaces`. Quando `state.status === "loading"` mostra o spinner
 * padrão (mesmo tratamento que o `RequireAuth` — o refresh silencioso pode demorar um tick).
 */
export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "unauthenticated") router.replace("/login");
    else if (state.status === "authenticated" && !state.user.isPlatformAdmin) router.replace("/workspaces");
  }, [state, router]);

  if (state.status !== "authenticated") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-5 w-5 text-ink-muted" />
      </div>
    );
  }

  if (!state.user.isPlatformAdmin) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-5 w-5 text-ink-muted" />
      </div>
    );
  }

  return <>{children}</>;
}
