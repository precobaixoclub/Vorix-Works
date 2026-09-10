"use client";

import { usePathname, useRouter } from "next/navigation";
import { Boxes, CreditCard, PlugZap, Settings, UsersRound, Workflow } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { PageSubnav } from "@/components/PageSubnav";
import { useCurrentWorkspace } from "@/contexts/workspace-context";

const SETTINGS_SECTIONS = [
  { value: "general", label: "Geral", href: "/settings", icon: Settings },
  { value: "users", label: "Usuários", href: "/settings/users", icon: UsersRound },
  { value: "teams", label: "Equipes", href: "/settings/teams", icon: UsersRound },
  { value: "integrations", label: "Integrações", href: "/connections", icon: PlugZap },
  { value: "products", label: "Produtos", href: "/settings/products", icon: Boxes },
  { value: "automations", label: "Automações", href: "/settings/automations", icon: Workflow },
  { value: "billing", label: "Plano e cobrança", href: "/settings/plano", icon: CreditCard },
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

  function navigate(value: string) {
    const item = SETTINGS_SECTIONS.find((section) => section.value === value);
    if (!item) return;
    router.push(`/workspaces/${workspace.id}${item.href}`);
  }

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={title ?? "Configurações"}
        description={description ?? "Preferências, pessoas, integrações, automações e cobrança em um só lugar."}
        actions={actions}
      />
      <PageSubnav
        items={SETTINGS_SECTIONS.map(({ value, label, icon }) => ({ value, label, icon }))}
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
