"use client";

import useSWR from "swr";
import { useAuth } from "@/contexts/auth-context";
import { getMe, type MyAccess } from "./api";

/**
 * Acesso EFETIVO de quem está logado (perfil + exceções + equipes), vindo de `/auth/me`. A UI usa
 * para esconder o que não cabe; quem decide de verdade é sempre o backend. Enquanto carrega,
 * `can()` responde `false` (nunca mostra uma ação que talvez não exista).
 */
export function useMyAccess() {
  const { state } = useAuth();
  const key = state.status === "authenticated" ? ["my-access", state.user.id, state.tenantId, state.role] : null;
  const { data, ...rest } = useSWR(key, async (): Promise<MyAccess> => {
    const me = await getMe();
    return { permissions: me.permissions ?? [], isAccountOwner: me.isAccountOwner ?? false, teams: me.teams ?? [] };
  }, { revalidateOnFocus: true, dedupingInterval: 15_000 });
  const permissions = new Set(data?.permissions ?? []);
  return {
    ...rest,
    access: data,
    can: (permission: string) => permissions.has(permission),
    managedTeamIds: (data?.teams ?? []).filter((team) => team.isManager).map((team) => team.teamId),
    memberTeamIds: (data?.teams ?? []).map((team) => team.teamId),
  };
}
