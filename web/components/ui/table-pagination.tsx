import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAutoPageSize } from '@/hooks/useAutoPageSize';

interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function TablePagination({ currentPage, totalPages, totalItems, pageSize, onPageChange }: TablePaginationProps) {
  // Sem itens suficientes para uma 2ª página: mostra só o resumo (o rodapé
  // continua ocupando a base, mantendo a paginação colada quando há navegação).
  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <div
      data-pagination
      className="shrink-0 flex items-center justify-between px-4 py-3 border-t"
    >
      <p className="text-sm text-muted-foreground">
        Mostrando {start}-{end} de {totalItems}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
            .reduce<(number | string)[]>((acc, p, i, arr) => {
              if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
              acc.push(p);
              return acc;
            }, [])
            .map((item, i) =>
              typeof item === 'string' ? (
                <span key={`dots-${i}`} className="px-2 text-muted-foreground text-sm">…</span>
              ) : (
                <Button
                  key={item}
                  variant={item === currentPage ? 'default' : 'outline'}
                  size="sm"
                  className="min-w-[32px]"
                  onClick={() => onPageChange(item)}
                >
                  {item}
                </Button>
              )
            )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

interface UsePaginationAutoOptions {
  /** Liga a paginação adaptativa: nº de itens = o que couber na altura. */
  auto: true;
  /** Seletor de UMA linha (para medir a altura real). Padrão: 'tbody tr'. */
  rowSelector?: string;
  /** Fallback de altura de linha antes de existir uma para medir. */
  fallbackRowHeight?: number;
  /** Piso de itens por página (telas baixas ainda mostram algo). */
  min?: number;
  /** Teto de itens por página. */
  max?: number;
}

// Seletores de "cromo" (thead + rodapé de paginação) descontados da altura.
const LIST_CHROME_SELECTORS = ['thead', '[data-pagination]'];

/**
 * Paginação client-side. Duas formas:
 *
 *   usePagination(items, 10)            // page size fixo (compat legada)
 *   usePagination(items, { auto: true })// page size adaptativo à altura
 *
 * No modo auto, retorna `containerRef` (ancore no ListCard) e `availableHeight`
 * (a altura a fixar no card) além do resto. O nº de itens por página passa a ser
 * o que couber na viewport, recalculado ao vivo no resize.
 */
export function usePagination<T>(
  items: T[],
  pageSizeOrOptions: number | UsePaginationAutoOptions = 10,
) {
  const isAuto = typeof pageSizeOrOptions === 'object' && pageSizeOrOptions.auto;
  const fixedPageSize = typeof pageSizeOrOptions === 'number' ? pageSizeOrOptions : 10;

  const auto = useAutoPageSize<HTMLDivElement>({
    rowSelector: isAuto ? (pageSizeOrOptions.rowSelector ?? 'tbody tr') : 'tbody tr',
    chromeSelectors: LIST_CHROME_SELECTORS,
    fallbackRowHeight: isAuto ? (pageSizeOrOptions.fallbackRowHeight ?? 52) : 52,
    min: isAuto ? (pageSizeOrOptions.min ?? 5) : 5,
    max: isAuto ? (pageSizeOrOptions.max ?? 60) : 60,
  });

  const pageSize = isAuto ? auto.pageSize : fixedPageSize;

  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const paginatedItems = useMemo(
    () => items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [items, currentPage, pageSize]
  );

  // Página fora do total (ex.: encolheu a janela ou a lista diminuiu).
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  const resetPage = () => setCurrentPage(1);

  return {
    currentPage,
    totalPages,
    paginatedItems,
    setCurrentPage,
    resetPage,
    totalItems: items.length,
    pageSize,
    // Modo auto: ancore o ref no ListCard e use a altura no style do card.
    containerRef: auto.ref,
    availableHeight: isAuto ? auto.availableHeight : 0,
    isAuto,
  };
}
