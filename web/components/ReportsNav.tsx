import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Menu lateral dos relatórios: como o `<PageSubnav>`, mas com o que os
 * relatórios exigem e ele não tem — itens AGRUPADOS por seção e contagem por
 * relatório. O número ao lado é a informação mais útil do menu: mostra onde
 * está o problema antes de abrir a lista.
 */

export interface ReportNavItem {
  value: string;
  label: string;
  icon?: LucideIcon;
  /** Volume atual. `undefined` enquanto carrega; 0 aparece esmaecido. */
  count?: number;
  /** Destaca o número quando o volume em si já é o alerta. */
  tone?: 'default' | 'critical' | 'warning';
}

export interface ReportNavGroup {
  label: string;
  items: ReportNavItem[];
}

interface ReportsNavProps {
  groups: ReportNavGroup[];
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}

const numero = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

export function ReportsNav({ groups, value, onValueChange, children }: ReportsNavProps) {
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav className="w-full md:w-64 md:shrink-0" aria-label="Relatórios">
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.value === value;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => onValueChange(item.value)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                        isActive
                          ? 'bg-muted font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                    >
                      {Icon && <Icon className="w-4 h-4 shrink-0" />}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.count !== undefined && (
                        <span
                          className={cn(
                            'shrink-0 text-xs tabular-nums',
                            item.count === 0
                              ? 'text-muted-foreground/50'
                              : item.tone === 'critical'
                                ? 'font-medium text-destructive'
                                : item.tone === 'warning'
                                  ? 'font-medium text-amber-600 dark:text-amber-400'
                                  : 'text-muted-foreground',
                          )}
                        >
                          {numero(item.count)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
