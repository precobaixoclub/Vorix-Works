"use client";

import { cn } from "@/lib/utils";

export type ConversasTab = { key: string; label: string };

/**
 * Subnav compacta do módulo Conversas — substitui o `PageSubnav` (coluna de ~224px) que hoje
 * separa Inbox/Canais de atendimento. Local a este módulo, de propósito: uma exceção documentada
 * à regra "sub-navegação = PageSubnav" (web/CLAUDE.md, regra 3), porque aqui são só 2 opções e a
 * tela precisa recuperar largura para o inbox, não organizar uma navegação profunda.
 */
export function ConversasHeader<T extends string>({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: readonly { key: T; label: string }[];
  activeTab: T;
  onTabChange: (key: T) => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 sm:px-4">
      <p className="text-sm font-semibold text-foreground">Conversas</p>
      <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            aria-current={activeTab === tab.key ? "page" : undefined}
            className={cn(
              "h-6 rounded-md px-2.5 text-xs font-medium transition-colors duration-150",
              activeTab === tab.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
