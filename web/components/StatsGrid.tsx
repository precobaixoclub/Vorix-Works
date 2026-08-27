import React from 'react';
import { cn } from '@/lib/utils';

interface StatsGridProps {
  /** Cards de KPI (normalmente <Card>...). O grid distribui-os igualmente na largura. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Grid padrão para cards de KPI/stats no topo de páginas de listagem.
 *
 * Distribui N cards ocupando 100% da largura disponível, sem buracos —
 * empilha no mobile e escolhe a contagem de colunas conforme o número de
 * cards (1, 2, 3, 4 ou mais). Substitui os grids fixos `lg:grid-cols-4`
 * que deixavam espaço vazio quando havia 3 (ou outra contagem) de cards.
 */
export function StatsGrid({ children, className }: StatsGridProps) {
  const count = React.Children.toArray(children).filter(Boolean).length;

  // Colunas por breakpoint escolhidas para preencher a largura sem sobra.
  const columnsClass =
    count <= 1
      ? 'grid-cols-1'
      : count === 2
        ? 'grid-cols-1 sm:grid-cols-2'
        : count === 3
          ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
          : count === 4
            ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
            : count === 5
              ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
              : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6';

  return <div className={cn('grid gap-4', columnsClass, className)}>{children}</div>;
}
