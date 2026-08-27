import { useMemo, useState } from 'react';
import { toggleSort, type SortState } from '@/lib/sort';

type SortValue = string | number | null;
type Accessors<T, K extends string> = Record<K, (item: T) => SortValue>;

/**
 * Ordenação client-side plugável por coluna. O consumidor passa um mapa
 * `chave → como extrair o valor daquela coluna`; o hook devolve a lista
 * ordenada, o estado e o handler para os <SortableHead>.
 *
 *   const { sorted, sort, onSort } = useSortedRows(items, {
 *     name: (x) => x.name.toLowerCase(),
 *     total: (x) => x.total,
 *   }, { key: 'name', dir: 'asc' });
 *
 * Regras: strings via localeCompare pt-BR; números por subtração; `null`
 * (célula vazia, ex.: taxa sem base) vai sempre para o fim, em qualquer direção.
 */
export function useSortedRows<T, K extends string>(
  items: T[],
  accessors: Accessors<T, K>,
  initial: SortState<K>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const sorted = useMemo(() => {
    const factor = sort.dir === 'asc' ? 1 : -1;
    const get = accessors[sort.key];
    return [...items].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'string' && typeof vb === 'string') {
        return va.localeCompare(vb, 'pt-BR', { sensitivity: 'base' }) * factor;
      }
      return ((va as number) - (vb as number)) * factor;
    });
    // accessors é recriado a cada render (literal inline); dependemos só de
    // items e sort — o accessor da chave ativa é lido na hora.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sort]);

  const onSort = (key: K) => setSort((prev) => toggleSort(prev, key));

  return { sorted, sort, onSort, setSort };
}
