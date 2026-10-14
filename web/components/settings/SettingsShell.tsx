"use client";

import { usePathname, useRouter } from "next/navigation";
import { Boxes, CreditCard, Palette, PlugZap, Settings, UsersRound, Workflow } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageSubnav } from "@/components/PageSubnav";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useSolutions } from "@/features/solutions/hooks";
import type { SolutionKey } from "@/lib/solutions";

// Três escopos, nunca misturados: "Conta" é do Core (vale para qualquer solução); cada solução
// tem o próprio grupo, que só aparece para quem tem a solução.
const GLOBAL_GROUP = "Conta";
const SETTINGS_SECTIONS: ReadonlyArray<{ value: string; label: string; href: string; icon: typeof Settings; group: string; solution?: SolutionKey }> = [
  { value: "general", label: "Geral", href: "/settings", icon: Settings, group: GLOBAL_GROUP },
  { value: "users", label: "Usuários", href: "/settings/users", icon: UsersRound, group: GLOBAL_GROUP },
  { value: "teams", label: "Equipes", href: "/settings/teams", icon: UsersRound, group: GLOBAL_GROUP },
  { value: "integrations", label: "Integrações", href: "/connections", icon: PlugZap, group: GLOBAL_GROUP },
  { value: "billing", label: "Plano e cobrança", href: "/settings/plano", icon: CreditCard, group: GLOBAL_GROUP },
  { value: "products", label: "Produtos", href: "/settings/products", icon: Boxes, group: "Vorix Conversas", solution: "conversations" },
  { value: "automations", label: "Automações", href: "/settings/automations", icon: Workflow, group: "Vorix Conversas", solution: "conversations" },
  { value: "brand", label: "Marca", href: "/knowledge", icon: Palette, group: "Vorix Marketing", solution: "marketing" },
];

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
  const { available, isLoading: solutionsLoading } = useSolutions();
  // Enquanto as soluções carregam, o grupo do Conversas (solução padrão) já aparece; o do Marketing não.
  const sections = SETTINGS_SECTIONS.filter((section) => !section.solution || available.includes(section.solution) || (solutionsLoading && section.solution === "conversations"));

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
  if (pathname.endsWith("/settings/plano")) return "billing";
  if (pathname.endsWith("/settings")) return "general";
  return undefined;
}
