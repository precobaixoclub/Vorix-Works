/**
 * Métricas de fonte TrueType lidas direto do arquivo (tabelas head, hhea, hmtx, cmap e name), sem
 * dependência externa. Serve para quebrar texto pela largura REAL de cada glifo antes de entregar
 * ao libass, garantindo que título e legenda nunca saiam do quadro.
 *
 * Ignora kerning: a largura medida fica um pouco maior que a desenhada, o lado seguro.
 */

import { readFileSync } from "node:fs";

export type FontMetrics = {
  family: string;
  subfamily: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  /** Largura de `text` em pixels para a fonte em `sizePx` (altura em pixels do em). */
  measure(text: string, sizePx: number): number;
};

type Table = { offset: number; length: number };

function tables(view: DataView): Map<string, Table> {
  const count = view.getUint16(4);
  const map = new Map<string, Table>();
  for (let index = 0; index < count; index += 1) {
    const base = 12 + index * 16;
    const tag = String.fromCharCode(view.getUint8(base), view.getUint8(base + 1), view.getUint8(base + 2), view.getUint8(base + 3));
    map.set(tag, { offset: view.getUint32(base + 8), length: view.getUint32(base + 12) });
  }
  return map;
}

function readCmap(view: DataView, table: Table): (code: number) => number {
  const count = view.getUint16(table.offset + 2);
  let best: { format: number; offset: number } | null = null;
  for (let index = 0; index < count; index += 1) {
    const base = table.offset + 4 + index * 8;
    const platform = view.getUint16(base);
    const encoding = view.getUint16(base + 2);
    const offset = table.offset + view.getUint32(base + 4);
    const format = view.getUint16(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12 || (format === 4 && (!best || best.format !== 12))) best = { format, offset };
  }
  if (!best) return () => 0;
  const { format, offset } = best;
  if (format === 12) {
    const groups = view.getUint32(offset + 12);
    return (code) => {
      for (let index = 0; index < groups; index += 1) {
        const base = offset + 16 + index * 12;
        const start = view.getUint32(base);
        const end = view.getUint32(base + 4);
        if (code >= start && code <= end) return view.getUint32(base + 8) + (code - start);
      }
      return 0;
    };
  }
  const segX2 = view.getUint16(offset + 6);
  const endBase = offset + 14;
  const startBase = endBase + segX2 + 2;
  const deltaBase = startBase + segX2;
  const rangeBase = deltaBase + segX2;
  return (code) => {
    if (code > 0xffff) return 0;
    for (let index = 0; index < segX2 / 2; index += 1) {
      const end = view.getUint16(endBase + index * 2);
      if (code > end) continue;
      const start = view.getUint16(startBase + index * 2);
      if (code < start) return 0;
      const delta = view.getInt16(deltaBase + index * 2);
      const rangeOffset = view.getUint16(rangeBase + index * 2);
      if (rangeOffset === 0) return (code + delta) & 0xffff;
      const glyphAddress = rangeBase + index * 2 + rangeOffset + (code - start) * 2;
      const glyph = view.getUint16(glyphAddress);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

function readName(view: DataView, table: Table, nameId: number): string {
  const count = view.getUint16(table.offset + 2);
  const storage = table.offset + view.getUint16(table.offset + 4);
  let fallback = "";
  for (let index = 0; index < count; index += 1) {
    const base = table.offset + 6 + index * 12;
    if (view.getUint16(base + 6) !== nameId) continue;
    const platform = view.getUint16(base);
    const length = view.getUint16(base + 8);
    const offset = storage + view.getUint16(base + 10);
    if (platform === 3 || platform === 0) {
      let text = "";
      for (let i = 0; i < length; i += 2) text += String.fromCharCode(view.getUint16(offset + i));
      return text;
    }
    if (platform === 1 && !fallback) for (let i = 0; i < length; i += 1) fallback += String.fromCharCode(view.getUint8(offset + i));
  }
  return fallback;
}

export function loadFontMetrics(path: string): FontMetrics {
  const buffer = readFileSync(path);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const map = tables(view);
  const need = (tag: string) => {
    const table = map.get(tag);
    if (!table) throw new Error(`Fonte sem tabela ${tag}: ${path}`);
    return table;
  };
  const head = need("head");
  const hhea = need("hhea");
  const hmtx = need("hmtx");
  const unitsPerEm = view.getUint16(head.offset + 18);
  const ascender = view.getInt16(hhea.offset + 4);
  const descender = view.getInt16(hhea.offset + 6);
  const metricsCount = view.getUint16(hhea.offset + 34);
  const glyphOf = readCmap(view, need("cmap"));
  const advanceCache = new Map<number, number>();
  const advance = (glyph: number) => {
    const cached = advanceCache.get(glyph);
    if (cached !== undefined) return cached;
    const index = Math.min(glyph, metricsCount - 1);
    const value = view.getUint16(hmtx.offset + index * 4);
    advanceCache.set(glyph, value);
    return value;
  };
  const name = map.get("name");
  return {
    family: name ? readName(view, name, 16) || readName(view, name, 1) : "",
    subfamily: name ? readName(view, name, 17) || readName(view, name, 2) : "",
    unitsPerEm,
    ascender,
    descender,
    measure(text, sizePx) {
      let units = 0;
      for (const char of text) units += advance(glyphOf(char.codePointAt(0) ?? 0));
      return (units / unitsPerEm) * sizePx;
    },
  };
}
