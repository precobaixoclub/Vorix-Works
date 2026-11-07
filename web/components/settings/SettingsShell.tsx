"use client";

import { usePathname, useRouter } from "next/navigation";
import { Boxes, CreditCard, Globe, Headset, Mic, Palette, PlugZap, Scale, Settings, ShoppingBag, SlidersHorizontal, Store, Target, UsersRound, Workflow } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageSubnav } from "@/components/PageSubnav";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useActiveSolution } from "@/features/solutions/hooks";
import type { SolutionKey } from "@/lib/solutions";

// "Conta" é do Core e aparece sempre. O resto pertence a UMA solução (ou a algumas) e só aparece
// quando ela é a solução ativa: no Vorix Site não aparecem atendimento, metas ou automações do
// Conversas, e assim por diante.
const GLOBAL_GROUP = "Conta";
const SOLUTION_GROUP: Record<SolutionKey, string> = { site: "Vorix Site", conversations: "Vorix Conversas", meetings: "Vorix Meetings", marketing: "Vorix Marketing" };
type SettingsSection = { value: string; label: string; href: string; icon: typeof Settings; solutions?: readonly SolutionKey[] };
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { value: "general", label: "Geral", href: "/settings", icon: Settings },
  { value: "users", label: "Usuários", href: "/settings/users", icon: UsersRound },
  { value: "teams", label: "Equipes", href: "/settings/teams", icon: UsersRound },
  { value: "billing", label: "Plano e cobrança", href: "/settings/plano", icon: CreditCard },
  { value: "site-address", label: "Endereço e domínio", href: "/site?section=dominio", icon: Globe, solutions: ["site"] },
  { value: "site-selling", label: "Como vender pelo site", href: "/site?section=loja", icon: ShoppingBag, solutions: ["site"] },
  { value: "site-products", label: "Produtos", href: "/site/products", icon: Boxes, solutions: ["site"] },
  { value: "integrations", label: "Integrações", href: "/connections", icon: PlugZap, solutions: ["conversations", "marketing"] },
  { value: "attendance", label: "Atendimento", href: "/settings/attendance", icon: Headset, solutions: ["conversations"] },
  { value: "products", label: "Produtos", href: "/products", icon: Boxes, solutions: ["conversations"] },
  { value: "commercial", label: "Regras comerciais", href: "/settings/commercial", icon: Scale, solutions: ["conversations"] },
  { value: "goals", label: "Metas", href: "/settings/goals", icon: Target, solutions: ["conversations"] },
  { value: "automations", label: "Automações", href: "/settings/automations", icon: Workflow, solutions: ["conversations"] },
  { value: "marketplaces", label: "Marketplaces", href: "/settings/marketplaces", icon: Store, solutions: ["site", "conversations"] },
  { value: "meetings-preferences", label: "Preferências", href: "/meetings/settings", icon: SlidersHorizontal, solutions: ["meetings"] },
  { value: "meetings-integrations", label: "Agendas conectadas", href: "/meetings/integrations", icon: PlugZap, solutions: ["meetings"] },
  { value: "meetings-recorder", label: "Contas de gravação", href: "/meetings/recorder-accounts", icon: Mic, solutions: ["meetings"] },
  { value: "brand", label: "Marca", href: "/knowledge", icon: Palette, solutions: ["marketing"] },
];

/** Seções visíveis: a Conta sempre; as de solução só para a solução ativa (e contratada). */
export function settingsSectionsFor(active: SolutionKey | undefined, available: readonly SolutionKey[]) {
  return SETTINGS_SECTIONS.filter(({ solutions }) => !solutions || (active !== undefined && solutions.includes(active) && available.includes(active)))
    .map((section) => ({ ...section, group: section.solutions ? SOLUTION_GROUP[active!] : GLOBAL_GROUP }));
}

export function SettingsShell({
  active,
  title,
  description,
  actions,
  children,
}: {
  active: string;
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const workspace = useCurrentWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const { active: activeSolution, available, isLoading: solutionsLoading, settled } = useActiveSolution(pathname, `/workspaces/${workspace.id}`);
  // Enquanto não se sabe a solução ativa, só a Conta aparece (nada de mostrar as opções de outra solução por um instante).
  const sections = settingsSectionsFor(solutionsLoading || !settled ? undefined : activeSolution, available);

  function navigate(value: string) {
    const item = sections.find((section) => section.value === value);
    if (!item) return;
    router.push(`/workspaces/${workspace.id}${item.href}`);
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={title ?? "Configurações"}
        description={description ?? "Conta, pessoas, integrações e cobrança — e as preferências de cada solução."}
        actions={actions}
      />
      <PageSubnav
        items={sections.map(({ value, label, icon, group }) => ({ value, label, icon, group }))}
        value={activeFromPath(pathname) ?? active}
        onValueChange={navigate}
      >
        {children}
      </PageSubnav>
    </main>
  );
}

function activeFromPath(pathname: string): string | undefined {
  if (pathname.endsWith("/settings/users")) return "users";
  if (pathname.endsWith("/settings/teams")) return "teams";
  if (pathname.endsWith("/connections")) return "integrations";
  if (pathname.endsWith("/settings/products")) return "products";
  if (pathname.endsWith("/settings/automations")) return "automations";
  if (pathname.endsWith("/settings/commercial")) return "commercial";
  if (pathname.endsWith("/settings/goals")) return "goals";
  if (pathname.endsWith("/settings/attendance")) return "attendance";
  if (pathname.endsWith("/settings/plano")) return "billing";
  if (pathname.endsWith("/settings/marketplaces")) return "marketplaces";
  if (pathname.endsWith("/settings")) return "general";
  return undefined;
}
