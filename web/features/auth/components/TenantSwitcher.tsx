"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { useAuth } from "@/contexts/auth-context";
import { listMemberships } from "../api";

/**
 * Workspace/Tenant Switcher — Sprint 05 (Fase 6). Um usuário pode pertencer a mais de um Tenant
 * (ex.: freelancer atendendo duas agências); trocar de Tenant troca TUDO — a lista de Workspaces
 * visível é outra, então navegar direto para `/workspaces` depois da troca evita "misturar
 * contexto" (nunca deixa a tela atual, de um Workspace do tenant anterior, visível com dados do
 * tenant novo). Só aparece quando o usuário tem mais de uma membership — com uma só, não há o que
 * trocar.
 */
export function TenantSwitcher() {
  const { state, switchTenant } = useAuth();
  const { data: memberships } = useSWR(state.status === "authenticated" ? "auth-memberships" : null, listMemberships);
  const [switching, setSwitching] = useState(false);
  const router = useRouter();

  if (state.status !== "authenticated" || !memberships || memberships.length <= 1) return null;

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const tenantId = event.target.value;
    if (state.status !== "authenticated" || tenantId === state.tenantId) return;
    setSwitching(true);
    try {
      await switchTenant(tenantId);
      router.push("/workspaces");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <select
      value={state.tenantId}
      onChange={handleChange}
      disabled={switching}
      aria-label="Trocar de conta"
      className="max-w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink outline-none focus:border-accent sm:max-w-xs"
    >
      {memberships.map((membership) => (
        <option key={membership.tenantId} value={membership.tenantId}>
          {membership.tenantId} · {membership.role}
        </option>
      ))}
    </select>
  );
}
