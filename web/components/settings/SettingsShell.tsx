"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Boxes, CalendarDays, MessageSquareText, CreditCard, Globe, Headset, Mic, Palette, PlugZap, Scale, Settings, Share2, ShoppingBag, SlidersHorizontal, Store, Target, UserRound, UsersRound, Workflow, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useCurrentWorkspace } from "@/contexts/workspace-context";
import { useSolutions } from "@/features/solutions/hooks";
import { SETTINGS_CATEGORIES, SETTINGS_SECTIONS, settingsSectionFromPath, settingsSectionsFor, type SettingsSectionKey } from "@/features/settings/sections";
import { cn } from "@/lib/utils";

export { SETTINGS_SECTIONS, settingsSectionsFor };

const ICONS: Record<SettingsSectionKey, LucideIcon> = {
  profile: UserRound, general: Settings, users: UsersRound, teams: UsersRound, brand: Palette, approvals: MessageSquareText,
  attendance: Headset, channels: PlugZap, "service-rules": SlidersHorizontal, products: Boxes, commercial: Scale, goals: Target, automations: Workflow,
  "site-address": Globe, "site-selling": ShoppingBag, "site-products": Boxes, marketplaces: Store,
  "meetings-preferences": SlidersHorizontal, "meetings-recorder": Mic,
  "integrations-hub": PlugZap, integrations: PlugZap, social: Share2, "meetings-integrations": CalendarDays,
  billing: CreditCard,
};

/**
 * Configurações (Fase 10): uma navegação só, em categorias — Minha conta, Espaço de trabalho, opções
 * de cada ferramenta contratada, Integrações e Conta e assinatura. No desktop, a lista lateral com os
 * títulos das categorias; no celular, um seletor agrupado (nada de faixa com 20 botões).
 */
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
  const base = `/workspaces/${workspace.id}`;
  const { available, isLoading } = useSolutions();
  const ready = !isLoading;
  const sections = settingsSectionsFor(ready ? available : undefined);
  const current = settingsSectionFromPath(pathname, base) ?? (active as SettingsSectionKey);
  const selected = SETTINGS_SECTIONS.find((section) => section.value === current);
  // Tela de uma ferramenta que a conta não contratou: volta para as Configurações gerais.
  const allowed = !selected?.solutions || (ready && sections.some((section) => section.value === selected.value));
  useEffect(() => {
    if (ready && !allowed) router.replace(`${base}/settings`);
  }, [ready, allowed, router, base]);

  const navigate = (value: string) => {
    const item = sections.find((section) => section.value === value);
    if (item) router.push(`${base}${item.href}`);
  };
  const categories = SETTINGS_CATEGORIES.filter((category) => sections.some((section) => section.category === category));
  const currentVisible = sections.some((section) => section.value === current);

  return (
    <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
      <PageHeader
        title={title ?? "Configurações"}
        description={description ?? "Sua conta, a empresa, as ferramentas contratadas, as integrações e a assinatura."}
        actions={actions}
      />
      <div className="flex flex-col gap-6 md:flex-row">
        <div className="md:hidden">
          <label htmlFor="settings-section" className="mb-1 block text-xs font-medium text-muted-foreground">Seção das configurações</label>
          <select
            id="settings-section"
            value={currentVisible ? current : ""}
            onChange={(event) => navigate(event.target.value)}
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          >
            {currentVisible ? null : <option value="">Escolha uma seção</option>}
            {categories.map((category) => (
              <optgroup key={category} label={category}>
                {sections.filter((section) => section.category === category).map((section) => <option key={section.value} value={section.value}>{section.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <nav aria-label="Navegação da seção" className="hidden md:flex md:w-60 md:shrink-0 md:flex-col" data-testid="settings-nav">
          {categories.map((category, index) => (
            <div key={category} data-category={category}>
              <p className={cn("px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", index > 0 && "pt-4")}>{category}</p>
              {sections.filter((section) => section.category === category).map((section) => {
                const Icon = ICONS[section.value];
                const isActive = section.value === current;
                return (
                  <button
                    key={section.value}
                    type="button"
                    onClick={() => navigate(section.value)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors", isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {section.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          {allowed ? children : <p role="status" className="text-sm text-muted-foreground">Esta configuração não faz parte das ferramentas contratadas. Abrindo as configurações gerais...</p>}
        </div>
      </div>
    </main>
  );
}
