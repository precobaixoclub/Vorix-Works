import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { SortState } from '@/lib/sort';

interface SortableHeadProps<K extends string> {
  columnKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  children: React.ReactNode;
  /** Alinhamento do conteúdo — 'right' para colunas numéricas. */
  align?: 'left' | 'right';
  className?: string;
}

/** Cabeçalho de tabela clicável que ordena pela coluna. Padrão único do app. */
export function SortableHead<K extends string>({
  columnKey,
  sort,
  onSort,
  children,
  align = 'left',
  className,
}: SortableHeadProps<K>) {
  const active = sort.key === columnKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;

  return (
    <TableHead className={cn(align === 'right' && 'text-right', 'p-0', className)}>
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={cn(
          'flex h-full w-full items-center gap-1 px-4 py-3 select-none transition-colors hover:text-foreground',
          align === 'right' ? 'justify-end' : 'justify-start',
          active ? 'text-foreground font-medium' : 'text-muted-foreground',
        )}
      >
        <span>{children}</span>
        <Icon className={cn('w-3.5 h-3.5 shrink-0', !active && 'opacity-50')} />
      </button>
    </TableHead>
  );
}
