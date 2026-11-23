"use client";

import type { LucideIcon } from "lucide-react";
import { SITE_EDITOR_GROUPS, SITE_EDITOR_GROUP_LABELS as GROUP_LABEL, groupOfSection, type SiteEditorGroup } from "@/features/sites/editor-groups";
import { cn } from "@/lib/utils";

/**
 * Navegação do editor em dois níveis (Fase 8): primeiro o grupo (o que a pessoa quer fazer), depois
 * as seções daquele grupo. As seções continuam as mesmas e o `?section=` continua valendo — tocar
 * num grupo abre a primeira seção dele.
 */
export function SiteEditorNav({ items, value, onValueChange }: {
  items: readonly { value: string; label: string; group: SiteEditorGroup; icon?: LucideIcon }[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const activeGroup = groupOfSection(value) ?? "MODELO";
  const groups = SITE_EDITOR_GROUPS.filter((group) => items.some((item) => item.group === group));
  const inGroup = items.filter((item) => item.group === activeGroup);
  return (
    <div className="space-y-2" data-testid="site-editor-nav">
      <nav aria-label="Grupos do editor" className="flex w-full gap-1 overflow-x-auto rounded-xl border border-border/60 bg-card p-1 [scrollbar-width:none]">
        {groups.map((group) => {
          const active = group === activeGroup;
          return (
            <button
              key={group}
              type="button"
              aria-current={active ? "true" : undefined}
              data-group={group}
              onClick={() => { if (!active) onValueChange(items.find((item) => item.group === group)!.value); }}
              className={cn(
                "min-h-[40px] shrink-0 whitespace-nowrap rounded-lg px-3 text-sm transition-colors",
                active ? "bg-primary text-primary-foreground font-medium shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {GROUP_LABEL[group]}
            </button>
          );
        })}
      </nav>
      {inGroup.length > 1 ? (
        <nav aria-label="Navegação da seção" className="flex w-full gap-1 overflow-x-auto [scrollbar-width:none] md:flex-wrap md:overflow-visible">
          {inGroup.map((item) => {
            const Icon = item.icon;
            const active = item.value === value;
            return (
              <button
                key={item.value}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onValueChange(item.value)}
                className={cn(
                  "flex min-h-[36px] shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm transition-colors",
                  active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {Icon ? <Icon aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
                {item.label}
              </button>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
