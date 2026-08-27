export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  dir: SortDirection;
}

/**
 * Alterna o estado de ordenação para a coluna clicada:
 * coluna nova → asc; mesma coluna → asc→desc→asc.
 */
export function toggleSort<K extends string>(prev: SortState<K>, key: K): SortState<K> {
  return prev.key !== key
    ? { key, dir: 'asc' }
    : { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
}
