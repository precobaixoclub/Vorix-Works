/**
 * Exportação CSV. Centraliza o escape correto — nome com vírgula, observação
 * com aspas ou quebra de linha destroem as colunas quando o valor é
 * concatenado cru (padrão que existia solto em alguns hooks antigos).
 */

/** Escapa um valor conforme RFC 4180: aspas duplicadas e campo entre aspas. */
function escapeCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  // Só precisa de aspas se contém separador, aspas ou quebra de linha.
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/**
 * Monta o CSV e dispara o download.
 *
 * Usa `;` como separador e BOM UTF-8 porque o destino real é o Excel em
 * pt-BR: com vírgula, o Excel joga a linha inteira numa célula; sem BOM,
 * acentos viram caracteres quebrados.
 */
export function downloadCsv<T>(
  filename: string,
  columns: CsvColumn<T>[],
  rows: T[],
): void {
  const linhas = [
    columns.map((c) => escapeCell(c.header)).join(';'),
    ...rows.map((row) => columns.map((c) => escapeCell(c.value(row))).join(';')),
  ];

  const conteudo = '﻿' + linhas.join('\r\n');
  const blob = new Blob([conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Data no nome do arquivo: `relatorio-2026-08-18.csv`. */
export function csvFilename(base: string): string {
  const hoje = new Date().toISOString().split('T')[0];
  return `${base}-${hoje}.csv`;
}
