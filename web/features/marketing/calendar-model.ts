import type { EditorialIdea } from "@/features/editorial-ideas/api";
import { derivePublicationStatus, publicationDateOf, type PublicationNetwork, type UnifiedPublication } from "@/features/publication-history/types";

/**
 * Calendário único do Marketing (Reorganização de UX — Fase 5). Junta, SEM criar dados novos:
 * - publicações reais (compositor social + feeds legados), uma entrada por publicação — um post
 *   enviado ao Instagram e ao Facebook aparece UMA vez, com as duas redes;
 * - ideias do Bolsão com data editorial, numa camada à parte ("Planejado"): planejar não é agendar.
 */

export type CalendarStatus = "planned" | "in_production" | "awaiting_review" | "awaiting_approval" | "scheduled" | "publishing" | "published" | "failed" | "cancelled" | "draft";

export const CALENDAR_STATUS_LABEL: Record<CalendarStatus, string> = {
  planned: "Planejado (ideia)",
  in_production: "Em produção",
  awaiting_review: "Para revisar",
  awaiting_approval: "Aguardando aprovação",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
  cancelled: "Cancelado",
  draft: "Rascunho",
};

/** Ordem dos filtros e da legenda: planejamento primeiro, depois o ciclo real da publicação. */
export const CALENDAR_STATUS_ORDER: readonly CalendarStatus[] = ["planned", "in_production", "awaiting_review", "awaiting_approval", "scheduled", "publishing", "published", "failed", "cancelled", "draft"];

/** Itens que são planejamento (ideia), não publicação. */
export const PLANNING_STATUSES: ReadonlySet<CalendarStatus> = new Set(["planned", "in_production", "awaiting_review"]);

export type CalendarItem =
  | { kind: "publication"; key: string; date: Date; title: string; status: CalendarStatus; networks: PublicationNetwork[]; posts: UnifiedPublication[]; social: boolean; postId: string; thumb?: string }
  | { kind: "idea"; key: string; date: Date; title: string; status: CalendarStatus; networks: PublicationNetwork[]; idea: EditorialIdea };

/** A situação mais urgente entre as redes de uma publicação (o detalhe mostra cada uma). */
const PUBLICATION_PRIORITY: readonly CalendarStatus[] = ["failed", "awaiting_approval", "publishing", "scheduled", "published", "cancelled", "draft"];

function titleOf(post: UnifiedPublication): string {
  const line = post.text.split("\n").map((part) => part.trim()).find(Boolean);
  if (!line) return post.media.videoUrl ? "Vídeo sem legenda" : "Publicação sem legenda";
  return line.length > 70 ? `${line.slice(0, 67)}…` : line;
}

function thumbOf(post: UnifiedPublication): string | undefined {
  return post.media.thumbnailUrl ?? post.media.imageUrls[0];
}

function ideaStatus(idea: EditorialIdea): CalendarStatus | undefined {
  switch (idea.status) {
    case "available": return "planned";
    case "in_production": return "in_production";
    case "produced": return "awaiting_review";
    // Aprovada/publicada já virou conteúdo/publicação (que aparece por conta própria); arquivada saiu de uso.
    default: return undefined;
  }
}

/** "AAAA-MM-DD" da data editorial → meio-dia local (não muda de dia por fuso). */
function editorialDate(value: string | undefined): Date | undefined {
  const match = value?.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

export function buildCalendarItems(publications: readonly UnifiedPublication[] | undefined, ideas: readonly EditorialIdea[] | undefined): CalendarItem[] {
  const groups = new Map<string, UnifiedPublication[]>();
  for (const post of publications ?? []) {
    const key = post.source === "social" ? `social:${post.id}` : `${post.network}:${post.id}`;
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  const items: CalendarItem[] = [];
  for (const [key, posts] of groups) {
    const dateIso = posts.map(publicationDateOf).filter((value): value is string => Boolean(value)).sort()[0];
    const date = dateIso ? new Date(dateIso) : undefined;
    if (!date || Number.isNaN(date.getTime())) continue;
    const statuses = posts.map((post) => derivePublicationStatus(post) as CalendarStatus);
    const status = PUBLICATION_PRIORITY.find((candidate) => statuses.includes(candidate)) ?? "draft";
    // Rascunho não tem data real de publicação: não entra no calendário (mesma regra das telas antigas).
    if (status === "draft") continue;
    const primary = posts.find((post) => thumbOf(post)) ?? posts[0]!;
    items.push({ kind: "publication", key, date, title: titleOf(primary), status, networks: [...new Set(posts.map((post) => post.network))], posts, social: posts[0]!.source === "social", postId: posts[0]!.id, thumb: thumbOf(primary) });
  }
  for (const idea of ideas ?? []) {
    const status = ideaStatus(idea);
    const date = editorialDate(idea.scheduledDate ?? idea.suggestedDate);
    if (!status || !date) continue;
    items.push({ kind: "idea", key: `idea:${idea.id}`, date, title: idea.title, status, networks: [], idea });
  }
  return items.sort((a, b) => a.date.getTime() - b.date.getTime() || a.key.localeCompare(b.key));
}

export type CalendarFilter = { network: PublicationNetwork | "all"; status: CalendarStatus | "all"; showIdeas: boolean };

export function filterCalendarItems(items: readonly CalendarItem[], filter: CalendarFilter): CalendarItem[] {
  return items.filter((item) => {
    if (item.kind === "idea" && !filter.showIdeas) return false;
    if (filter.status !== "all" && item.status !== filter.status) return false;
    // Ideia não tem rede: filtrar por rede mostra só publicações.
    if (filter.network !== "all" && !item.networks.includes(filter.network)) return false;
    return true;
  });
}

// ------------------------------------------------------------------------------------ Períodos

export type CalendarView = "month" | "week" | "list";

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Semana começando na segunda-feira. */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7;
  return addDays(day, -offset);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Período visível: mês (e a lista usa o mês) ou semana. `to` é exclusivo. */
const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);

export function rangeFor(cursor: Date, view: CalendarView): { from: Date; to: Date; label: string } {
  if (view === "week") {
    const from = startOfWeek(cursor);
    const to = addDays(from, 7);
    const last = addDays(to, -1);
    const fmt = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" });
    return { from, to, label: `${fmt.format(from)} – ${fmt.format(last)}` };  // "23 de nov. – 29 de nov."
  }
  const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  return { from, to, label: capitalize(new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(from)) };
}

export function shiftCursor(cursor: Date, view: CalendarView, direction: number): Date {
  if (view === "week") return addDays(cursor, 7 * direction);
  return new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
}

/** Dias da grade mensal: semanas completas (segunda a domingo) que cobrem o mês. */
export function monthCells(cursor: Date): Date[] {
  const first = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const end = addDays(startOfWeek(lastOfMonth), 7);
  const cells: Date[] = [];
  for (let day = first; day < end; day = addDays(day, 1)) cells.push(day);
  return cells;
}

export function inRange(items: readonly CalendarItem[], range: { from: Date; to: Date }): CalendarItem[] {
  return items.filter((item) => item.date >= range.from && item.date < range.to);
}

/** Lista/agenda: agrupado por dia, na ordem. */
export function groupByDay(items: readonly CalendarItem[]): { day: Date; items: CalendarItem[] }[] {
  const groups: { day: Date; items: CalendarItem[] }[] = [];
  for (const item of items) {
    const day = startOfDay(item.date);
    const last = groups[groups.length - 1];
    if (last && sameDay(last.day, day)) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

export function countByStatus(items: readonly CalendarItem[]): Partial<Record<CalendarStatus, number>> {
  const counts: Partial<Record<CalendarStatus, number>> = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}
