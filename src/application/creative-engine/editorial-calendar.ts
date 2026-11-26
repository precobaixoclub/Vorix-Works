/**
 * Calendário inteligente do piloto: em que ordem as pautas do Bolsão concorrem a um horário.
 *
 * Antes (até 26/11/2026) a ordem era só data marcada → prioridade → data sugerida → criação. Duas pautas
 * da mesma categoria, três carrosséis seguidos ou o mesmo assunto em dias vizinhos saíam um atrás do outro.
 * Aqui a ordem considera o que já foi ao ar e o que já está agendado perto do horário:
 * - categoria (série/campanha) e abordagem iguais às peças vizinhas perdem a vez;
 * - o mesmo formato pela terceira vez seguida perde a vez;
 * - assunto quase igual a uma peça vizinha perde muito (as palavras da pauta comparadas uma a uma);
 * - prioridade alta e data sugerida vencida continuam pesando a favor.
 *
 * O que NÃO muda: pauta com data marcada pelo cliente (calendário) para o dia continua na frente, na ordem
 * de sempre; os horários (12h/19h) são os configurados; nenhuma pauta é descartada — só reordenada. Sem
 * histórico, a ordem é exatamente a anterior.
 */

export type CalendarIdea = {
  id: string;
  externalId?: string;
  title: string;
  category?: string;
  approach?: string;
  format: string;
  keyMessage?: string;
  concept?: string;
  priority?: string;
  scheduledDate?: string;
  suggestedDate?: string;
  createdAt: string;
};

/** Peça publicada ou agendada (com a pauta de origem, quando houver). */
export type CalendarPiece = {
  ideaId?: string;
  title?: string;
  category?: string;
  approach?: string;
  format?: string;
  text?: string;
  /** Quando foi/vai ao ar (ISO). */
  at: string;
};

export type RankedIdea<T extends CalendarIdea> = { idea: T; score: number; reasons: string[] };

const STOPWORDS = new Set("para pela pelo pelos pelas como mais menos muito muita muitos muitas quando onde porque porque entre sobre depois antes ainda voce voces nosso nossa nossos nossas seus suas essa esse esta este isso isto aqui cada mesmo mesma tudo todo toda todos todas qual quais quem fazer feito pode podem deve devem nunca sempre agora hoje sem com uma umas uns dos das nos nas que nao sim tem ter sua seu".split(" "));

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Palavras de conteúdo da pauta (sem acento, sem palavras vazias, plural simples reduzido). */
export function topicWords(text: string): Set<string> {
  return new Set(normalize(text).split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOPWORDS.has(word)).map((word) => (word.length > 5 && word.endsWith("s") ? word.slice(0, -1) : word)));
}

export function topicSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

const ideaWords = (idea: { title?: string; keyMessage?: string; concept?: string; text?: string }) =>
  topicWords([idea.title, idea.keyMessage, idea.concept, idea.text].filter(Boolean).join(" "));
const same = (a?: string, b?: string) => Boolean(a && b && normalize(a).trim() === normalize(b).trim());

/** Ordem tradicional (antes do calendário inteligente): desempate e ordem sem histórico. */
export function compareIdeasForSlot(a: CalendarIdea, b: CalendarIdea): number {
  return (a.scheduledDate ?? "9999").localeCompare(b.scheduledDate ?? "9999")
    || Number(b.priority === "high") - Number(a.priority === "high")
    || (a.suggestedDate ?? "9999").localeCompare(b.suggestedDate ?? "9999")
    || a.createdAt.localeCompare(b.createdAt) || (a.externalId ?? a.id).localeCompare(b.externalId ?? b.id);
}

export function rankIdeasForSlot<T extends CalendarIdea>(candidates: readonly T[], input: { slot: string; recent: readonly CalendarPiece[] }): RankedIdea<T>[] {
  const slotTime = Date.parse(`${input.slot.slice(0, 16)}:00-03:00`);
  const slotDate = input.slot.slice(0, 10);
  // Vizinhas do horário primeiro (a das 12h de hoje pesa mais para as 19h do que a de anteontem).
  const recent = [...input.recent]
    .filter((piece) => Number.isFinite(Date.parse(piece.at)))
    .sort((a, b) => Math.abs(Date.parse(a.at) - slotTime) - Math.abs(Date.parse(b.at) - slotTime))
    .slice(0, 10);
  const recentWords = recent.map((piece) => ideaWords(piece));
  const ordered = [...candidates].sort(compareIdeasForSlot);
  const ranked = ordered.map((idea, index) => {
    const reasons: string[] = [];
    // Data marcada pelo cliente para o dia: fica na frente, na ordem de sempre (o calendário é dele).
    if (idea.scheduledDate && idea.scheduledDate <= slotDate) {
      return { idea, score: 1000 - index, reasons: [`Data marcada no calendário (${idea.scheduledDate}).`] };
    }
    let score = -index * 0.001;
    if (idea.priority === "high") { score += 3; reasons.push("Prioridade alta."); }
    if (idea.suggestedDate && idea.suggestedDate <= slotDate) { score += 1; reasons.push(`Data sugerida (${idea.suggestedDate}) já chegou.`); }
    const categoryHits = recent.slice(0, 6).map((piece, position) => (same(piece.category, idea.category) ? position : -1)).filter((position) => position >= 0);
    if (categoryHits.length) {
      const penalty = categoryHits.reduce((sum, position) => sum + (position === 0 ? 2 : position === 1 ? 1 : 0.4), 0);
      score -= penalty;
      reasons.push(`Categoria "${idea.category}" em ${categoryHits.length} peça(s) vizinha(s) (-${penalty.toFixed(1)}).`);
    }
    const approachHits = recent.slice(0, 3).map((piece, position) => (same(piece.approach, idea.approach) ? position : -1)).filter((position) => position >= 0);
    if (approachHits.length) {
      const penalty = approachHits.reduce((sum, position) => sum + (position === 0 ? 1.2 : 0.5), 0);
      score -= penalty;
      reasons.push(`Abordagem "${idea.approach}" repetida (-${penalty.toFixed(1)}).`);
    }
    if (recent.length >= 2 && same(recent[0].format, idea.format) && same(recent[1].format, idea.format)) {
      score -= 1.5;
      reasons.push(`Seria o 3º ${idea.format === "carousel" ? "carrossel" : "post de imagem única"} seguido (-1.5).`);
    }
    const words = ideaWords(idea);
    let nearest = { similarity: 0, piece: undefined as CalendarPiece | undefined };
    recentWords.forEach((other, position) => {
      const similarity = topicSimilarity(words, other);
      if (similarity > nearest.similarity) nearest = { similarity, piece: recent[position] };
    });
    if (nearest.similarity >= 0.45) {
      score -= 3;
      reasons.push(`Assunto quase igual a "${nearest.piece?.title ?? "peça recente"}" (${Math.round(nearest.similarity * 100)}% das palavras; -3).`);
    } else if (nearest.similarity >= 0.25) {
      score -= 1.2;
      reasons.push(`Assunto parecido com "${nearest.piece?.title ?? "peça recente"}" (${Math.round(nearest.similarity * 100)}%; -1.2).`);
    }
    return { idea, score, reasons };
  });
  return ranked.sort((a, b) => b.score - a.score);
}
