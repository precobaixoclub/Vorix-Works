import { Fragment } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PageSubnavItem {
  /** Identificador da seção — casa com o `value` controlado. */
  value: string;
  /** Rótulo exibido no item de navegação. */
  label: string;
  /** Ícone opcional (Lucide) exibido à esquerda do rótulo. */
  icon?: LucideIcon;
  /** Grupo opcional: itens consecutivos do mesmo grupo ficam sob um título (só no desktop). */
  group?: string;
}

interface PageSubnavProps {
  /** Seções disponíveis na navegação lateral. */
  items: PageSubnavItem[];
  /** Value da seção ativa. */
  value: string;
  /** Chamado ao selecionar outra seção. */
  onValueChange: (value: string) => void;
  /** Conteúdo da seção ativa (renderizado à direita). */
  children: React.ReactNode;
  /** Classes extras do container raiz. */
  className?: string;
}

/**
 * Sidebar interno de página — padrão único deste design system para submenus dentro de
 * uma página. Substitui `<Tabs>` sempre que uma tela tem seções de navegação.
 *
 * Desktop: coluna de navegação à esquerda + área de conteúdo à direita.
 * Mobile: faixa horizontal com scroll no topo + conteúdo abaixo.
 */
export function PageSubnav({ items, value, onValueChange, children, className }: PageSubnavProps) {
  return (
    <div className={cn('flex flex-col gap-6 md:flex-row', className)}>
      <nav
        className="flex w-full flex-row gap-1 overflow-x-auto md:w-56 md:shrink-0 md:flex-col md:overflow-visible"
        aria-label="Navegação da seção"
      >
        {items.map((item, index) => {
          const Icon = item.icon;
          const isActive = item.value === value;
          const startsGroup = item.group !== undefined && item.group !== items[index - 1]?.group;
          return (
            <Fragment key={item.value}>
              {startsGroup ? (
                <p className={cn('hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:block', index > 0 && 'md:pt-3')}>
                  {item.group}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => onValueChange(item.value)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors md:w-full',
                  isActive
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                )}
              >
                {Icon && <Icon className="w-4 h-4 shrink-0" />}
                {item.label}
              </button>
            </Fragment>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
