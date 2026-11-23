"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { MARKETING_BACKSTAGE_NAV, canUseBackstage } from "@/components/workspace-navigation";
import { activeGlobalArea, activeGlobalItem, buildGlobalNavigation, mobileBarAreas, type GlobalAreaKey } from "@/components/global-navigation";
import { useSolutions } from "@/features/solutions/hooks";

/**
 * Estado ÚNICO do menu global, usado pelo menu lateral (desktop) e pela barra inferior + "Menu"
 * (celular): mesmas áreas, mesmas regras de ferramenta contratada e de papel, mesma área ativa.
 * Assim os dois menus nunca divergem.
 */
export function useGlobalNavigation(workspaceId: string) {
  const pathname = usePathname();
  const { state } = useAuth();
  const base = `/workspaces/${workspaceId}`;
  const { available, isLoading } = useSolutions();
  const areas = useMemo(() => buildGlobalNavigation(available), [available]);
  const barAreas = useMemo(() => mobileBarAreas(areas), [areas]);
  const activeKey = activeGlobalArea(pathname, base, areas);
  const activeArea = areas.find((area) => area.key === activeKey);
  const activeItem = activeGlobalItem(pathname, base, activeArea);
  const canSeeBackstage = state.status === "authenticated" && canUseBackstage(state.role) && available.includes("marketing");
  const isBackstageActive = MARKETING_BACKSTAGE_NAV.some((item) => pathname.startsWith(`${base}${item.href}`));

  // Áreas com as telas abertas: a ativa sempre; as outras, quando a pessoa toca na seta (sem navegar).
  const [expanded, setExpanded] = useState<ReadonlySet<GlobalAreaKey>>(() => new Set(activeKey ? [activeKey] : []));
  useEffect(() => {
    if (activeKey) setExpanded((current) => (current.has(activeKey) ? current : new Set([...current, activeKey])));
  }, [activeKey]);
  const toggleArea = useCallback((key: GlobalAreaKey) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return { pathname, base, areas, barAreas, activeKey, activeArea, activeItem, isLoading, canSeeBackstage, isBackstageActive, expanded, toggleArea };
}
