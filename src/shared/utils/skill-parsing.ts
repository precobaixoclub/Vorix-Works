/**
 * Utilitários puros e sem estado, reaproveitados por várias Skills ao interpretar contexto da
 * Clara e respostas do Ícaro. `src/shared` não é uma Skill — importar daqui não viola o
 * isolamento entre Skills (ADR 0002), que só proíbe uma Skill importar de outra.
 */

/** Escolhe o registro de conhecimento mais recente de uma lista, pela data de atualização. */
export function latest<TRecord extends { updatedAt: string }>(records?: TRecord[]): TRecord | undefined {
  if (!records || records.length === 0) return undefined;
  return [...records].sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))[0];
}

/** Extrai o primeiro objeto JSON de uma resposta do Ícaro, tolerando texto ao redor. */
export function extractJson(content: string, specialistLabel: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error(`Ícaro não retornou JSON válido para ${specialistLabel}.`);
}

/** Normaliza um valor arbitrário para uma lista de strings não vazias e sem espaços nas pontas. */
export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

/** Normaliza texto para comparação por palavra-chave: minúsculas, sem acento, pontuação reduzida a espaço. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}# ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
