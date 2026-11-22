import Link from "next/link";
import { Lightbulb, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bolsão de ideias e Produção são UM lugar só: as ideias (o que postar) e a fila da IA (o que já
 * está sendo criado a partir delas). Esta barra fica no topo das duas telas.
 */
export function IdeasHubTabs({ workspaceId, active, inProduction }: { workspaceId: string; active: "ideas" | "production"; inProduction?: number }) {
  const tabs = [
    { key: "ideas" as const, href: `/workspaces/${workspaceId}/ideias`, label: "Ideias", icon: Lightbulb },
    { key: "production" as const, href: `/workspaces/${workspaceId}/production`, label: "Em produção", icon: Sparkles, count: inProduction },
  ];
  return (
    <nav aria-label="Bolsão de ideias" className="mb-6 flex gap-1 border-b border-border">
      {tabs.map(({ key, href, label, icon: Icon, count }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
            active === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
          {count ? <span className="rounded-full bg-primary/15 px-1.5 text-xs tabular-nums text-primary">{count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
