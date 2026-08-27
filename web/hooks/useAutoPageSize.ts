import { useCallback, useEffect, useRef, useState } from 'react';

interface UseAutoPageSizeOptions {
  /**
   * Seletor CSS de UMA linha da lista, relativo ao container (ref). A altura
   * real dela é medida do DOM — nada de estimativa. Ex.: 'tbody tr'.
   */
  rowSelector: string;
  /**
   * Seletores dos pedaços de "cromo" dentro do container que NÃO são linhas
   * (cabeçalho da tabela, rodapé de paginação). A soma das alturas reais deles
   * é descontada do espaço disponível. Ex.: ['thead', '[data-pagination]'].
   */
  chromeSelectors?: string[];
  /** Fallback de altura de linha enquanto o DOM ainda não tem uma para medir. */
  fallbackRowHeight?: number;
  /** Folga de segurança no fim da viewport, em px (evita a barra de rolagem). */
  bottomGap?: number;
  /** Nunca menos que isto (telas muito baixas ainda mostram algo). */
  min?: number;
  /** Nunca mais que isto (teto de segurança). */
  max?: number;
}

/**
 * Calcula quantos itens cabem na altura disponível entre o topo do container e
 * o fim da viewport, MEDINDO o DOM real (altura de uma linha e do cromo), e
 * recalcula ao vivo no resize.
 *
 * Usa um CALLBACK REF (não useRef + effect): o container da lista costuma
 * aparecer só DEPOIS do estado de loading resolver, então um effect no mount
 * media com o nó ainda inexistente e nunca mais rodava (travava no `min`). O
 * callback ref dispara o setup exatamente quando o nó é anexado — funciona
 * igual na navegação SPA e no refresh (F5).
 */
export function useAutoPageSize<T extends HTMLElement = HTMLDivElement>({
  rowSelector,
  chromeSelectors = [],
  fallbackRowHeight = 48,
  bottomGap = 16,
  min = 1,
  max = 100,
}: UseAutoPageSizeOptions): { ref: (node: T | null) => void; pageSize: number; availableHeight: number } {
  const [pageSize, setPageSize] = useState(min);
  const [availableHeight, setAvailableHeight] = useState(0);

  // Guardado em refs para o cleanup/callback não recriar a cada render.
  const nodeRef = useRef<T | null>(null);
  const rowHeightRef = useRef(fallbackRowHeight);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Opções em ref: o callback ref é estável, mas precisa ler os valores atuais.
  const optsRef = useRef({ rowSelector, chromeSelectors, fallbackRowHeight, bottomGap, min, max });
  optsRef.current = { rowSelector, chromeSelectors, fallbackRowHeight, bottomGap, min, max };

  const measure = useCallback(() => {
    const el = nodeRef.current;
    if (!el) return;
    const o = optsRef.current;

    const top = el.getBoundingClientRect().top;
    const available = window.innerHeight - top - o.bottomGap;

    const rowEl = el.querySelector(o.rowSelector) as HTMLElement | null;
    const measuredRow = rowEl?.getBoundingClientRect().height ?? 0;
    if (measuredRow > 0) rowHeightRef.current = measuredRow;
    const rowHeight = rowHeightRef.current || o.fallbackRowHeight;

    let chrome = 0;
    for (const sel of o.chromeSelectors) {
      const node = el.querySelector(sel) as HTMLElement | null;
      if (node) chrome += node.getBoundingClientRect().height;
    }

    const rows = Math.floor((available - chrome) / rowHeight);
    setPageSize(Math.max(o.min, Math.min(o.max, rows)));
    setAvailableHeight(Math.max(0, available));
  }, []);

  // Callback ref: monta os observadores quando o nó é anexado, desmonta quando
  // sai. Chamado pelo React sempre que o elemento com este ref troca.
  const ref = useCallback(
    (node: T | null) => {
      // Desmonta o setup anterior.
      cleanupRef.current?.();
      cleanupRef.current = null;
      nodeRef.current = node;
      if (!node) return;

      let frame = 0;
      const schedule = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(measure);
      };

      measure();

      // Refresh (F5): o 1º layout pode estar cru (fontes/CSS assentando) — a
      // medição sai errada. Remedimos até estabilizar.
      const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
      const timers = [60, 200, 500].map((ms) => window.setTimeout(measure, ms));
      if (document.fonts?.ready) document.fonts.ready.then(measure).catch(() => {});

      window.addEventListener('resize', schedule);
      const ro = new ResizeObserver(schedule);
      ro.observe(document.body);
      ro.observe(node);

      cleanupRef.current = () => {
        cancelAnimationFrame(frame);
        cancelAnimationFrame(raf);
        timers.forEach(clearTimeout);
        window.removeEventListener('resize', schedule);
        ro.disconnect();
      };
    },
    [measure],
  );

  // Cleanup no unmount do componente.
  useEffect(() => () => cleanupRef.current?.(), []);

  return { ref, pageSize, availableHeight };
}
