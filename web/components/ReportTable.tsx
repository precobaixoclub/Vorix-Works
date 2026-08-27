"use client";

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { ArrowUpDown, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { downloadCsv, csvFilename, type CsvColumn } from '@/lib/csv';

/**
 * Linha genérica de relatório. No projeto de origem este tipo vinha do hook de
 * dados; aqui fica local para o componente ser portátil. Troque por um tipo mais
 * estrito assim que o shape das suas RPCs estiver definido.
 */
export interface ReportRow {
  id: string;
  [key: string]: unknown;
}

/**
 * Tabela de um relatório de lista. Paginação e ordenação são SERVER-SIDE
 * (as listas passam de mil linhas), então diferente do `lista-padrao` — que
 * ordena o array inteiro em memória — aqui o clique no cabeçalho refaz a query.
 */

export interface ReportColumn {
  /** Chave de ordenação aceita pela RPC. `undefined` = coluna não ordena. */
  sortKey?: string;
  header: string;
  align?: 'left' | 'right';
  /** Conteúdo da célula. */
  cell: (row: ReportRow) => React.ReactNode;
  /** Valor da célula no CSV. Sem isto, a coluna não é exportada. */
  csv?: (row: ReportRow) => unknown;
}

interface ReportTableProps {
  columns: ReportColumn[];
  rows: ReportRow[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  sort: string | null;
  dir: 'asc' | 'desc';
  onSort: (key: string) => void;
  loading: boolean;
  fetching: boolean;
  /** Mensagem quando não há nenhuma linha (o bom: a lista está limpa). */
  emptyText: string;
  /** Nome-base do arquivo exportado. */
  exportName: string;
  /** Busca TODAS as linhas para exportar (não só a página atual). */
  onExportFetch: () => Promise<ReportRow[]>;
}

export function ReportTable({
  columns, rows, total, page, pageSize, onPageChange,
  sort, dir, onSort, loading, fetching, emptyText, exportName, onExportFetch,
}: ReportTableProps) {
  const [exporting, setExporting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleExport = async () => {
    if (exporting || total === 0) return;
    setExporting(true);
    try {
      const todas = await onExportFetch();
      const csvCols: CsvColumn<ReportRow>[] = columns
        .filter((c) => c.csv)
        .map((c) => ({ header: c.header, value: c.csv! }));
      downloadCsv(csvFilename(exportName), csvCols, todas);
      toast.success(`${todas.length} linhas exportadas com sucesso!`);
    } catch (err) {
      toast.error('Erro ao exportar relatório', {
        description: err instanceof Error ? err.message : 'Tente novamente.',
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {loading ? (
              'Carregando…'
            ) : (
              <>
                <span className="font-medium tabular-nums text-foreground">
                  {new Intl.NumberFormat('pt-BR').format(total)}
                </span>{' '}
                {total === 1 ? 'registro' : 'registros'}
                {fetching && !loading && (
                  <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />
                )}
              </>
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => void handleExport()}
            disabled={exporting || total === 0}
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Exportar CSV
          </Button>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead
                    key={col.header}
                    className={cn(col.align === 'right' && 'text-right')}
                  >
                    {col.sortKey ? (
                      <button
                        type="button"
                        onClick={() => onSort(col.sortKey!)}
                        className={cn(
                          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
                          sort === col.sortKey ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {col.header}
                        <ArrowUpDown
                          className={cn(
                            'h-3 w-3',
                            sort === col.sortKey ? 'opacity-100' : 'opacity-40',
                          )}
                        />
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-12 text-center">
                    <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="py-12 text-center text-muted-foreground"
                  >
                    {emptyText}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    {columns.map((col) => (
                      <TableCell
                        key={col.header}
                        className={cn(col.align === 'right' && 'text-right tabular-nums')}
                      >
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="border-t border-border/60 px-4 py-3">
            <TablePagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={onPageChange}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Célula de valor monetário — "—" quando vazio, para não fingir R$ 0,00. */
export function ValorCell({ value }: { value: number | null }) {
  if (value == null || Number(value) === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
      .format(Number(value))}</>
  );
}

/** Chip de "o que falta" / contexto da linha. */
export function TagCell({ text, tone }: { text: string | null; tone?: 'critical' }) {
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] font-normal', tone === 'critical' && 'border-destructive/50 text-destructive')}
    >
      {text}
    </Badge>
  );
}
