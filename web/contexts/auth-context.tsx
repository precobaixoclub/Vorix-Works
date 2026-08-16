"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { switchTenant as apiSwitchTenant, getMe } from "@/features/auth/api";
import type { AuthUser, TenantRole } from "@/features/auth/types";
import { apiLogin, apiLogout, apiRefresh, apiSignup, type SignupInput } from "@/lib/auth-api";
import { setAccessToken } from "@/lib/auth-token";

/**
 * Estado autenticado — Sprint 05 (Fase 5). "loading" é o estado inicial em TODA carga de página
 * (o access token nunca sobrevive a um reload, de propósito — ver `lib/auth-token.ts`): o
 * provider tenta um refresh silencioso contra o cookie HttpOnly antes de decidir entre
 * "authenticated"/"unauthenticated". "Proteção de rotas" (`components/RequireAuth.tsx`) trata
 * "loading" como "ainda não sei, não redirecione ainda".
 */
export type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; user: AuthUser; tenantId: string; role: TenantRole };

type AuthContextValue = {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Renova o access token 60s antes de expirar — "renovação automática" nunca reativa a um 401. */
const PROACTIVE_REFRESH_MARGIN_SECONDS = 60;
const MIN_REFRESH_DELAY_MS = 5_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleProactiveRefresh = useCallback((expiresIn: number) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const delayMs = Math.max(MIN_REFRESH_DELAY_MS, (expiresIn - PROACTIVE_REFRESH_MARGIN_SECONDS) * 1000);
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const result = await apiRefresh();
        setAccessToken(result.accessToken);
        setState((prev) => (prev.status === "authenticated" ? { ...prev, tenantId: result.tenantId, role: result.role } : prev));
        scheduleProactiveRefresh(result.expiresIn);
      } catch {
        setAccessToken(undefined);
        setState({ status: "unauthenticated" });
      }
    }, delayMs);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const refreshed = await apiRefresh();
        setAccessToken(refreshed.accessToken);
        const me = await getMe();
        if (cancelled) return;
        setState({ status: "authenticated", user: me.user, tenantId: me.tenantId, role: me.role });
        scheduleProactiveRefresh(refreshed.expiresIn);
      } catch {
        if (!cancelled) {
          setAccessToken(undefined);
          setState({ status: "unauthenticated" });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await apiLogin(email, password);
      setAccessToken(result.accessToken);
      setState({ status: "authenticated", user: result.user, tenantId: result.tenantId, role: result.role });
      scheduleProactiveRefresh(result.expiresIn);
    },
    [scheduleProactiveRefresh],
  );

  const signup = useCallback(
    async (input: SignupInput) => {
      const result = await apiSignup(input);
      setAccessToken(result.accessToken);
      setState({ status: "authenticated", user: result.user, tenantId: result.tenantId, role: result.role });
      scheduleProactiveRefresh(result.expiresIn);
    },
    [scheduleProactiveRefresh],
  );

  const logout = useCallback(async () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    setAccessToken(undefined);
    setState({ status: "unauthenticated" });
    await apiLogout();
  }, []);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      const result = await apiSwitchTenant(tenantId);
      setAccessToken(result.accessToken);
      setState((prev) => (prev.status === "authenticated" ? { ...prev, tenantId: result.tenantId, role: result.role } : prev));
      scheduleProactiveRefresh(result.expiresIn);
    },
    [scheduleProactiveRefresh],
  );

  const value = useMemo<AuthContextValue>(() => ({ state, login, signup, logout, switchTenant }), [state, login, signup, logout, switchTenant]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth() chamado fora de um AuthProvider.");
  return context;
}
