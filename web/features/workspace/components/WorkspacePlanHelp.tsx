"use client";
import { useAuth } from "@/contexts/auth-context";
import { canManageBilling } from "@/lib/rbac";

export function WorkspacePlanHelp({ error }: { error: string }) {
  const { state } = useAuth();
  if (!/WORKSPACE_LIMIT_EXCEEDED|USAGE_LIMIT_REACHED/.test(error)) return null;
  if (!canManageBilling(state.status === "authenticated" ? state.role : undefined)) return <p className="mt-2 text-sm">Peça ao administrador para ajustar o plano ou inativar um espaço que não usa.</p>;
  return <p className="mt-2 text-sm">Inative um espaço para liberar uma vaga ou <a href="/conta/plano#quantidades-plano" target="_blank" rel="noopener noreferrer" className="text-primary underline">ajuste a quantidade contratada</a>. Depois volte e tente novamente.</p>;
}
