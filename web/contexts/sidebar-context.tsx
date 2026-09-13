"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./auth-context";

type SidebarContextValue = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

const STORAGE_KEY_PREFIX = "vorix:sidebar-collapsed";

function readStoredPreference(userId: string | undefined): boolean | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}:${userId ?? "anon"}`);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return undefined;
  } catch {
    return undefined;
  }
}

function writeStoredPreference(userId: string | undefined, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}:${userId ?? "anon"}`, String(value));
  } catch {
    // localStorage indisponível (modo privado) — ignora, a preferência só não sobrevive ao reload.
  }
}

/**
 * Preferência de colapso da sidebar global (`WorkspaceSidebar`) — persistida por usuário.
 * Enquanto o usuário nunca alternou manualmente (`explicitPreference` ausente), o padrão é
 * contextual por rota: recolhida em /conversas (tela de alta densidade, precisa da largura),
 * expandida nas demais. A partir do primeiro toggle manual em qualquer lugar, a escolha vale
 * globalmente em qualquer rota até o usuário alternar de novo.
 */
export function SidebarProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const userId = state.status === "authenticated" ? state.user.id : undefined;
  const pathname = usePathname();
  const [explicitPreference, setExplicitPreference] = useState<boolean | undefined>(() => readStoredPreference(userId));

  useEffect(() => {
    setExplicitPreference(readStoredPreference(userId));
  }, [userId]);

  const isConversasRoute = /\/conversas(\/|$)/.test(pathname ?? "");
  const collapsed = explicitPreference ?? isConversasRoute;

  function setCollapsed(value: boolean) {
    setExplicitPreference(value);
    writeStoredPreference(userId, value);
  }

  const value = useMemo<SidebarContextValue>(
    () => ({ collapsed, toggle: () => setCollapsed(!collapsed), setCollapsed }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collapsed],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebarState(): SidebarContextValue {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebarState() chamado fora de um SidebarProvider.");
  return context;
}
