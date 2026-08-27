import { forwardRef, type ReactNode, type Ref } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ListCardProps {
  /** A tabela (ou grid) da lista — vai na área rolável. */
  children: ReactNode;
  /** Rodapé fixo colado na base (tipicamente o <TablePagination>). */
  footer?: ReactNode;
  /**
   * Altura disponível calculada pelo usePagination({ auto }). Quando > 0, o card
   * assume essa altura e a paginação cola no rodapé; quando 0 (modo não-auto ou
   * primeiro frame), o card cresce com o conteúdo.
   */
  availableHeight?: number;
  className?: string;
}

/**
 * Card padrão de lista: altura adaptativa à viewport, área de conteúdo rolável e
 * rodapé (paginação) colado na base. Substitui o antigo
 * `<Card><CardContent className="p-0">…<TablePagination/></CardContent></Card>`.
 *
 * O ref deve ser o `containerRef` do usePagination({ auto: true }) — é por ele
 * que a altura é medida.
 */
export const ListCard = forwardRef(function ListCard(
  { children, footer, availableHeight, className }: ListCardProps,
  ref: Ref<HTMLDivElement>,
) {
  return (
    <Card
      ref={ref}
      style={{ height: availableHeight ? availableHeight : undefined }}
      className={cn('flex flex-col overflow-hidden', className)}
    >
      <CardContent className="p-0 flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto min-h-0">{children}</div>
        {footer}
      </CardContent>
    </Card>
  );
});
